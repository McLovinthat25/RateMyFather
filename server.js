// RateMyFather — Node + Express + PostgreSQL. No build step.
// Entry point: server.js. Env: DATABASE_URL, OWNER_SECRET (no default, never hardcoded),
// PORT (default 3000). Runs migrations/*.sql on boot, in order (idempotent).
// Moderation is enforced SERVER SIDE: every /owner route checks the signed owner
// session cookie before touching data (see requireOwner). Owner login compares the
// supplied secret with OWNER_SECRET using a timing-safe comparison.
// Directory profiles can NEVER be deleted: delete routes refuse user_added=false rows.

const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { AsyncLocalStorage } = require('async_hooks');
const { Pool } = require('pg');
const { screenBody, sourceTokenHash, BURST_LIMIT, SPIKE_THRESHOLD } = require('./lib/screening');
const { realClientIp } = require('./lib/client-ip');
const { cleanTriviaName, containsProfanity } = require('./lib/profanity');
const { REGIONS, regionOf, areaForZip } = require('./lib/regions');
const { TRIVIA_QUESTIONS, easternDateStr, dailyTriviaQuestions } = require('./lib/trivia');
// Arcade trivia game pools: 30 questions per difficulty (Easy, Medium,
// Hard). Embedded on the games page as window.RMF_TRIVIA_ARCADE, the
// same pattern as the homepage daily trivia.
const TRIVIA_ARCADE_QUESTIONS = require('./lib/trivia-arcade');
// Verse-of-the-day pool expansion: 218 more Old Testament verses and
// 185 more New Testament verses and saint quotes, taking the pool from
// 164 to 567 entries, so a daily visitor goes over a year without a
// repeat. Same { text, ref } format; verified no duplicate text.
const { EXTRA_OT_VERSES } = require('./lib/verses-extra-ot');
const EXTRA_NT_VERSES = require('./lib/verses-extra-nt');

const PORT = process.env.PORT || 3000;
const OWNER_SECRET = process.env.OWNER_SECRET || '';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 10, connectionTimeoutMillis: 5000 });
const app = express();
app.disable('x-powered-by');
// Security headers (audit F-01/F-02, Iteration 1 headers, Iteration 2
// enforcing CSP). One middleware at the top, before express.static, so
// every response — pages and API alike — carries them.
// CSP is ENFORCING (Iteration 2): every inline script on the site
// carries a per-request nonce (see layout() / the per-page JSON blobs),
// and script-src allows 'self', the nonce, and the two Google Analytics
// hosts. There is no 'unsafe-inline' in script-src anywhere.
// style-src keeps 'unsafe-inline': inline styles are widespread
// (rating-bar widths, skeletons, owner forms) and style injection
// without script execution is low-risk — accepted residual, recorded
// in the Iteration 2 record. The self-contained error pages are the
// one exception: they carry their own hash-based CSP (see
// errorCspHeader, below the error-page definitions), because they must
// work when a follow-up asset request may fail.
const cspStore = new AsyncLocalStorage();
app.use((req, res, next) => {
  // One fresh nonce per request, carried to layout() via AsyncLocalStorage
  // so concurrent requests never share or overwrite each other's nonce.
  const nonce = crypto.randomBytes(16).toString('base64');
  res.locals.cspNonce = nonce;
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' https://www.googletagmanager.com https://www.google-analytics.com`,
    "connect-src 'self' https://www.google-analytics.com https://region1.google-analytics.com",
    "img-src 'self' https://www.google-analytics.com",
    "style-src 'self' 'unsafe-inline'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
  // HSTS without includeSubDomains: subdomain HTTPS status is unverified.
  res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', csp);
  cspStore.run({ nonce }, next);
});
// Hand-rolled in-memory per-IP rate limiter (audit F-08, Iteration 1).
// No new dependency. Single-instance caveat: state lives in this process
// and resets on deploy/restart, and a second Render instance would keep
// its own counters. Acceptable for a one-instance deployment; move to a
// shared store (database) if the site ever scales past one instance.
// Keyed on realClientIp, the server-determined client IP (see
// lib/client-ip.js), never on a client-supplied header.
function makeRateLimiter({ windowMs, max, message }) {
  const hits = new Map(); // ip -> { count, resetAt }
  return (req, res, next) => {
    const now = Date.now();
    const ip = realClientIp(req);
    let entry = hits.get(ip);
    if (!entry || now >= entry.resetAt) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(ip, entry);
    }
    entry.count += 1;
    if (entry.count > max) {
      res.setHeader('Retry-After', Math.ceil((entry.resetAt - now) / 1000));
      return res.status(429).send(message || 'Too many requests. Please try again later.');
    }
    next();
  };
}
// Global ceiling: 300 requests / 15 min / IP, reads included. Tight
// per-endpoint limits below cover the public write endpoints.
app.use(makeRateLimiter({ windowMs: 15 * 60 * 1000, max: 300 }));
// 5 submissions / hour / IP on each public write endpoint.
const submitLimiter = makeRateLimiter({ windowMs: 60 * 60 * 1000, max: 5, message: 'Too many submissions. Please try again later.' });
// 30 chat messages / hour / IP.
const chatLimiter = makeRateLimiter({ windowMs: 60 * 60 * 1000, max: 30, message: 'Too many messages. Please try again later.' });
// Owner-login brute-force protection (audit F-03): 5 failed attempts per
// IP per 15 minutes, then 429 with a growing back-off. A successful login
// resets the counter. Failed attempts are logged server-side with a hash
// of the IP only — never the supplied secret.
const loginAttempts = new Map(); // ip -> { count, firstAt, blockedUntil }
function loginBlocked(ip) {
  const rec = loginAttempts.get(ip);
  return !!(rec && rec.blockedUntil && Date.now() < rec.blockedUntil);
}
function recordLoginFailure(ip) {
  const now = Date.now();
  let rec = loginAttempts.get(ip);
  if (!rec || (now >= rec.blockedUntil && now - rec.firstAt > 15 * 60 * 1000)) {
    rec = { count: 0, firstAt: now, blockedUntil: 0 };
  }
  rec.count += 1;
  const ipHash = crypto.createHash('sha256').update(ip).digest('hex').slice(0, 12);
  console.error(`owner login failed ip_hash=${ipHash} count=${rec.count} at=${new Date(now).toISOString()}`);
  if (rec.count >= 5) {
    // Growing back-off: 15 min, doubling per further failure, capped at 4 h.
    const backoffMs = Math.min(15 * 60 * 1000 * Math.pow(2, rec.count - 5), 4 * 60 * 60 * 1000);
    rec.blockedUntil = now + backoffMs;
  }
  loginAttempts.set(ip, rec);
}
function resetLoginAttempts(ip) { loginAttempts.delete(ip); }
// CSRF guard for owner POSTs (audit F-06, Iteration 2): an Origin /
// Referer allow-list check, in one middleware used by every owner POST
// (login, logout, all moderation mutations). SameSite=Lax on the owner
// cookie already blocks cross-site POSTs from sending the cookie in
// modern browsers; this is the application-level check that does not
// depend on that. If Origin is present it must be one of the two live
// origins. If Origin is absent but Referer is present, the Referer's
// origin must be allowed. If both are absent (non-browser clients),
// allow — do not break scripted or curl use.
const OWNER_ORIGINS = new Set(['https://ratemyfather.com', 'https://ratemyfather.onrender.com']);
function ownerCsrf(req, res, next) {
  const origin = req.headers.origin;
  if (origin) {
    if (!OWNER_ORIGINS.has(origin)) return res.status(403).send('Forbidden: origin not allowed.');
    return next();
  }
  const referer = req.headers.referer;
  if (referer) {
    let refererOrigin = null;
    try { refererOrigin = new URL(referer).origin; } catch { refererOrigin = null; }
    if (!refererOrigin || !OWNER_ORIGINS.has(refererOrigin)) return res.status(403).send('Forbidden: origin not allowed.');
  }
  next();
}
app.use(express.urlencoded({ extended: true, limit: '50kb' }));
app.use(express.json({ limit: '50kb' }));
// Static assets: explicit 1-day cache (audit F-19, Iteration 2). Safe
// because the versioned bundles carry a content-hash ?v= query, so a
// deploy busts them; unversioned files (style.css, chat.js) can lag up
// to a day for repeat visitors — accepted, and unchanged from before
// for those files (they previously relied on the browser default).
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1d' }));
// Owner routes must never be cached: the queue renders user-specific
// (owner-only) data, and a cached copy must never be served to anyone
// else — or back to the owner after sign-out (audit F-19, Iteration 2).
app.use('/owner', (req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
app.set('trust proxy', 1);

// Cache-busting for the arcade bundle: the games page loads /arcade.js
// with a short content hash, so a phone that kept an old copy in a
// background tab fetches the new file after a deploy instead of playing
// a stale build. The hash is computed once at boot from the file on disk,
// so no one has to remember to bump a version number.
var ARCADE_VERSION = '1';
try {
  ARCADE_VERSION = crypto.createHash('md5').update(fs.readFileSync(path.join(__dirname, 'public', 'arcade.js'))).digest('hex').slice(0, 8);
} catch (e) { /* fall back to the plain path if the file cannot be read */ }
// Cache-busting for the trivia bundle, same pattern as the arcade.
var TRIVIA_VERSION = '1';
try {
  TRIVIA_VERSION = crypto.createHash('md5').update(fs.readFileSync(path.join(__dirname, 'public', 'trivia.js'))).digest('hex').slice(0, 8);
} catch (e) { /* fall back to the plain path if the file cannot be read */ }

// Numeric :id params only. Express 4 does not catch async route rejections,
// so a non-numeric id (e.g. /priest/abc) used in a Postgres integer query
// would throw as an unhandled promise rejection and hang or crash the
// process. Reject it here with a 404 instead. The bound also keeps absurdly
// large ids from reaching Postgres as an out-of-range integer.
app.param('id', (req, res, next, id) => {
  const n = Number(id);
  if (!/^\d+$/.test(id) || !Number.isSafeInteger(n) || n > 2147483647) {
    return sendErrorPage(res, 404, notFoundPage());
  }
  next();
});

// A body-supplied id that is missing or not a valid integer. Used by the
// public report/correction forms so a tampered id yields null (or a 400)
// instead of NaN reaching a Postgres integer column.
function numOrNull(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isSafeInteger(n) && n >= 0 && n <= 2147483647 ? n : null;
}

// ---------- helpers ----------
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
function fmtAvg(v) { return v == null ? null : (Math.round(Number(v) * 10) / 10).toFixed(1); }

async function statsFor(ids) {
  const out = {};
  if (!ids.length) return out;
  const { rows } = await pool.query(
    `SELECT priest_id, COUNT(*)::int AS n, AVG(pace) AS pace, AVG(homily) AS homily,
            AVG(likability) AS likability FROM reviews
     WHERE priest_id = ANY($1) AND status = 'approved' GROUP BY priest_id`, [ids]);
  for (const r of rows) out[r.priest_id] = r;
  return out;
}
function avgLine(st) {
  if (!st || !st.n) return `<span class="unrated">Not rated yet</span>`;
  const caveat = st.n === 1 ? `<span class="caveat">Based on a single review.</span>` : '';
  return `<span class="scores">Pace ${fmtAvg(st.pace)} &middot; Homily ${fmtAvg(st.homily)} &middot; Likability ${fmtAvg(st.likability)} <span class="count">(${st.n} review${st.n === 1 ? '' : 's'})</span></span>${caveat}`;
}
// Overall average across the three categories (display only; the three
// category averages are always shown alongside it).
function overallAvg(st) {
  if (!st || !st.n) return null;
  return (Number(st.pace) + Number(st.homily) + Number(st.likability)) / 3;
}
// Gold stars for an average out of 5. Whole-star rounding only; the exact
// number is always shown numerically next to the stars.
function starsHtml(avg) {
  if (avg == null) return '';
  const filled = Math.round(avg);
  let s = '';
  for (let i = 1; i <= 5; i++) s += i <= filled ? '★' : '<span class="empty">★</span>';
  return `<span class="stars" aria-label="${avg.toFixed(1)} out of 5">${s}</span>`;
}
function assignment(p) {
  const parts = [];
  if (p.parish) {
    const moved = p.life_status === 'moved' || p.life_status === 'moved_out';
    parts.push((moved ? 'Last listed 2017 at ' : 'Listed at ') + esc(p.parish));
  }
  const loc = [p.city, p.state].filter(Boolean).join(', ');
  if (loc) parts.push(esc(loc));
  return parts.join(' &middot; ') || 'Listing details not available';
}
// Plain-text version of assignment(), for title attributes (no HTML entities).
function assignmentText(p) {
  const parts = [];
  if (p.parish) {
    const moved = p.life_status === 'moved' || p.life_status === 'moved_out';
    parts.push((moved ? 'Last listed 2017 at ' : 'Listed at ') + p.parish);
  }
  const loc = [p.city, p.state].filter(Boolean).join(', ');
  if (loc) parts.push(loc);
  return parts.join(' - ') || 'Listing details not available';
}
// Status notice from the Nov 8, 2026 verification sweep. Shown on a profile
// (reachable by direct link) when the priest is not currently serving at
// the listed parish, or has moved. Search and browse never list these
// priests; the notice is for the historical record only.
function lifeStatusHtml(p) {
  const note = p.status_note ? ` ${esc(p.status_note)}` : '';
  switch (p.life_status) {
    case 'deceased': {
      const d = p.death_date ? ` Died ${esc(p.death_date)}.` : '';
      return `<p class="notice"><strong>Deceased.</strong>${d} This is a historical record; this priest no longer serves a parish.${note}</p>`;
    }
    case 'retired':
      return `<p class="notice"><strong>Retired.</strong> This priest no longer serves a parish.${note}</p>`;
    case 'laicized':
      return `<p class="notice"><strong>Laicized.</strong> This priest has been dismissed from the clerical state.${note}</p>`;
    case 'removed':
      return `<p class="notice"><strong>Removed from public ministry.</strong>${note}</p>`;
    case 'suspended':
      return `<p class="notice"><strong>Suspended from ministry.</strong>${note}</p>`;
    case 'on_leave':
      return `<p class="notice"><strong>On leave.</strong>${note}</p>`;
    case 'moved':
      return `<p class="notice"><strong>Moved.</strong> This priest has moved from the parish listed below; the current assignment is not confirmed.${note}</p>`;
    case 'moved_out':
      return `<p class="notice"><strong>Moved out of the diocese.</strong>${note}</p>`;
    case 'bishop':
      return `<p class="notice"><strong>Bishop.</strong>${note}</p>`;
    default:
      return '';
  }
}
// Save button for priest cards and profiles. Saved priests live in
// localStorage only (public/saved.js): no account, nothing leaves the
// browser. The button sits beside the card link, never inside it.
function saveBtn(p, label) {
  return `<button type="button" class="save-btn" data-priest-id="${p.id}" data-priest-name="${esc(p.name)}" data-label="${esc(label || 'Save')}" aria-pressed="false" aria-label="Save ${esc(p.name)}">☆ ${esc(label || 'Save')}</button>`;
}
function priestCard(p, st) {
  const avg = overallAvg(st);
  const scoreBox = avg == null
    ? `<span class="score-box unrated">Not yet rated</span>`
    : `<span class="score-box"><span class="num">${avg.toFixed(1)}</span><span class="lbl">out of 5</span></span>`;
  return `<div class="card card--ruled card-lift priest-card">
    <a class="priest-link" href="/priest/${p.id}" title="${esc(p.name)} — ${esc(assignmentText(p))}">
    ${scoreBox}
    <span class="priest-main">
      <span class="priest-name" title="${esc(p.name)}">${esc(p.name)}</span>
      <span class="assign" title="${esc(assignmentText(p))}">${assignment(p)}</span>
      ${avg == null ? '' : starsHtml(avg)}
      ${p.user_added ? '<span class="badge">User-added profile</span>' : ''}
      ${avg == null ? '' : avgLine(st)}
    </span>
    <span class="chevron" aria-hidden="true">&rsaquo;</span>
    </a>
    ${saveBtn(p, 'Save')}
  </div>`;
}
const DISCLAIMER = 'Reviews are individual users&rsquo; opinions, not statements of fact, and are not verified or endorsed by RateMyFather.';
// Leaded-glass divider strip: five panes, weights 3,1,3,1,3, alternating ruby/amber.
function glassStrip(cls = '') {
  return `<div class="glass-strip ${cls}" aria-hidden="true"><span class="w3"></span><span></span><span class="w3"></span><span></span><span class="w3"></span></div>`;
}
const GLASS = glassStrip();

// ---------- Verse of the day ----------
// A daily Bible verse (plus a few short quotes from the saints), rotated
// deterministically by the Eastern date, so every visitor sees the same
// verse on a given day and a new one the next. No database, no API call:
// the list is long enough (164 entries) that it never repeats within a
// month. Verse wording is ESV.
const DAILY_VERSES = [
  { text: 'The Lord is my shepherd; I shall not want.', ref: 'Psalm 23:1' },
  { text: 'I can do all things through him who strengthens me.', ref: 'Philippians 4:13' },
  { text: 'Trust in the Lord with all your heart, and do not lean on your own understanding.', ref: 'Proverbs 3:5' },
  { text: 'For God so loved the world, that he gave his only Son, that whoever believes in him should not perish but have eternal life.', ref: 'John 3:16' },
  { text: 'God is our refuge and strength, a very present help in trouble.', ref: 'Psalm 46:1' },
  { text: 'For I know the plans I have for you, declares the Lord, plans for welfare and not for evil, to give you a future and a hope.', ref: 'Jeremiah 29:11' },
  { text: 'And we know that for those who love God all things work together for good, for those who are called according to his purpose.', ref: 'Romans 8:28' },
  { text: 'Be strong and courageous. Do not be frightened, and do not be dismayed, for the Lord your God is with you wherever you go.', ref: 'Joshua 1:9' },
  { text: 'Come to me, all who labor and are heavy laden, and I will give you rest.', ref: 'Matthew 11:28' },
  { text: 'Your word is a lamp to my feet and a light to my path.', ref: 'Psalm 119:105' },
  { text: 'They who wait for the Lord shall renew their strength; they shall mount up with wings like eagles.', ref: 'Isaiah 40:31' },
  { text: 'Love is patient and kind; love does not envy or boast; it is not arrogant.', ref: '1 Corinthians 13:4' },
  { text: 'The fruit of the Spirit is love, joy, peace, patience, kindness, goodness, faithfulness.', ref: 'Galatians 5:22' },
  { text: 'He has told you, O man, what is good; and what does the Lord require of you but to do justice, and to love kindness, and to walk humbly with your God?', ref: 'Micah 6:8' },
  { text: 'Let your light shine before others, so that they may see your good works and give glory to your Father who is in heaven.', ref: 'Matthew 5:16' },
  { text: 'Now faith is the assurance of things hoped for, the conviction of things not seen.', ref: 'Hebrews 11:1' },
  { text: 'If any of you lacks wisdom, let him ask God, who gives generously to all without reproach, and it will be given him.', ref: 'James 1:5' },
  { text: 'The Lord is my light and my salvation; whom shall I fear?', ref: 'Psalm 27:1' },
  { text: 'Casting all your anxieties on him, because he cares for you.', ref: '1 Peter 5:7' },
  { text: 'Do not be anxious about anything, but in everything by prayer and supplication with thanksgiving let your requests be made known to God.', ref: 'Philippians 4:6' },
  { text: 'The steadfast love of the Lord never ceases; his mercies never come to an end; they are new every morning; great is your faithfulness.', ref: 'Lamentations 3:22\u201323' },
  { text: 'This is the day that the Lord has made; let us rejoice and be glad in it.', ref: 'Psalm 118:24' },
  { text: 'Whatever you do, work heartily, as for the Lord and not for men.', ref: 'Colossians 3:23' },
  { text: 'But seek first the kingdom of God and his righteousness, and all these things will be added to you.', ref: 'Matthew 6:33' },
  { text: 'For God gave us a spirit not of fear but of power and love and self-control.', ref: '2 Timothy 1:7' },
  { text: 'The heavens declare the glory of God, and the sky above proclaims his handiwork.', ref: 'Psalm 19:1' },
  { text: 'Rejoice in hope, be patient in tribulation, be constant in prayer.', ref: 'Romans 12:12' },
  { text: 'Fear not, for I am with you; be not dismayed, for I am your God.', ref: 'Isaiah 41:10' },
  { text: 'Peace I leave with you; my peace I give to you.', ref: 'John 14:27' },
  { text: 'Delight yourself in the Lord, and he will give you the desires of your heart.', ref: 'Psalm 37:4' },
  { text: 'For by grace you have been saved through faith. And this is not your own doing; it is the gift of God.', ref: 'Ephesians 2:8' },
  { text: 'We love because he first loved us.', ref: '1 John 4:19' },
  { text: 'The name of the Lord is a strong tower; the righteous man runs into it and is safe.', ref: 'Proverbs 18:10' },
  { text: 'Blessed are the peacemakers, for they shall be called sons of God.', ref: 'Matthew 5:9' },
  { text: 'Oh, taste and see that the Lord is good! Blessed is the man who takes refuge in him!', ref: 'Psalm 34:8' },
  { text: 'Jesus Christ is the same yesterday and today and forever.', ref: 'Hebrews 13:8' },
  { text: 'You have made us for yourself, O Lord, and our heart is restless until it rests in you.', ref: 'St. Augustine, Confessions' },
  { text: 'Let nothing disturb you, let nothing frighten you. All things pass away. God never changes.', ref: 'St. Teresa of Avila' },
  { text: 'Not all of us can do great things. But we can do small things with great love.', ref: 'Mother Teresa' },
  { text: 'Act as if everything depended on you; trust as if everything depended on God.', ref: 'St. Ignatius of Loyola' },
  { text: 'Be still, and know that I am God.', ref: 'Psalm 46:10' },
  { text: 'When you pass through the waters, I will be with you; and through the rivers, they shall not overwhelm you.', ref: 'Isaiah 43:2' },
  { text: 'Call to me and I will answer you, and will tell you great and hidden things that you have not known.', ref: 'Jeremiah 33:3' },
  { text: 'I lift up my eyes to the hills. From where does my help come? My help comes from the Lord, who made heaven and earth.', ref: 'Psalm 121:1\u20132' },
  { text: 'Blessed are the poor in spirit, for theirs is the kingdom of heaven.', ref: 'Matthew 5:3' },
  { text: 'Blessed are those who hunger and thirst for righteousness, for they shall be satisfied.', ref: 'Matthew 5:6' },
  { text: 'You are the light of the world. A city set on a hill cannot be hidden.', ref: 'Matthew 5:14' },
  { text: 'Ask, and it will be given to you; seek, and you will find; knock, and it will be opened to you.', ref: 'Matthew 7:7' },
  { text: 'And behold, I am with you always, to the end of the age.', ref: 'Matthew 28:20' },
  { text: 'With man it is impossible, but not with God. For all things are possible with God.', ref: 'Mark 10:27' },
  { text: 'For nothing will be impossible with God.', ref: 'Luke 1:37' },
  { text: 'In the beginning was the Word, and the Word was with God, and the Word was God.', ref: 'John 1:1' },
  { text: 'I am the light of the world. Whoever follows me will not walk in darkness, but will have the light of life.', ref: 'John 8:12' },
  { text: 'I came that they may have life and have it abundantly.', ref: 'John 10:10' },
  { text: 'I am the vine; you are the branches. Whoever abides in me and I in him, he it is that bears much fruit, for apart from me you can do nothing.', ref: 'John 15:5' },
  { text: 'But God shows his love for us in that while we were still sinners, Christ died for us.', ref: 'Romans 5:8' },
  { text: 'May the God of hope fill you with all joy and peace in believing, so that by the power of the Holy Spirit you may abound in hope.', ref: 'Romans 15:13' },
  { text: 'Let all that you do be done in love.', ref: '1 Corinthians 16:14' },
  { text: 'Therefore, if anyone is in Christ, he is a new creation. The old has passed away; behold, the new has come.', ref: '2 Corinthians 5:17' },
  { text: 'And let us not grow weary of doing good, for in due season we will reap, if we do not give up.', ref: 'Galatians 6:9' },
  { text: 'Be kind to one another, tenderhearted, forgiving one another, as God in Christ forgave you.', ref: 'Ephesians 4:32' },
  { text: 'And the peace of God, which surpasses all understanding, will guard your hearts and your minds in Christ Jesus.', ref: 'Philippians 4:7' },
  { text: 'And whatever you do, in word or deed, do everything in the name of the Lord Jesus, giving thanks to God the Father through him.', ref: 'Colossians 3:17' },
  { text: 'Rejoice always, pray without ceasing, give thanks in all circumstances; for this is the will of God in Christ Jesus for you.', ref: '1 Thessalonians 5:16\u201318' },
  { text: 'I have fought the good fight, I have finished the race, I have kept the faith.', ref: '2 Timothy 4:7' },
  { text: 'Let us run with endurance the race that is set before us.', ref: 'Hebrews 12:1' },
  { text: 'Every good gift and every perfect gift is from above, coming down from the Father of lights, with whom there is no variation or shadow due to change.', ref: 'James 1:17' },
  { text: 'Humble yourselves, therefore, under the mighty hand of God so that at the proper time he may exalt you.', ref: '1 Peter 5:6' },
  { text: 'See what kind of love the Father has given to us, that we should be called children of God; and so we are.', ref: '1 John 3:1' },
  { text: 'Let the words of my mouth and the meditation of my heart be acceptable in your sight, O Lord, my rock and my redeemer.', ref: 'Psalm 19:14' },
  { text: 'Create in me a clean heart, O God, and renew a right spirit within me.', ref: 'Psalm 51:10' },
  { text: 'Bless the Lord, O my soul, and all that is within me, bless his holy name!', ref: 'Psalm 103:1' },
  { text: 'I praise you, for I am fearfully and wonderfully made.', ref: 'Psalm 139:14' },
  { text: 'The Lord is good to all, and his mercy is over all that he has made.', ref: 'Psalm 145:9' },
  { text: 'The heart of man plans his way, but the Lord establishes his steps.', ref: 'Proverbs 16:9' },
  { text: 'Iron sharpens iron, and one man sharpens another.', ref: 'Proverbs 27:17' },
  { text: 'For everything there is a season, and a time for every matter under heaven.', ref: 'Ecclesiastes 3:1' },
  { text: 'You keep him in perfect peace whose mind is stayed on you, because he trusts in you.', ref: 'Isaiah 26:3' },
  { text: 'For my thoughts are not your thoughts, neither are your ways my ways, declares the Lord.', ref: 'Isaiah 55:8' },
  { text: 'The Lord your God is in your midst, a mighty one who will save; he will rejoice over you with gladness; he will quiet you by his love; he will exult over you with loud singing.', ref: 'Zephaniah 3:17' },
  { text: 'Late have I loved you, O Beauty ever ancient, ever new.', ref: 'St. Augustine, Confessions' },
  { text: 'Do not be afraid. Open wide the doors for Christ.', ref: 'St. John Paul II' },
  { text: 'Pray, hope, and don\'t worry.', ref: 'St. Padre Pio' },
  { text: 'Be who you are and be that well.', ref: 'St. Francis de Sales' },
  { text: 'He makes me lie down in green pastures. He leads me beside still waters.', ref: 'Psalm 23:2' },
  { text: 'He restores my soul. He leads me in paths of righteousness for his name\u2019s sake.', ref: 'Psalm 23:3' },
  { text: 'Even though I walk through the valley of the shadow of death, I will fear no evil, for you are with me; your rod and your staff, they comfort me.', ref: 'Psalm 23:4' },
  { text: 'Surely goodness and mercy shall follow me all the days of my life, and I shall dwell in the house of the Lord forever.', ref: 'Psalm 23:6' },
  { text: 'So teach us to number our days that we may get a heart of wisdom.', ref: 'Psalm 90:12' },
  { text: 'For the Lord is good; his steadfast love endures forever, and his faithfulness to all generations.', ref: 'Psalm 100:5' },
  { text: 'I have stored up your word in my heart, that I might not sin against you.', ref: 'Psalm 119:11' },
  { text: 'I was glad when they said to me, \u2018Let us go to the house of the Lord!\u2019', ref: 'Psalm 122:1' },
  { text: 'In all your ways acknowledge him, and he will make straight your paths.', ref: 'Proverbs 3:6' },
  { text: 'A soft answer turns away wrath, but a harsh word stirs up anger.', ref: 'Proverbs 15:1' },
  { text: 'A joyful heart is good medicine, but a crushed spirit dries up the bones.', ref: 'Proverbs 17:22' },
  { text: 'For to us a child is born, to us a son is given; and the government shall be upon his shoulder, and his name shall be called Wonderful Counselor, Mighty God, Everlasting Father, Prince of Peace.', ref: 'Isaiah 9:6' },
  { text: 'He gives power to the faint, and to him who has no might he increases strength.', ref: 'Isaiah 40:29' },
  { text: 'Seek the Lord while he may be found; call upon him while he is near.', ref: 'Isaiah 55:6' },
  { text: 'Blessed is the man who trusts in the Lord, whose trust is the Lord.', ref: 'Jeremiah 17:7' },
  { text: 'The Lord is good to those who wait for him, to the soul who seeks him.', ref: 'Lamentations 3:25' },
  { text: 'Not by might, nor by power, but by my Spirit, says the Lord of hosts.', ref: 'Zechariah 4:6' },
  { text: 'Blessed are the pure in heart, for they shall see God.', ref: 'Matthew 5:8' },
  { text: 'For where your treasure is, there your heart will be also.', ref: 'Matthew 6:21' },
  { text: 'For where two or three are gathered in my name, there am I among them.', ref: 'Matthew 18:20' },
  { text: 'With man this is impossible, but with God all things are possible.', ref: 'Matthew 19:26' },
  { text: 'Therefore I tell you, whatever you ask in prayer, believe that you have received it, and it will be yours.', ref: 'Mark 11:24' },
  { text: 'For God did not send his Son into the world to condemn the world, but in order that the world might be saved through him.', ref: 'John 3:17' },
  { text: 'Jesus said to them, \u2018I am the bread of life; whoever comes to me shall not hunger, and whoever believes in me shall never thirst.\u2019', ref: 'John 6:35' },
  { text: 'A new commandment I give to you, that you love one another: just as I have loved you, you also are to love one another.', ref: 'John 13:34' },
  { text: 'I have said these things to you, that in me you may have peace. In the world you will have tribulation. But take heart; I have overcome the world.', ref: 'John 16:33' },
  { text: 'For the wages of sin is death, but the free gift of God is eternal life in Christ Jesus our Lord.', ref: 'Romans 6:23' },
  { text: 'Do not be conformed to this world, but be transformed by the renewal of your mind, that by testing you may discern what is the will of God, what is good and acceptable and perfect.', ref: 'Romans 12:2' },
  { text: 'So, whether you eat or drink, or whatever you do, do all to the glory of God.', ref: '1 Corinthians 10:31' },
  { text: 'So now faith, hope, and love abide, these three; but the greatest of these is love.', ref: '1 Corinthians 13:13' },
  { text: 'I have been crucified with Christ. It is no longer I who live, but Christ who lives in me. And the life I now live in the flesh I live by faith in the Son of God, who loved me and gave himself for me.', ref: 'Galatians 2:20' },
  { text: 'Now to him who is able to do far more abundantly than all that we ask or think, according to the power at work within us.', ref: 'Ephesians 3:20' },
  { text: 'Start by doing what is necessary; then do what is possible; and suddenly you are doing the impossible.', ref: 'St. Francis of Assisi' },
  { text: 'If you are what you should be, you will set the whole world ablaze.', ref: 'St. Catherine of Siena' },
  { text: 'Do not abandon yourselves to despair. We are the Easter people and hallelujah is our song.', ref: 'St. John Paul II' },
  { text: 'Holiness consists simply in doing God\u2019s will, and being just what God wants us to be.', ref: 'St. Th\u00e9r\u00e8se of Lisieux' },
  { text: 'Miss no single opportunity of making some small sacrifice, here by a smiling look, there by a kindly word; always doing the smallest right and doing it all for love.', ref: 'St. Th\u00e9r\u00e8se of Lisieux' },
  { text: 'Prayer is the best weapon we have; it is the key to God\u2019s heart.', ref: 'St. Padre Pio' },
  { text: 'It is Jesus who stirs in you the desire to do something great with your lives.', ref: 'St. John Paul II' },
  { text: 'In the evening of life, we will be judged on love alone.', ref: 'St. John of the Cross' },
  { text: 'You prepare a table before me in the presence of my enemies; you anoint my head with oil; my cup overflows.', ref: 'Psalm 23:5' },
  { text: 'One thing have I asked of the Lord, that will I seek after: that I may dwell in the house of the Lord all the days of my life, to gaze upon the beauty of the Lord and to inquire in his temple.', ref: 'Psalm 27:4' },
  { text: 'I sought the Lord, and he answered me and delivered me from all my fears.', ref: 'Psalm 34:4' },
  { text: 'As a deer pants for flowing streams, so pants my soul for you, O God.', ref: 'Psalm 42:1' },
  { text: 'For God alone my soul waits in silence; from him comes my salvation.', ref: 'Psalm 62:1' },
  { text: 'For a day in your courts is better than a thousand elsewhere. I would rather be a doorkeeper in the house of my God than dwell in the tents of wickedness.', ref: 'Psalm 84:10' },
  { text: 'Search me, O God, and know my heart! Try me and know my thoughts!', ref: 'Psalm 139:23' },
  { text: 'Let me hear in the morning of your steadfast love, for in you I trust. Make me know the way I should go, for to you I lift up my soul.', ref: 'Psalm 143:8' },
  { text: 'Whoever brings blessing will be enriched, and one who waters will himself be watered.', ref: 'Proverbs 11:25' },
  { text: 'A man of many companions may come to ruin, but there is a friend who sticks closer than a brother.', ref: 'Proverbs 18:24' },
  { text: 'And the Lord will guide you continually and satisfy your desire in scorched places and make your bones strong; and you shall be like a watered garden, like a spring of water, whose waters do not fail.', ref: 'Isaiah 58:11' },
  { text: 'The Spirit of the Lord God is upon me, because the Lord has anointed me to bring good news to the poor; he has sent me to bind up the brokenhearted, to proclaim liberty to the captives, and the opening of the prison to those who are bound.', ref: 'Isaiah 61:1' },
  { text: 'I have loved you with an everlasting love; therefore I have continued my faithfulness to you.', ref: 'Jeremiah 31:3' },
  { text: 'It is good that one should wait quietly for the salvation of the Lord.', ref: 'Lamentations 3:26' },
  { text: 'Let us know; let us press on to know the Lord; his going out is sure as the dawn; he will come to us as the showers, as the spring rains that water the earth.', ref: 'Hosea 6:3' },
  { text: 'Blessed are those who mourn, for they shall be comforted.', ref: 'Matthew 5:4' },
  { text: 'Blessed are the merciful, for they shall receive mercy.', ref: 'Matthew 5:7' },
  { text: 'Take my yoke upon you, and learn from me, for I am gentle and lowly in heart, and you will find rest for your souls.', ref: 'Matthew 11:29' },
  { text: 'And you shall love the Lord your God with all your heart and with all your soul and with all your mind and with all your strength.', ref: 'Mark 12:30' },
  { text: 'Give, and it will be given to you. Good measure, pressed down, shaken together, running over, will be put into your lap. For with the measure you use it will be measured back to you.', ref: 'Luke 6:38' },
  { text: 'He must increase, but I must decrease.', ref: 'John 3:30' },
  { text: 'Let not your hearts be troubled. Believe in God; believe also in me.', ref: 'John 14:1' },
  { text: 'I am the way, and the truth, and the life. No one comes to the Father except through me.', ref: 'John 14:6' },
  { text: 'These things I have spoken to you, that my joy may be in you, and that your joy may be full.', ref: 'John 15:11' },
  { text: 'For I consider that the sufferings of this present time are not worth comparing with the glory that is to be revealed to us.', ref: 'Romans 8:18' },
  { text: 'For I am sure that neither death nor life, nor angels nor rulers, nor things present nor things to come, nor powers, nor height nor depth, nor anything else in all creation, will be able to separate us from the love of God in Christ Jesus our Lord.', ref: 'Romans 8:38\u201339' },
  { text: 'Therefore, my beloved brothers, be steadfast, immovable, always abounding in the work of the Lord, knowing that in the Lord your labor is not in vain.', ref: '1 Corinthians 15:58' },
  { text: 'But he said to me, \u2018My grace is sufficient for you, for my power is made perfect in weakness.\u2019 Therefore I will boast all the more gladly of my weaknesses, so that the power of Christ may rest upon me.', ref: '2 Corinthians 12:9' },
  { text: 'Finally, be strong in the Lord and in the strength of his might.', ref: 'Ephesians 6:10' },
  { text: 'And I am sure of this, that he who began a good work in you will bring it to completion at the day of Jesus Christ.', ref: 'Philippians 1:6' },
  { text: 'And my God will supply every need of yours according to his riches in glory in Christ Jesus.', ref: 'Philippians 4:19' },
  { text: 'For the word of God is living and active, sharper than any two-edged sword, piercing to the division of soul and of spirit, of joints and of marrow, and discerning the thoughts and intentions of the heart.', ref: 'Hebrews 4:12' },
  { text: 'To one who has faith, no explanation is necessary. To one without faith, no explanation is possible.', ref: 'St. Thomas Aquinas' },
  { text: 'Listen carefully, my child, to the master\u2019s instructions, and attend to them with the ear of your heart.', ref: 'St. Benedict' },
  { text: 'Consult not your fears but your hopes and your dreams.', ref: 'St. John XXIII' },
  { text: 'Nothing is far from God.', ref: 'St. Monica' },
  { text: 'Be sure that you first preach by the way you live.', ref: 'St. Charles Borromeo' },
  { text: 'Let us love God, my brothers, let us love God, but let it be with the strength of our arms and the sweat of our brows.', ref: 'St. Vincent de Paul' },
  { text: 'We become what we love and who we love shapes what we become.', ref: 'St. Clare of Assisi' },
  { text: 'Prayer is the place of refuge for every worry, a foundation for cheerfulness, a source of constant happiness, a protection against sadness.', ref: 'St. John Chrysostom' },
];
// Verse pool expansion (see the requires at the top): 218 Old Testament
// verses plus 185 New Testament verses and saint quotes, for 567 entries
// in all. The rotation below is dayNum % length, so a daily visitor now
// goes over a year without seeing the same verse twice.
DAILY_VERSES.push(...EXTRA_OT_VERSES, ...EXTRA_NT_VERSES);
function dailyVerse() {
  // Eastern date, so the verse turns over at midnight for the US audience
  // and matches the date shown under it.
  const parts = new Date().toLocaleDateString('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).split('/').map(Number);
  const dayNum = Math.floor(Date.UTC(parts[2], parts[0] - 1, parts[1]) / 86400000);
  const verse = DAILY_VERSES[dayNum % DAILY_VERSES.length];
  const dateStr = new Date().toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  return { text: verse.text, ref: verse.ref, dateStr };
}

function layout(title, body, extraHead = '') {
  const description = 'Anonymous ratings of Catholic priests on pace, homily, and likability. Searchable by name, parish, city, state, or diocese.';
  // Per-request CSP nonce (audit F-02, Iteration 2), carried from the
  // header middleware via AsyncLocalStorage. Every inline script on the
  // page carries it; without it the enforcing CSP blocks the script.
  const nonce = (cspStore.getStore() || {}).nonce || '';
  const nonceAttr = nonce ? ` nonce="${nonce}"` : '';
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="description" content="${description}">
  <meta property="og:title" content="${esc(title)} | RateMyFather">
  <meta property="og:description" content="${description}">
  <meta property="og:type" content="website">
  <meta name="theme-color" content="#7a1f2b">
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <title>${esc(title)} | RateMyFather</title>
  <link rel="stylesheet" href="/style.css">${extraHead}
  <script${nonceAttr}>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('consent','default',{'analytics_storage':'denied','ad_storage':'denied','ad_user_data':'denied','ad_personalization':'denied'});</script>
  <script async src="https://www.googletagmanager.com/gtag/js?id=G-40KVER82VY"></script>
  <script${nonceAttr}>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-40KVER82VY');</script></head><body>
  <a class="skip-link" href="#main">Skip to main content</a>
  <header class="topnav"><div class="wrap nav-inner">
    <a class="brand" href="/">Rate<span class="accent">My</span>Father</a>
    <nav id="site-nav"><a href="/">Home</a><a href="/browse">Search &amp; Browse</a><a href="/games">Games</a><a href="/about">About</a><a href="/how">How ratings work</a></nav>
  </div><div class="wrap quicknav-wrap"><nav class="quicknav" aria-label="Sections"><a href="/">Home</a><a href="/browse">Search &amp; Browse</a><a href="/games">Games</a><a href="/about">About</a><a href="/how">How ratings work</a></nav></div><div class="wrap">${glassStrip('thin')}</div></header>
  <main id="main" class="wrap" tabindex="-1">${body}</main>
  <footer class="wrap site-footer">${glassStrip('gs-7')}
  <p class="footer-brand">Rate<span class="accent">My</span>Father</p>
  <p class="footer-tagline small">Anonymous ratings.</p>
  <nav class="footer-nav"><a href="/terms">Terms</a><a href="/privacy">Privacy</a><a href="/moderation">Content &amp; Moderation Policy</a><a href="/legal">Legal notices</a><a href="/owner/login">Owner moderation</a><a href="/add-priest">Add a priest</a></nav>
  <nav class="footer-nav" aria-label="Browse by region"><a href="/browse?region=Northeast">Northeast</a><a href="/browse?region=Midwest">Midwest</a><a href="/browse?region=South">South</a><a href="/browse?region=West">West</a><a href="/browse?region=Other%20listings">Other listings</a></nav>
  <p>${DISCLAIMER}</p>
  <p>No paid placement. No sponsored priests. Reviews are never sold or promoted for payment.</p></footer>
  <div id="chat-widget"><button id="chat-toggle" type="button" aria-expanded="false" aria-controls="chat-panel">Ask <span class="chat-toggle-long">about a priest</span></button>
  <div id="chat-panel" hidden role="region" aria-label="Chat about a priest"><div id="chat-log"></div>
  <form id="chat-form"><input id="chat-input" name="message" placeholder="e.g. Who is rated for a quick Mass?" required>
  <button type="submit">Ask</button></form>
  <p class="small">Answers use approved-review averages with review counts only. Individual reviews are never quoted.</p></div></div>
  <script src="/chat.js"></script><script src="/places.js"></script><script src="/saved.js"></script>
  <script${nonceAttr}>(function(){var h=document.querySelector('.topnav');if(!h)return;h.querySelectorAll('nav a').forEach(function(a){if(a.pathname===location.pathname)a.setAttribute('aria-current','page');});})();</script></body></html>`;
}
function page(title, inner, extraHead = '') { return layout(title, inner, extraHead); }
// ` nonce="..."` for an inline script tag rendered outside layout()
// (the per-page JSON blobs and the games fallback script). Reads the
// per-request nonce from the same AsyncLocalStorage the header
// middleware set; empty outside a request, which never happens for a
// rendered page.
function cspNonceAttr() {
  const nonce = (cspStore.getStore() || {}).nonce || '';
  return nonce ? ` nonce="${nonce}"` : '';
}
// ---------- error pages with a playable game ----------
// The error pages are fully self-contained: inline CSS and inline JS, no
// external assets (no /style.css, no /mural.jpg, no /chat.js). That is
// deliberate. When the server is overloaded, a follow-up request for a
// stylesheet or script may fail, but this one response still plays.
// The game is "The Lost Sheep": sheep pop out of the bushes and you tap them
// to round them up, minding the wolf. It is new — none of the eight arcade
// games is a tap-the-target roundup — and it is client side only: no fetch,
// no database, no server calls of any kind. Best score lives in
// localStorage only, and the page echoes no user input.
const ERROR_CSS = `
  :root{--bg:#faf6ec;--surface:#fffdf7;--text:#2a211a;--dim:#6e5d4b;--border:#e0d3bc;
    --accent:#6e1a26;--accent-hover:#521219;--gold:#b28a2e;--lead:#33261a;--green:#2e5e4e;}
  *{box-sizing:border-box}
  [hidden]{display:none!important}
  body{margin:0;background:var(--bg);color:var(--text);
    font-family:"Avenir Next","Segoe UI",system-ui,-apple-system,"Helvetica Neue",Arial,sans-serif;
    font-size:16px;line-height:1.6}
  a{color:var(--accent)}
  .wrap{max-width:680px;margin:0 auto;padding:0 20px}
  header{padding:28px 0 0;text-align:center}
  .brand{font-family:Georgia,"Times New Roman",Times,serif;font-size:30px;font-weight:700;
    color:var(--text);text-decoration:none;letter-spacing:-.02em}
  .brand span{color:var(--accent)}
  .glass{display:flex;height:10px;border:2px solid var(--lead);border-radius:6px;overflow:hidden;margin:14px auto 0}
  .glass i{flex:1;display:block}
  .glass i:nth-child(1){background:#6e1a26}.glass i:nth-child(2){background:#b28a2e}
  .glass i:nth-child(3){background:#2e5e4e}.glass i:nth-child(4){background:#3a5a8a}
  .glass i:nth-child(5){background:#b8452a}
  main{padding:36px 0 64px}
  h1{font-family:Georgia,"Times New Roman",Times,serif;font-size:32px;line-height:1.15;margin:0 0 10px}
  p{margin:12px 0 0}
  .card{background:var(--surface);border:1px solid var(--border);border-radius:16px;
    box-shadow:0 1px 3px rgb(43 33 24/.05),0 14px 34px -18px rgb(43 33 24/.22);
    padding:22px;margin-top:20px}
  .btn{display:inline-block;background:var(--accent);color:#fff;text-decoration:none;
    font-weight:600;padding:10px 18px;border-radius:999px;border:0;cursor:pointer;font-size:16px}
  .btn:hover{background:var(--accent-hover)}
  .btn-secondary{background:transparent;color:var(--accent);border:1.5px solid var(--accent)}
  .btn-secondary:hover{background:#f5e6e2}
  .btnrow{margin-top:16px;display:flex;gap:10px;flex-wrap:wrap}
  .small{font-size:14px;color:var(--dim)}
  .search{display:flex;gap:8px;margin-top:14px}
  .search input{flex:1;min-width:0;padding:10px 12px;border:1.5px solid var(--border);border-radius:999px;font-size:16px;background:#fff}
  .game-head{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:baseline}
  .game-head h2{margin:0;font-family:Georgia,"Times New Roman",Times,serif;font-size:24px}
  .game-score{font-weight:700}
  .game-time{font-variant-numeric:tabular-nums;font-weight:700}
  .game-bar{height:8px;background:#f1e8d8;border-radius:4px;margin-top:10px;overflow:hidden}
  .game-bar i{display:block;height:100%;background:var(--gold);width:100%}
  .game-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:16px}
  .game-cell{aspect-ratio:1/1;border:1.5px solid var(--border);border-radius:14px;background:#f1e8d8;
    font-size:44px;line-height:1;cursor:pointer;touch-action:manipulation;position:relative;overflow:hidden;
    -webkit-tap-highlight-color:transparent;user-select:none;padding:0}
  .game-cell:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
  .game-cell.pop{animation:pop .18s ease-out}
  @keyframes pop{0%{transform:scale(.6)}100%{transform:scale(1)}}
  .game-cell.caught{animation:caught .25s ease-out}
  @keyframes caught{0%{transform:scale(1)}50%{transform:scale(1.25)}100%{transform:scale(1)}}
  .game-cell.gold{background:#f7e8b8;border-color:var(--gold)}
  .diff-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:14px}
  .diff-row .lbl{font-size:11px;font-weight:700;letter-spacing:.22em;text-transform:uppercase;color:var(--dim)}
  .diff-btn{padding:7px 14px;border-radius:999px;border:1.5px solid var(--border);background:#fff;font-weight:600;cursor:pointer;font-size:14px;color:var(--text)}
  .diff-btn.on{background:var(--accent);border-color:var(--accent);color:#fff}
  .game-grid.shake{animation:shake .3s ease-out}
  @keyframes shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-5px)}75%{transform:translateX(5px)}}
  .float-points{position:absolute;left:0;right:0;top:6px;text-align:center;font-size:20px;font-weight:800;color:var(--green);pointer-events:none;animation:floatUp .7s ease-out forwards}
  @keyframes floatUp{0%{opacity:1;transform:translateY(0)}100%{opacity:0;transform:translateY(-26px)}}
  .wolf-flash{color:#b3261e}
  .game-streak{color:var(--gold)}
  .kbd-hint{font-size:13px;color:var(--dim)}
  @media (hover:none),(pointer:coarse){.kbd-hint{display:none}}
  .game-overlay{text-align:center;padding:18px 0 4px}
  .game-overlay p{margin:8px 0 0}
  footer{padding:0 0 40px;text-align:center}
`;
// The Lost Sheep game. Written with string concatenation only (no template
// literals, no ${}) so it can live inside the error page template safely.
const LOST_SHEEP_SCRIPT = `
(function () {
  var grid = document.getElementById('sheep-grid');
  if (!grid) return;
  var scoreEl = document.getElementById('sheep-score');
  var bestEl = document.getElementById('sheep-best');
  var streakEl = document.getElementById('sheep-streak');
  var timeEl = document.getElementById('sheep-time');
  var barEl = document.getElementById('sheep-bar');
  var startBtn = document.getElementById('sheep-start');
  var againBtn = document.getElementById('sheep-again');
  var startPanel = document.getElementById('sheep-start-panel');
  var endPanel = document.getElementById('sheep-end-panel');
  var endText = document.getElementById('sheep-end-text');
  var ROUND_MS = 45000;
  // Difficulty, Easy / Medium / Hard like the arcade games. Medium is the
  // game as it plays today. The choice is remembered in this browser.
  var DIFFS = {
    easy: { pop: 850, visible: 1150, wolf: 0.10, doubleAfter: 30000 },
    medium: { pop: 700, visible: 900, wolf: 0.15, doubleAfter: 22500 },
    hard: { pop: 550, visible: 700, wolf: 0.20, doubleAfter: 0 }
  };
  var diff = 'medium';
  try {
    var savedDiff = window.localStorage.getItem('rmf_lost_sheep_diff');
    if (savedDiff === 'easy' || savedDiff === 'hard') diff = savedDiff;
  } catch (e) {}
  var cells = [];
  var score = 0, best = 0, streak = 0, bestStreak = 0, timeLeft = ROUND_MS, timer = null, popTimer = null, endAt = 0, running = false;
  try { best = parseInt(window.localStorage.getItem('rmf_lost_sheep_best') || '0', 10) || 0; } catch (e) { best = 0; }
  bestEl.textContent = String(best);
  var SHEEP = '\\uD83D\\uDC11';
  var WOLF = '\\uD83D\\uDC3A';
  var BUSH = '\\uD83C\\uDF3F';
  // Desktop keyboards get the key hints and the 1-9 shortcuts; phones and
  // tablets get touch only. Same fine-pointer-plus-hover check as the arcade.
  var _hasKeyboard = null;
  function hasKeyboard() {
    if (_hasKeyboard === null) {
      try {
        _hasKeyboard = (typeof matchMedia === 'function') ? matchMedia('(pointer: fine) and (hover: hover)').matches : true;
      } catch (e) { _hasKeyboard = true; }
    }
    return _hasKeyboard;
  }
  function fmt(ms) {
    var s = Math.ceil(ms / 1000);
    return '0:' + (s < 10 ? '0' + s : String(s));
  }
  function applyDiffButtons() {
    var btns = document.querySelectorAll('.sheep-diff-btn');
    for (var i = 0; i < btns.length; i++) {
      var on = btns[i].getAttribute('data-diff') === diff;
      btns[i].setAttribute('aria-pressed', on ? 'true' : 'false');
      if (on) btns[i].classList.add('on'); else btns[i].classList.remove('on');
    }
  }
  function wireDiffButtons() {
    var btns = document.querySelectorAll('.sheep-diff-btn');
    for (var i = 0; i < btns.length; i++) {
      btns[i].addEventListener('click', function (ev) {
        var d = ev.currentTarget.getAttribute('data-diff');
        if (d === 'easy' || d === 'medium' || d === 'hard') {
          diff = d;
          try { window.localStorage.setItem('rmf_lost_sheep_diff', d); } catch (e) {}
          applyDiffButtons();
        }
      });
    }
  }
  function buildGrid() {
    for (var i = 0; i < 9; i++) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'game-cell';
      b.textContent = BUSH;
      b.setAttribute('aria-label', 'Bush ' + (i + 1));
      b.addEventListener('click', onTap);
      grid.appendChild(b);
      cells.push({ el: b, kind: null, idx: i, popSeq: 0 });
    }
  }
  function clearCell(cell) {
    cell.kind = null;
    cell.el.textContent = BUSH;
    cell.el.classList.remove('gold');
    cell.el.setAttribute('aria-label', 'Bush ' + (cell.idx + 1));
  }
  function floatPoints(el, pts) {
    var s = document.createElement('span');
    s.className = 'float-points';
    s.textContent = '+' + pts;
    s.setAttribute('aria-hidden', 'true');
    el.appendChild(s);
    setTimeout(function () { if (s.parentNode) s.parentNode.removeChild(s); }, 750);
  }
  function flashWolf() {
    grid.classList.remove('shake');
    void grid.offsetWidth;
    grid.classList.add('shake');
    scoreEl.classList.remove('wolf-flash');
    void scoreEl.offsetWidth;
    scoreEl.classList.add('wolf-flash');
    setTimeout(function () {
      grid.classList.remove('shake');
      scoreEl.classList.remove('wolf-flash');
    }, 500);
  }
  function onTap(ev) {
    if (!running) return;
    var cell = null;
    for (var i = 0; i < cells.length; i++) {
      if (cells[i].el === ev.currentTarget) { cell = cells[i]; break; }
    }
    if (!cell || !cell.kind) return;
    var wasGold = cell.kind === 'gold';
    var wasWolf = cell.kind === 'wolf';
    clearCell(cell);
    if (wasWolf) {
      score = Math.max(0, score - 1);
      streak = 0;
      streakEl.textContent = '0';
      scoreEl.textContent = String(score);
      flashWolf();
    } else {
      streak += 1;
      if (streak > bestStreak) bestStreak = streak;
      var pts = (wasGold ? 3 : 1) + Math.min(3, Math.floor(streak / 5));
      score += pts;
      scoreEl.textContent = String(score);
      streakEl.textContent = String(streak);
      cell.el.classList.remove('caught');
      void cell.el.offsetWidth;
      cell.el.classList.add('caught');
      floatPoints(cell.el, pts);
    }
  }
  function popOne() {
    if (!running) return;
    var free = [];
    for (var i = 0; i < cells.length; i++) { if (!cells[i].kind) free.push(cells[i]); }
    if (!free.length) return;
    var cell = free[Math.floor(Math.random() * free.length)];
    var cfg = DIFFS[diff];
    var roll = Math.random();
    var kind = 'sheep';
    if (roll < cfg.wolf) kind = 'wolf';
    else if (roll < cfg.wolf + 0.06) kind = 'gold';
    cell.kind = kind;
    cell.popSeq += 1;
    var myPop = cell.popSeq;
    cell.el.textContent = kind === 'wolf' ? WOLF : SHEEP;
    if (kind === 'gold') cell.el.classList.add('gold');
    var label = kind === 'wolf' ? 'Wolf! Do not tap.' : (kind === 'gold' ? 'Golden sheep! Worth three.' : 'Sheep! Tap to catch it.');
    if (kind !== 'wolf' && hasKeyboard()) label = (kind === 'gold' ? 'Golden sheep in bush ' : 'Sheep in bush ') + (cell.idx + 1) + '! Tap it, or press ' + (cell.idx + 1) + '.';
    cell.el.setAttribute('aria-label', label);
    cell.el.classList.remove('pop');
    void cell.el.offsetWidth;
    cell.el.classList.add('pop');
    var elapsed = ROUND_MS - timeLeft;
    var visible = cfg.visible - Math.min(300, elapsed / 150);
    setTimeout(function () {
      if (cell.kind && cell.popSeq === myPop) clearCell(cell);
    }, visible);
  }
  function schedulePop() {
    var cfg = DIFFS[diff];
    var elapsed = ROUND_MS - timeLeft;
    var interval = Math.max(380, cfg.pop - Math.min(200, elapsed / 150));
    popTimer = setTimeout(function () {
      if (!running) return;
      popOne();
      if (elapsed > cfg.doubleAfter && Math.random() < 0.35) popOne();
      schedulePop();
    }, interval);
  }
  function tick() {
    timeLeft = Math.max(0, endAt - Date.now());
    timeEl.textContent = fmt(timeLeft);
    barEl.style.width = (timeLeft / ROUND_MS * 100).toFixed(1) + '%';
    if (timeLeft <= 0) { endGame(); return; }
    timer = setTimeout(tick, 100);
  }
  function verdict(n) {
    if (n >= 20) return 'Legendary Shepherd - the whole flock, home before dark.';
    if (n >= 15) return 'Master Shepherd. Not one sheep left behind.';
    if (n >= 10) return 'A fine shepherd - the flock trusts you.';
    if (n >= 5) return 'A steady shepherd. The flock is mostly home.';
    return 'The flock is still wandering. Give it another round.';
  }
  function startGame() {
    score = 0;
    streak = 0;
    bestStreak = 0;
    scoreEl.textContent = '0';
    streakEl.textContent = '0';
    scoreEl.classList.remove('wolf-flash');
    grid.classList.remove('shake');
    timeLeft = ROUND_MS;
    timeEl.textContent = fmt(timeLeft);
    barEl.style.width = '100%';
    startPanel.hidden = true;
    endPanel.hidden = true;
    running = true;
    endAt = Date.now() + ROUND_MS;
    tick();
    schedulePop();
  }
  function endGame() {
    running = false;
    clearTimeout(timer);
    clearTimeout(popTimer);
    for (var i = 0; i < cells.length; i++) { clearCell(cells[i]); }
    var isBest = score > 0 && score > best;
    if (isBest) {
      best = score;
      try { window.localStorage.setItem('rmf_lost_sheep_best', String(best)); } catch (e) {}
      bestEl.textContent = String(best);
    }
    var msg = 'Time! You rounded up ' + score + ' sheep. ' + verdict(score);
    if (bestStreak >= 5) msg += ' Best streak: ' + bestStreak + ' in a row.';
    if (isBest) msg += ' A new best!';
    endText.textContent = msg;
    endPanel.hidden = false;
  }
  function onKey(e) {
    var t = (e && e.target) || document.activeElement;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    var k = e.key;
    if ((k === ' ' || k === 'Enter') && !running) {
      if (t && t.tagName === 'BUTTON') return;
      e.preventDefault();
      startGame();
      return;
    }
    if (!running) return;
    if (k >= '1' && k <= '9') {
      var cell = cells[parseInt(k, 10) - 1];
      if (cell) onTap({ currentTarget: cell.el });
    }
  }
  if (!hasKeyboard()) {
    var hints = document.querySelectorAll('.kbd-hint');
    for (var i = 0; i < hints.length; i++) { hints[i].hidden = true; }
  }
  document.addEventListener('keydown', onKey);
  startBtn.addEventListener('click', startGame);
  againBtn.addEventListener('click', startGame);
  wireDiffButtons();
  applyDiffButtons();
  buildGrid();
  // The 500 page's "Try again" button (id err-retry) is wired here
  // instead of an inline onclick attribute: inline event handlers are
  // blocked by the enforcing CSP, and this script is the only script
  // on the error page.
  var retryBtn = document.getElementById('err-retry');
  if (retryBtn) retryBtn.addEventListener('click', function () { location.reload(); });
})();
`;
// One self-contained error page for both cases. opts: title, heading,
// message, actions (HTML for the recovery buttons). Same game on both; only
// the message fits the situation.
// CSP for the self-contained error pages (audit F-02, Iteration 2).
// The error pages deliberately ship inline CSS + JS with no external
// assets, so they cannot use the per-request nonce: the page is built
// by errorPage(), which runs outside the normal layout. Instead the
// two exact blocks are pinned by SHA-256 hash in a separate CSP header
// that OVERRIDES the main nonce CSP on error responses (see the
// notFoundPage / errorPage send sites, which set this header before
// sending). The hashes are computed at boot from the exact strings
// inserted into the page, so they can never go stale: if
// ERROR_CSS or LOST_SHEEP_SCRIPT changes, the header changes with it.
// style-src keeps 'unsafe-inline' (same accepted residual as the main
// CSP). The inline `onclick` handlers that used to live on these pages
// are gone — the 500 retry button is wired in LOST_SHEEP_SCRIPT and
// the games fallback uses addEventListener — because inline event
// handlers need 'unsafe-inline' in script-src, which we do not ship.
let _errorCsp = null;
function errorCspHeader() {
  if (!_errorCsp) {
    const cssHash = crypto.createHash('sha256').update(ERROR_CSS).digest('base64');
    const jsHash = crypto.createHash('sha256').update(LOST_SHEEP_SCRIPT).digest('base64');
    _errorCsp = [
      "default-src 'self'",
      `script-src 'self' 'sha256-${jsHash}'`,
      `style-src 'self' 'unsafe-inline' 'sha256-${cssHash}'`,
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; ');
  }
  return _errorCsp;
}
// Send an error page with its hash-based CSP instead of the main nonce
// CSP. Call sites: app.param 404, priest-profile 404s, the global
// 500 handler, and the catch-all 404.
function sendErrorPage(res, status, html) {
  res.setHeader('Content-Security-Policy', errorCspHeader());
  return res.status(status).send(html);
}
function errorPage(opts) {
  var body = '<header class="wrap"><a class="brand" href="/">Rate<span>My</span>Father</a>'
    + '<div class="glass" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div></header>'
    + '<main class="wrap"><h1>' + esc(opts.heading) + '</h1><p>' + esc(opts.message) + '</p>'
    + opts.actions
    + '<section class="card" aria-label="The Lost Sheep game">'
    + '<div class="game-head"><h2>The Lost Sheep</h2><span class="game-score">Sheep: <span id="sheep-score">0</span> &middot; Best: <span id="sheep-best">0</span> &middot; Streak: <span id="sheep-streak" class="game-streak">0</span></span><span class="game-time" id="sheep-time">0:45</span></div>'
    + '<div class="game-bar" aria-hidden="true"><i id="sheep-bar"></i></div>'
    + '<div class="diff-row"><span class="lbl">Difficulty</span><button type="button" class="diff-btn sheep-diff-btn" data-diff="easy" aria-pressed="false">Easy</button><button type="button" class="diff-btn sheep-diff-btn" data-diff="medium" aria-pressed="true">Medium</button><button type="button" class="diff-btn sheep-diff-btn" data-diff="hard" aria-pressed="false">Hard</button></div>'
    + '<div class="game-grid" id="sheep-grid"></div>'
    + '<div class="game-overlay" id="sheep-start-panel"><p>Sheep pop out of the bushes. Tap one to round it up. A golden sheep is worth 3, and catching sheep in a row builds your streak: every 5 in a row adds a bonus point per sheep. Mind the wolf &mdash; tapping him costs a sheep and breaks your streak.</p><p class="kbd-hint">On a computer, keys 1 to 9 catch the sheep in each bush. Space starts a round.</p><p><button class="btn" id="sheep-start" type="button">Start rounding them up</button></p></div>'
    + '<div class="game-overlay" id="sheep-end-panel" hidden><p id="sheep-end-text"></p><p><button class="btn" id="sheep-again" type="button">Play again</button></p></div>'
    + '</section>'
    + '<p class="small"><a href="/">Home</a> &middot; <a href="/browse">Browse priests</a> &middot; <a href="/games">Arcade</a> &middot; <a href="/about">About</a></p>'
    + '</main><footer class="wrap small">Reviews are individual users&rsquo; opinions, not statements of fact, and are not verified or endorsed by RateMyFather.</footer>'
    + '<script>' + LOST_SHEEP_SCRIPT + '</script>';
  return '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">'
    + '<title>' + esc(opts.title) + ' | RateMyFather</title>'
    + '<meta name="description" content="RateMyFather — anonymous ratings of Catholic priests.">'
    + '<style>' + ERROR_CSS + '</style></head><body>' + body + '</body></html>';
}
// A 404 that helps the visitor recover: search box, browse, games, add.
// Used for bad ids and for priest profiles that do not exist. Now a
// self-contained page with the Lost Sheep game, so a visitor who followed a
// dead link gets something to do instead of a dead end.
function notFoundPage() {
  return errorPage({
    title: 'Not found',
    heading: 'We could not find that page',
    message: 'The link may be mistyped, or the priest may not be listed. Try searching by name, parish, or city — or play a quick round while you are here.',
    actions: `<form action="/browse" method="get"><div class="search">
      <input name="q" placeholder="Search by name, parish, or city" aria-label="Search">
      <button class="btn" type="submit">Search</button>
    </div></form>
    <div class="btnrow"><a class="btn" href="/browse">Browse all priests</a> <a class="btn btn-secondary" href="/games">Play the arcade</a></div>
    <p class="small">If the priest is not listed, you can <a href="/add-priest">submit them for moderation review</a>.</p>`,
  });
}

// ---------- owner auth (server side) ----------
// Session signing still uses OWNER_SECRET as the HMAC key: separating
// it into its own SESSION_SECRET needs a Render env-var decision by
// the owner, so that is deliberately deferred (Iteration 2 record) —
// no new secret is created, set, or recorded here. What Iteration 2
// does change: the payload now carries a random session id (sid), and
// verifySession checks it against the owner_sessions table
// (migration 010), so logout — which deletes the row — actually
// revokes the session. The session is deliberately NOT bound to IP or
// User-Agent: the owner moves between networks, and binding would log
// him out on every network change. Lifetime stays 12 hours.
function signSession(payload) {
  const b = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', OWNER_SECRET).update(b).digest('hex');
  return b + '.' + sig;
}
// Verify the HMAC and decode the payload, or null if the cookie is not
// a well-formed session signed with OWNER_SECRET. No database involved.
function parseSession(cookieHeader) {
  if (!OWNER_SECRET || !cookieHeader) return null;
  const m = /(?:^|;\s*)__Host-rmf_owner=([^;]+)/.exec(cookieHeader);
  if (!m) return null;
  const [b, sig] = m[1].split('.');
  if (!b || !sig) return null;
  const expected = crypto.createHmac('sha256', OWNER_SECRET).update(b).digest('hex');
  let ok = false;
  try { ok = Buffer.from(sig).length === Buffer.from(expected).length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)); } catch { ok = false; }
  if (!ok) return null;
  try {
    const payload = JSON.parse(Buffer.from(b, 'base64url').toString('utf8'));
    if (!payload || !payload.exp || payload.exp <= Date.now()) return null;
    return payload;
  } catch { return null; }
}
// A session is valid only if the signature checks, it has not expired,
// AND its sid is present in owner_sessions. A missing row means the
// session was logged out (or never existed), so it is rejected even
// though the signature is still good for up to 12 hours.
async function verifySession(cookieHeader) {
  const payload = parseSession(cookieHeader);
  if (!payload || !payload.sid) return false;
  try {
    const { rows } = await pool.query('SELECT 1 FROM owner_sessions WHERE sid=$1 AND expires_at > NOW() LIMIT 1', [payload.sid]);
    return rows.length > 0;
  } catch (e) {
    console.error('owner session check failed', e.message);
    return false;
  }
}
async function isOwner(req) { return verifySession(req.headers.cookie || ''); }
// Refuses non-owners BEFORE touching data. Used on every moderation route.
async function requireOwner(req, res, next) {
  try {
    if (!OWNER_SECRET) return res.status(403).send(page('Forbidden', '<h1>Moderation unavailable</h1><p>Owner moderation is not configured on this deployment.</p>'));
    if (!(await isOwner(req))) return res.status(403).send(page('Forbidden', '<h1>Owner access required</h1><p>This area is owner-only. <a href="/owner/login">Sign in as owner</a>.</p>'));
    next();
  } catch (e) { next(e); }
}
async function audit(action, targetType, targetId, detail) {
  try { await pool.query('INSERT INTO moderation_audit (action, target_type, target_id, detail) VALUES ($1,$2,$3,$4)', [action, targetType, targetId, detail || null]); } catch (e) { console.error('audit failed', e.message); }
}

// ---------- public pages ----------
app.get('/', async (req, res) => {
  const regions = ['Northeast', 'Midwest', 'South', 'West', 'Other listings'];
  const regionHtml = regions.map((r) => `<li><a href="/browse?region=${encodeURIComponent(r)}">${r}</a></li>`).join('');
  const searchIcon = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><line x1="16.5" y1="16.5" x2="21" y2="21"/></svg>`;
  // Verse of the day: same verse for every visitor on a given day, a new
  // one tomorrow. Computed from the Eastern date, no database involved.
  const verse = dailyVerse();
  const verseHtml = `<section class="home-section verse-of-day">
    <div class="band">
    <p class="eyebrow">Verse of the day</p>
    <blockquote class="verse-text">&ldquo;${esc(verse.text)}&rdquo;</blockquote>
    <p class="verse-ref">${esc(verse.ref)}</p>
    <div class="rule" aria-hidden="true"><span></span></div>
    <p class="verse-date">${esc(verse.dateStr)} &middot; A new verse every day</p>
    </div>
    </section>`;
  // Highest rated: real data only, top 3 by overall average among rated
  // priests. The section is omitted entirely when nobody is rated yet.
  let topRated = '';
  try {
    const { rows } = await pool.query(
      `SELECT p.*, COUNT(r.id)::int AS n, AVG(r.pace) AS pace, AVG(r.homily) AS homily, AVG(r.likability) AS likability,
              (AVG(r.pace) + AVG(r.homily) + AVG(r.likability)) / 3 AS overall
       FROM priests p JOIN reviews r ON r.priest_id = p.id AND r.status='approved'
       WHERE p.status='approved' AND ${ACTIVE_WHERE_P} GROUP BY p.id ORDER BY overall DESC, COUNT(r.id) DESC LIMIT 3`);
    if (rows.length) {
      topRated = `<section class="home-section">
    <div class="section-head">
    <p class="eyebrow">By overall average</p>
    <h2>Highest rated</h2>
    <p class="lede">The best-reviewed priests in the directory, by overall average. Every score carries its review count.</p>
    </div>
    <div class="cards">${rows.map((p) => priestCard(p, { n: p.n, pace: p.pace, homily: p.homily, likability: p.likability })).join('')}</div>
    </section>`;
    }
  } catch (e) { console.error('top-rated query failed', e.message); }
  // Freshly rated: the most recently rated priests, most recent
  // first. Rendered only when at least one approved review exists.
  let freshHtml = '';
  try {
    const { rows } = await pool.query(
      `SELECT p.*, COUNT(r.id)::int AS n, AVG(r.pace) AS pace, AVG(r.homily) AS homily, AVG(r.likability) AS likability, MAX(r.created_at) AS latest
       FROM priests p JOIN reviews r ON r.priest_id = p.id AND r.status='approved'
       WHERE p.status='approved' AND ${ACTIVE_WHERE_P} GROUP BY p.id ORDER BY latest DESC LIMIT 3`);
    if (rows.length) {
      freshHtml = `<section class="home-section">
    <div class="section-head">
    <p class="eyebrow">Just rated</p>
    <h2>Recently rated</h2>
    <p class="lede">The most recently rated priests in the directory, most recent first. Every score carries its review count.</p>
    </div>
    <div class="cards">${rows.map((p) => priestCard(p, { n: p.n, pace: p.pace, homily: p.homily, likability: p.likability }) + `<p class="small fresh-date">Rated ${new Date(p.latest).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</p>`).join('')}</div>
    </section>`;
    }
  } catch (e) { console.error('fresh-from-pews query failed', e.message); }
  // Be the first to rate: three states with no published reviews at all,
  // rotated by day of year so the section changes daily. One real directory
  // priest from each. Nothing here is rated; the section is an invitation.
  let firstHtml = '';
  try {
    const { rows: states } = await pool.query(
      `SELECT p.state, COUNT(*)::int AS n FROM priests p WHERE p.status='approved' AND ${ACTIVE_WHERE_P} AND p.state IS NOT NULL AND p.state <> '' AND NOT EXISTS (SELECT 1 FROM reviews r JOIN priests p2 ON p2.id = r.priest_id WHERE r.status='approved' AND p2.state = p.state) GROUP BY p.state ORDER BY n DESC`);
    if (states.length) {
      const doy = Math.floor((Date.now() - Date.UTC(new Date().getUTCFullYear(), 0, 0)) / 86400000);
      const count = Math.min(3, states.length);
      const picked = Array.from({ length: count }, (_, i) => states[(doy + i) % states.length]);
      const priests = [];
      for (const s of picked) {
        const { rows: pr } = await pool.query(`SELECT * FROM priests WHERE status='approved' AND ${ACTIVE_WHERE} AND state=$1 ORDER BY RANDOM() LIMIT 1`, [s.state]);
        if (pr.length) priests.push(pr[0]);
      }
      if (priests.length) {
        const names = picked.map((s) => stateName(s.state)).join(', ');
        firstHtml = `<section class="home-section">
    <div class="section-head">
    <p class="eyebrow">Be the first</p>
    <h2>No ratings yet — be the first</h2>
    <p class="lede">No priest in ${esc(names)} has a published review yet. Pick one, go to Mass, and leave the first rating.</p>
    </div>
    <div class="cards">${priests.map((p) => priestCard(p, null)).join('')}</div>
    </section>`;
      }
    }
  } catch (e) { console.error('be-first query failed', e.message); }
  // Daily trivia: three questions drawn from the pool by the Eastern
  // date, so every visitor gets the same round today and a new one
  // tomorrow. The day's board comes from trivia_daily_scores: the top
  // five names and points, most points first, fastest time breaking
  // ties. When nobody has played yet the section says so instead of
  // showing a 0.
  const triviaRound = dailyTriviaQuestions();
  let triviaTop = [];
  try {
    const { rows: tt } = await pool.query(`SELECT name, points, correct, ms FROM trivia_daily_scores WHERE day=$1 ORDER BY points DESC, ms ASC LIMIT 5`, [triviaRound.date]);
    triviaTop = tt;
  } catch (e) { console.error('trivia board query failed', e.message); }
  const triviaBest = triviaTop[0] || null;
  const triviaBestLine = triviaBest
    ? `Today's best: ${triviaBest.name} — ${triviaBest.points.toLocaleString()} points (${triviaBest.correct} of 3 right, ${Math.round(triviaBest.ms / 1000)} seconds).`
    : 'No one has played today yet. Be the first.';
  const triviaBoardHtml = `<ol class="trivia-board" id="trivia-board">${triviaTop.map((r, i) => `<li><span class="trivia-rank">${i + 1}</span><span class="trivia-board-name">${esc(r.name)}</span><span class="trivia-board-points">${r.points.toLocaleString()} pts</span></li>`).join('')}</ol>`;
  const triviaSectionHtml = `<section class="home-section" id="trivia">
    <div class="section-head">
    <p class="eyebrow">Daily trivia</p>
    <h2>Test your faith, three questions</h2>
    <p class="lede">Three questions on saints, scripture, Church history, liturgy, and the sacraments. A new round every day. Answer fast: each right answer is worth up to 1,000 points, and the quicker you answer, the more you earn. One shared leaderboard for the day.</p>
    </div>
    <p class="trivia-best" id="trivia-best">${esc(triviaBestLine)}</p>
    ${triviaBoardHtml}
    <p class="trivia-name-row"><label for="trivia-name">Your name for the leaderboard</label><input id="trivia-name" type="text" maxlength="20" autocomplete="off" placeholder="First name or nickname"></p>
    <p><button type="button" class="btn btn--gold btn-pill press" id="trivia-start">Start the trivia</button></p>
    <div id="trivia-panel" aria-live="polite"></div>
    <script${cspNonceAttr()}>window.RMF_TRIVIA = ${JSON.stringify(triviaRound).replace(/</g, '\\u003c')};</script>
    <script src="/trivia.js?v=${TRIVIA_VERSION}"></script>
    </section>`;
  // Find by place: state, then city, then diocese. The selects are
  // server-rendered (see placeOptions) and enhanced by places.js.
  const placeOpts = await placeOptions('', '', '');
  const placeSectionHtml = `<section class="home-section">
    <div class="section-head">
    <p class="eyebrow">Find by place</p>
    <h2>Find a priest by place</h2>
    <p class="lede">Pick a state, then a city, then a diocese. Type in any box to search the list.</p>
    </div>
    <form action="/browse" method="get">
    ${placeFiltersHtml(placeOpts, '', '', '', false)}
    <p class="section-more"><button type="submit" class="btn btn--gold btn-pill press">Browse priests</button></p>
    </form>
    </section>`;
  res.send(page('Home', `
    <section class="hero">
      <div class="hero-photo">
        <div class="hero-copy">
          <p class="hero-kicker">Catholic priest ratings</p>
          <h1>Find your Father.<br><span class="accent">Rate your Mass.</span></h1>
          <p class="tagline">Anonymous ratings of pace, homily, and likability, from the pews.</p>
          <form action="/browse" method="get" class="hero-search">
            <div class="search">
              <span class="search-field">${searchIcon}<input name="q" placeholder="Search by name, parish, or city" aria-label="Search by name, parish, or city" enterkeyhint="search"></span>
              <button type="submit">Search</button>
            </div>
          </form>
          <p class="hero-assurance"><span>Anonymous</span><span>No account needed</span><span>Free, always</span></p>
        </div>
      </div>
    </section>${GLASS}
    ${verseHtml}
    ${placeSectionHtml}
    <section class="home-section band">
    <div class="section-head">
    <p class="eyebrow">The directory</p>
    <h2>Browse by region</h2>
    <p class="lede">Pick a corner of the country to start, then narrow it down by state, city, or diocese.</p>
    </div>
    <ul class="regions">${regionHtml}</ul>
    <p class="section-more"><a href="/browse">Search the whole directory &rsaquo;</a> &middot; <a href="/saved">Saved priests</a></p>
    </section>
    <section class="home-section">
    <div class="section-head">
    <p class="eyebrow">What matters to you</p>
    <h2>Find priests by what matters to you</h2>
    <p class="lede">Category lists show rated priests only, sorted by that category average, highest first, with review counts always shown.</p>
    </div>
    <div class="cat-grid">
      <div class="cat-card card--ruled card-lift"><h3>Quick Mass</h3><p>Priests whose Sunday Mass moves briskly, ranked by pace. Pace is speed only, never a quality grade.</p><a href="/browse?filter=quick">Browse Quick Mass &rsaquo;</a></div>
      <div class="cat-card card--ruled card-lift"><h3>Great homily</h3><p>Preaching worth sitting still for, ranked by homily, highest first.</p><a href="/browse?filter=homily">Browse great homilies &rsaquo;</a></div>
      <div class="cat-card card--ruled card-lift"><h3>Lovable priest</h3><p>Priests people would cross town to see, ranked by likability.</p><a href="/browse?filter=lovable">Browse lovable priests &rsaquo;</a></div>
    </div>
    </section>
    ${topRated}${freshHtml}${firstHtml}
    <section class="home-section">
    <div class="section-head">
    <p class="eyebrow">How it works</p>
    <h2>Three steps</h2>
    <p class="lede">No account, no name, no email. Just the Mass you went to.</p>
    </div>
    <div class="steps">
      <div class="step"><span class="step-num">01</span><h3><a href="/browse">Find a priest</a></h3><p>Search by name, parish, or city, or browse by region.</p></div>
      <div class="step"><span class="step-num">02</span><h3><a href="/browse?filter=quick">Read the pews</a></h3><p>See what others thought, with review counts on every score.</p></div>
      <div class="step"><span class="step-num">03</span><h3><a href="/how">Rate your Mass</a></h3><p>Anonymous, 1 to 5, in under a minute. No name, no email.</p></div>
    </div>
    </section>
    <section class="home-section about-center">
    <p class="eyebrow">About</p>
    <h2>A passion project</h2>
    <div class="rule" aria-hidden="true"><span></span></div>
    <p class="explainer">RateMyFather is a place for people in the pews to share honest, anonymous ratings of Catholic priests. Free and ad free, built to help you find a Mass you love.</p>
    <p><a href="/about">Read more about RateMyFather &rsaquo;</a></p>
    </section>
    <section class="home-section">
      <div class="cta-card">
        <h2>Know a priest who is not listed?</h2>
        <p>Submit them for moderation review. Approved user-added priests are marked as user-added, and every submission is checked before it goes public.</p>
        <p><a class="btn btn-pill press" href="/add-priest">Add a priest</a></p>
      </div>
    </section>
    <section class="breather breather--feature card-lift">
      <div class="breather-text">
      <p class="eyebrow">Take a breather</p>
      <h2>Need a breather?</h2>
      <p class="explainer">Take a break between Masses with eight little games in the arcade. Best scores live only in your browser.</p>
      </div>
      <a class="btn btn--gold btn-pill press" href="/games">Play the arcade</a>
    </section>
    ${triviaSectionHtml}`));
});

// Diocese codes (2017 directory) to full names, for the Find by place filters.
// Codes not listed here are religious-order or eparchy codes that do not map
// to a single geographic diocese; the UI shows the code itself for those.
// Single-letter codes are real diocese codes in this data: B is Boise, E is
// Erie, L is Louisville, P is Portland (Oregon; PRT is Portland, Maine),
// R is Raleigh, Y is Youngstown. BO is Boston, SD is San Diego.
const DIOCESE_NAMES = {
  AGN: 'Agaña', ALB: 'Albany', ALN: 'Allentown', ALT: 'Altoona-Johnstown', ALX: 'Alexandria',
  AMA: 'Amarillo', ANC: 'Anchorage', ARE: 'Arecibo', ARL: 'Arlington', ATL: 'Atlanta',
  AUS: 'Austin', B: 'Boise', BAK: 'Baker', BAL: 'Baltimore', BEA: 'Beaumont', BEL: 'Belleville',
  BGP: 'Bridgeport', BIR: 'Birmingham', BIS: 'Bismarck', BLX: 'Biloxi', BO: 'Boston', BR: 'Baton Rouge',
  BRK: 'Brooklyn', BUF: 'Buffalo', BUR: 'Burlington', BWN: 'Brownsville', CAM: 'Camden',
  CC: 'Corpus Christi', CGS: 'Caguas', CHI: 'Chicago', CHK: 'Chalan Kanoa', CHL: 'Charlotte',
  CHR: 'Charleston', CHY: 'Cheyenne', CIN: 'Cincinnati', CLV: 'Cleveland', COL: 'Columbus',
  COS: 'Colorado Springs', COV: 'Covington', CR: 'Crookston', DAL: 'Dallas', DAV: 'Davenport',
  DEN: 'Denver', DET: 'Detroit', DM: 'Des Moines', DOD: 'Dodge City', DUB: 'Dubuque',
  DUL: 'Duluth', E: 'Erie', ELP: 'El Paso', EVN: 'Evansville', FAJ: 'Fajardo-Humacao', FAR: 'Fargo',
  FBK: 'Fairbanks', FR: 'Fall River', FRS: 'Fresno', FTW: 'Fort Wayne-South Bend',
  FWT: 'Fort Worth', GAL: 'Galveston-Houston', GB: 'Green Bay', GBG: 'Greensburg',
  GF: 'Great Falls', GI: 'Grand Island', GLP: 'Gallup', GR: 'Grand Rapids', GRY: 'Gary',
  HBG: 'Harrisburg', HEL: 'Helena', HON: 'Honolulu', HRT: 'Hartford', HT: 'Houma-Thibodaux',
  IND: 'Indianapolis', JC: 'Jefferson City', JKS: 'Jackson', JOL: 'Joliet', JUN: 'Juneau',
  KAL: 'Kalamazoo', KC: 'Kansas City', KCK: 'Kansas City in Kansas', KNX: 'Knoxville',
  LA: 'Los Angeles', LAF: 'Lafayette', LAN: 'Lansing', LAR: 'Laredo', LAV: 'Las Vegas', LC: 'La Crosse',
  LEX: 'Lexington', LFT: 'Lafayette in Indiana', LIN: 'Lincoln', LKC: 'Lake Charles', L: 'Louisville',
  LR: 'Little Rock', LSC: 'Las Cruces', LUB: 'Lubbock', MAD: 'Madison', MAN: 'Manchester',
  MAR: 'Marquette', MEM: 'Memphis', MET: 'Metuchen', MGZ: 'Mayagüez', MIA: 'Miami', MIL: 'Milwaukee',
  MOB: 'Mobile', MRY: 'Monterey', NEW: 'Newark', NO: 'New Orleans', NOR: 'Norwich',
  NSH: 'Nashville', NU: 'New Ulm', NY: 'New York', OAK: 'Oakland', OG: 'Ogdensburg',
  OKL: 'Oklahoma City', OM: 'Omaha', ORG: 'Orange', ORL: 'Orlando', OWN: 'Owensboro', P: 'Portland',
  PAT: 'Paterson', PBL: 'Pueblo', PEO: 'Peoria', PH: 'Philadelphia', PHX: 'Phoenix',
  PIT: 'Pittsburgh', PMB: 'Palm Beach', PCE: 'Ponce', PRO: 'Providence', PRT: 'Portland',
  PSC: 'Pensacola', RC: 'Rapid City', RCK: 'Rockford', R: 'Raleigh', RIC: 'Richmond', RNO: 'Reno',
  ROC: 'Rochester', RVC: 'Rockville Centre', SAC: 'Sacramento', SAG: 'Saginaw', SAL: 'Salina',
  SAN: 'San Angelo', SAT: 'San Antonio', SAV: 'Savannah', SB: 'San Bernardino',
  SC: 'Sioux City', SCL: 'Saint Cloud', SCR: 'Scranton', SD: 'San Diego', SEA: 'Seattle', SFD: 'Springfield in Illinois',
  SFE: 'Santa Fe', SFR: 'San Francisco', SFS: 'Sioux Falls', SHP: 'Shreveport', SJ: 'San Jose',
  SJN: 'San Juan', SLC: 'Salt Lake City', SP: 'Saint Petersburg', SPC: 'Springfield-Cape Girardeau',
  SPK: 'Spokane', SPP: 'Samoa-Pago Pago', SPR: 'Springfield in Massachusetts', SR: 'Santa Rosa',
  STA: 'Saint Augustine', STL: 'St. Louis', STN: 'Steubenville', STO: 'Stockton',
  STP: 'Saint Paul', STV: 'Saint Thomas', SUP: 'Superior', SY: 'Syracuse', TLS: 'Tulsa', TOL: 'Toledo',
  TR: 'Trenton', TUC: 'Tucson', TYL: 'Tyler', VEN: 'Venice', VIC: 'Victoria', WCH: 'Wichita',
  WDC: 'Washington', WH: 'Wheeling-Charleston', WIL: 'Wilmington', WIN: 'Winona-Rochester',
  WOR: 'Worcester', Y: 'Youngstown', YAK: 'Yakima',
};
function dioceseName(code) { return DIOCESE_NAMES[code] || code; }

// Full state names for the "Be the first to rate" section, which names the
// states that have no published reviews yet. Codes are what the directory stores.
const STATE_NAMES = { AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming' };
function stateName(code) { return STATE_NAMES[code] || code; }

// ---- Mass times link (outbound link only, no data copied) ----
// MassTimes.org is a JavaScript app. Its own deep link format is
// /map?SearchQueryTerm=<City>, <State>: the app itself sets that query
// param when it geocodes a place search, and its search results are
// indexed under that URL (for example /map?SearchQueryTerm=Madison,
// Wisconsin). The link only sends the visitor there; no Mass times are
// copied, scraped, or stored. Fallback chain: city + state, then state
// alone, then the MassTimes.org home page, so the link always appears.
function massTimesUrl(p) {
  const city = String(p.city || '').trim();
  const state = stateName(String(p.state || '').trim());
  const term = city && state ? `${city}, ${state}` : (state || city || '');
  if (!term) return 'https://masstimes.org/';
  return 'https://masstimes.org/map?SearchQueryTerm=' + encodeURIComponent(term);
}
function massTimesHtml(p) {
  const city = String(p.city || '').trim();
  const state = stateName(String(p.state || '').trim());
  const place = city && state ? `${city}, ${state}` : (state || city || 'your area');
  return `<section class="mass-times-box card--ruled" aria-label="Mass times">
    <p class="eyebrow">Going to Mass</p>
    <h3>Find Mass times near ${esc(place)}</h3>
    <p class="small">Mass times are listed on MassTimes.org, a separate site. This link takes you there for ${esc(place)}. RateMyFather does not copy or store their times.</p>
    <p><a class="btn btn--gold" href="${massTimesUrl(p)}" target="_blank" rel="noopener">Find Mass times on MassTimes.org <span aria-hidden="true">&#8599;</span></a></p>
    <p class="small">Prefer an app? <a href="https://play.google.com/store/apps/details?id=com.itsharedservices.hdsmyc.app&amp;hl=en" target="_blank" rel="noopener">Catholic Mass Times on Google Play</a> &middot; <a href="https://apps.apple.com/us/app/catholic-mass-times/id789923520" target="_blank" rel="noopener">Catholic Mass Times on the App Store</a> (both leave this site).</p>
  </section>`;
}

// Server-rendered Find by place options. places.js replaces these with the
// live lists when it runs, but rendering them here means the dropdowns work
// with no JavaScript too, and an active place filter survives a text-search
// refine even if the script fails to load.
async function placeOptions(state, city, diocese) {
  const st = (state || '').toUpperCase();
  let stateOpts = '<option value="">Choose a state</option>';
  let cityOpts = '<option value="">Choose a city</option>';
  let dioceseOpts = '<option value="">Choose a diocese</option>';
  try {
    const { rows: stRows } = await pool.query(`SELECT DISTINCT state FROM priests WHERE status='approved' AND ${ACTIVE_WHERE} AND state IS NOT NULL AND state <> '' ORDER BY state`);
    stateOpts += stRows.map((r) => `<option value="${esc(r.state)}"${r.state === st ? ' selected' : ''}>${esc(stateName(r.state))}</option>`).join('');
    if (st) {
      const { rows: cRows } = await pool.query(`SELECT DISTINCT city FROM priests WHERE status='approved' AND ${ACTIVE_WHERE} AND state=$1 AND city IS NOT NULL AND city <> '' ORDER BY city LIMIT 200`, [st]);
      cityOpts += cRows.map((r) => `<option value="${esc(r.city)}"${city && r.city.toLowerCase() === city.toLowerCase() ? ' selected' : ''}>${esc(r.city)}</option>`).join('');
      const { rows: dRows } = await pool.query(`SELECT DISTINCT diocese_code FROM priests WHERE status='approved' AND ${ACTIVE_WHERE} AND state=$1 AND diocese_code IS NOT NULL AND diocese_code <> '' ORDER BY diocese_code`, [st]);
      dioceseOpts += dRows.map((r) => `<option value="${esc(r.diocese_code)}"${r.diocese_code === (diocese || '').toUpperCase() ? ' selected' : ''}>${esc(dioceseName(r.diocese_code))}</option>`).join('');
    }
  } catch (e) { console.error('place options failed', e.message); }
  return { stateOpts, cityOpts, dioceseOpts };
}
function placeFiltersHtml(opts, state, city, diocese, stacked) {
  return `<div class="place-filters${stacked ? ' stacked' : ''}" data-state="${esc(state)}" data-city="${esc(city)}" data-diocese="${esc(diocese)}">
    <select id="place-state" name="state" aria-label="State">${opts.stateOpts}</select>
    <select id="place-city" name="city"${state ? '' : ' disabled'} aria-label="City">${opts.cityOpts}</select>
    <select id="place-diocese" name="diocese"${state ? '' : ' disabled'} aria-label="Diocese">${opts.dioceseOpts}</select>
  </div>`;
}

// Find by place: state, then city, then diocese. Data comes from the directory.
app.get('/api/places/states', async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT state, COUNT(*)::int AS n FROM priests WHERE status='approved' AND ${ACTIVE_WHERE} AND state IS NOT NULL AND state <> '' GROUP BY state ORDER BY state`);
    res.json(rows.map((r) => ({ state: r.state, n: r.n })));
  } catch (e) { res.json([]); }
});
app.get('/api/places/cities', async (req, res) => {
  const state = String(req.query.state || '').toUpperCase();
  if (!state) return res.json([]);
  try {
    const { rows } = await pool.query(`SELECT city, COUNT(*)::int AS n FROM priests WHERE status='approved' AND ${ACTIVE_WHERE} AND state=$1 AND city IS NOT NULL AND city <> '' GROUP BY city ORDER BY n DESC, city LIMIT 200`, [state]);
    res.json(rows);
  } catch (e) { res.json([]); }
});
app.get('/api/places/dioceses', async (req, res) => {
  const state = String(req.query.state || '').toUpperCase();
  if (!state) return res.json([]);
  try {
    const { rows } = await pool.query(`SELECT diocese_code, COUNT(*)::int AS n FROM priests WHERE status='approved' AND ${ACTIVE_WHERE} AND state=$1 AND diocese_code IS NOT NULL AND diocese_code <> '' GROUP BY diocese_code ORDER BY n DESC, diocese_code LIMIT 200`, [state]);
    res.json(rows.map((r) => ({ code: r.diocese_code, name: dioceseName(r.diocese_code), n: r.n })));
  } catch (e) { res.json([]); }
});

// Arcade page shell; the games themselves live in /arcade.js, which renders
// its own "The Arcade" heading, intro, and filters. The shell stays minimal
// so the title is not printed twice.

// ---- Parish leaderboard (arcade, optional) ----
// A player may set a home parish (kept only in their own browser). When
// one is set, a finished game's score counts toward that parish's total on
// a per-game leaderboard shared across visitors. No personal information
// is collected or stored: the parish name, city, state and the score are
// all that is kept. A player who never sets a home parish plays exactly
// as before, and scores are never submitted.
const ARCADE_GAME_IDS = ['rungun', 'stack', 'maze', 'steeple', 'dash', 'flee', 'cross', 'pastor', 'trivia'];
function parishKey(parish, city, state) {
  return [parish, city, state].map((s) => String(s || '').toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ').trim()).join('|');
}
// Per-visitor rate limit for score submissions, stored in the
// database (audit F-07, Iteration 2; table score_rate_limits,
// migration 009): one submission per game per visitor per 30 seconds,
// and an identical repeat dropped within 60 seconds. Blunts naive
// farming; a real player finishing games a few minutes apart is never
// affected. DB-backed so it survives deploys/restarts, unlike the
// in-process Map it replaces. Keyed on the source token hash
// (server-determined IP + user agent), never the raw IP. On a database
// error the check fails open (logs and allows): the score insert that
// follows would fail the same way, so blocking here would add nothing.
// Note a check-then-write race remains: two submissions from the same
// token arriving at the same instant can both pass. The 30 s window
// and the daily cap behind it bound what that buys an attacker.
async function scoreRateOk(token, game, score) {
  const now = Date.now();
  try {
    const { rows } = await pool.query(
      'SELECT last_submit, last_score FROM score_rate_limits WHERE token_hash=$1 AND game=$2',
      [token, game]);
    if (rows.length) {
      const prevMs = new Date(rows[0].last_submit).getTime();
      if (now - prevMs < 30000) return false;
      if (rows[0].last_score === score && now - prevMs < 60000) return false;
    }
    await pool.query(
      `INSERT INTO score_rate_limits (token_hash, game, last_submit, last_score)
       VALUES ($1, $2, NOW(), $3)
       ON CONFLICT (token_hash, game) DO UPDATE SET last_submit=EXCLUDED.last_submit, last_score=EXCLUDED.last_score`,
      [token, game, score]);
    return true;
  } catch (e) {
    console.error('score rate limit check failed', e.message);
    return true;
  }
}
// Search distinct parishes by name or city, for picking a home parish.
// Only parishes with an actively-listed priest appear.
// Multi-word queries match across parish, city and state: every word
// must appear in the parish name, the city, or the state, so
// "Saint George in Erie PA" finds St. George in Erie, PA instead of
// matching nothing (the old single LIKE across the whole string could
// never span the parish and city columns). Words use the same
// whole-word normalisation as the main search, so "Saint" and "St."
// are the same word. Rows are ranked by how many words land in the
// city or parish, then by priest count, so a small parish still shows
// when it is the match — St. George in Erie has one priest and used
// to be cut off by the old ORDER BY n DESC LIMIT 10.
app.get('/api/parishes/search', async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 80);
  if (q.length < 2) return res.json([]);
  try {
    const STOPWORDS = new Set(['the', 'and', 'for', 'with', 'from']);
    const rawWords = q.trim().split(/\s+/).filter(Boolean).slice(0, 10);
    const words = rawWords.map(searchNormWord).filter((w) => w.length >= 2 && !STOPWORDS.has(w));
    if (!words.length) return res.json([]);
    const params = [];
    const matchParts = [];
    const relParts = [];
    for (const w of words) {
      params.push(`%${searchLikeEscape(w)}%`);
      const ph = `$${params.length}`;
      params.push(w);
      const sph = `$${params.length}`;
      const cityM = `${searchNormField('city')} ILIKE ${ph}`;
      const parishM = `${searchNormField('parish')} ILIKE ${ph}`;
      const stateM = `LOWER(state) = ${sph}`;
      matchParts.push(`(${cityM} OR ${parishM} OR ${stateM})`);
      relParts.push(`(CASE WHEN ${cityM} THEN 2 WHEN ${parishM} THEN 1 ELSE 0 END)`);
    }
    const { rows } = await pool.query(
      `SELECT parish, city, state, COUNT(*)::int AS n FROM priests
       WHERE status='approved' AND ${ACTIVE_WHERE}
         AND parish IS NOT NULL AND parish <> ''
         AND (${matchParts.join(' AND ')})
       GROUP BY parish, city, state
       ORDER BY (${relParts.join(' + ')}) DESC, n DESC, parish ASC
       LIMIT 20`, params);
    res.json(rows);
  } catch (e) { res.json([]); }
});
// Top parishes for one game. ?parish=<key> also returns the caller's
// parish row with its rank, even when it sits outside the top 10. The
// response also carries the caller's own daily contribution for this
// game (contributed / cap), so the games tab can show how much of
// today's cap they have used.
app.get('/api/leaderboard/:game', async (req, res) => {
  const game = String(req.params.game || '');
  if (!ARCADE_GAME_IDS.includes(game)) return res.status(404).json({ error: 'unknown game' });
  // Caller-specific data (own parish row, daily contribution), so no-store (F-19).
  res.setHeader('Cache-Control', 'no-store');
  try {
    const { rows } = await pool.query(
      `SELECT parish, city, state, total_score, games_played, best_score
       FROM parish_scores WHERE game=$1 ORDER BY total_score DESC, games_played ASC LIMIT 10`, [game]);
    const { rows: cRows } = await pool.query(`SELECT COUNT(*)::int AS n FROM parish_scores WHERE game=$1`, [game]);
    let yours = null;
    const key = String(req.query.parish || '').slice(0, 200);
    if (key) {
      const { rows: yRows } = await pool.query(
        `SELECT parish, city, state, total_score, games_played, best_score,
          (SELECT COUNT(*)::int + 1 FROM parish_scores WHERE game=$1 AND total_score > s.total_score) AS rank
         FROM parish_scores s WHERE game=$1 AND parish_key=$2`, [game, key]);
      if (yRows.length) yours = yRows[0];
    }
    let daily = { contributed: 0, cap: DAILY_PARISH_CAP };
    try {
      const { rows: dRows } = await pool.query(
        `SELECT contributed FROM parish_daily_contrib WHERE day=$1 AND token_hash=$2 AND game=$3`,
        [easternDateStr(), sourceTokenHash(req), game]);
      if (dRows.length) daily.contributed = Number(dRows[0].contributed);
    } catch (e) {}
    res.json({ game, top: rows, count: cRows[0].n, yours, daily });
  } catch (e) { res.json({ game, top: [], count: 0, yours: null, daily: { contributed: 0, cap: DAILY_PARISH_CAP } }); }
});
// Daily parish contribution cap: how many points one person can add to a
// parish score per game per day. 5000 is generous for real play (a great
// game is a few hundred to a few thousand points, depending on the game)
// and still stops one player farming endlessly to carry a parish alone.
// It resets every day on the Eastern date, and it is enforced server
// side here, so the browser cannot bypass it. A submission is credited
// only up to the room left for the day (partial credit), and once the
// cap is reached further submissions add nothing. The response tells
// the player how much was added, whether they are capped, and their
// daily total, so the games tab can show it.
const DAILY_PARISH_CAP = 5000;
// One finished game's score for a home parish. Score is capped per
// submission, and the rate limit above drops repeats and bursts.
app.post('/api/leaderboard/score', async (req, res) => {
  const game = String(req.body.game || '');
  const parish = String(req.body.parish || '').trim().slice(0, 120);
  const city = String(req.body.city || '').trim().slice(0, 80);
  const state = String(req.body.state || '').trim().slice(0, 80);
  const score = Number(req.body.score);
  if (!ARCADE_GAME_IDS.includes(game) || !parish || !Number.isInteger(score) || score <= 0 || score > 100000) {
    return res.status(400).json({ error: 'bad submission' });
  }
  // F-11 (Iteration 2): the parish must exist in the directory — exact
  // match on the parish key (normalized parish + city + state, the same
  // normalisation parishKey applies) against an actively-listed priest
  // — and the parish/city/state strings must pass the shared profanity
  // screen. The games-tab picker only offers directory parishes and
  // submits them verbatim, so exact matching does not block legitimate
  // play; a spelling variant that is not the directory spelling (e.g.
  // "Saint Patrick" for a directory "St. Patrick") IS rejected, and
  // that is intentional — the picker is the way to choose a parish.
  // Normalisation matches parishKey: lowercase, periods dropped,
  // whitespace collapsed, trimmed.
  const normPart = (s) => String(s || '').toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ').trim();
  if (containsProfanity(parish) || containsProfanity(city) || containsProfanity(state)) {
    return res.status(400).json({ error: 'bad submission' });
  }
  const normSql = (col) => `btrim(regexp_replace(lower(regexp_replace(COALESCE(${col},''), '\\.', '', 'g')), '\\s+', ' ', 'g'))`;
  try {
    const { rows: parishRows } = await pool.query(
      `SELECT 1 FROM priests WHERE status='approved' AND ${ACTIVE_WHERE}
       AND ${normSql('parish')}=$1 AND ${normSql('city')}=$2 AND ${normSql('state')}=$3 LIMIT 1`,
      [normPart(parish), normPart(city), normPart(state)]);
    if (!parishRows.length) return res.status(400).json({ error: 'unknown parish' });
  } catch (e) { return res.status(500).json({ error: 'save failed' }); }
  if (!(await scoreRateOk(sourceTokenHash(req), game, score))) return res.status(429).json({ error: 'too fast' });
  const key = parishKey(parish, city, state);
  const day = easternDateStr();
  const token = sourceTokenHash(req);
  try {
    const { rows: oldRows } = await pool.query(
      `SELECT contributed FROM parish_daily_contrib WHERE day=$1 AND token_hash=$2 AND game=$3`,
      [day, token, game]);
    const before = oldRows.length ? Number(oldRows[0].contributed) : 0;
    const added = Math.max(0, Math.min(score, DAILY_PARISH_CAP - before));
    await pool.query(
      `INSERT INTO parish_daily_contrib (day, token_hash, game, contributed)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (day, token_hash, game) DO UPDATE SET
         contributed = LEAST(parish_daily_contrib.contributed + EXCLUDED.contributed, $5),
         updated_at = NOW()`,
      [day, token, game, added, DAILY_PARISH_CAP]);
    if (added > 0) {
      await pool.query(
        `INSERT INTO parish_scores (game, parish_key, parish, city, state, total_score, games_played, best_score)
         VALUES ($1,$2,$3,$4,$5,$6::bigint,1,$6::integer)
         ON CONFLICT (game, parish_key) DO UPDATE SET
           total_score = parish_scores.total_score + EXCLUDED.total_score,
           games_played = parish_scores.games_played + 1,
           best_score = GREATEST(parish_scores.best_score, EXCLUDED.best_score),
           updated_at = NOW()`, [game, key, parish, city, state, added]);
    }
    res.json({ ok: true, added, capped: added < score, dailyTotal: before + added, dailyCap: DAILY_PARISH_CAP });
  } catch (e) { res.status(500).json({ error: 'save failed' }); }
});

// ---- Daily trivia leaderboard (homepage, shared) ----
// A finished round posts its Kahoot-style points (0-3000: up to 1,000
// per question, faster right answers worth more), how many were right
// (0-3), total time, and an optional display name for the day's board.
// One best row per (day, name), case-insensitive, so one player cannot
// flood the board under the same name. The day's best is the most
// points; among equal points the fastest time wins. The name is only a
// display name for the board: no account, no email, no IP is stored
// with it. Names are validated server side (length, characters, and the
// shared profanity filter) before anything is saved, so a blocked name
// never reaches the table and the score is not saved under it.
// Rate-limited per visitor like the leaderboard, so a round cannot be
// farmed by spamming the endpoint. Points are sanity-checked against
// the correct count (500-1,000 per right answer, 0 per wrong one), so
// a forged total does not land on the board. Replaces the old anonymous
// trivia_daily_best (one best per day, no names); that table is left in
// place, no longer written.
app.post('/api/trivia/score', async (req, res) => {
  let points = Number(req.body.points);
  let correct = Number(req.body.correct);
  const ms = Number(req.body.ms);
  // One-day legacy bridge: a stale cached page posts {score} 0-3.
  if (!Number.isFinite(points) && Number.isInteger(Number(req.body.score))) {
    correct = Number(req.body.score);
    points = correct * 500;
  }
  if (!Number.isInteger(points) || points < 0 || points > 3000
    || !Number.isInteger(correct) || correct < 0 || correct > 3
    || !Number.isFinite(ms) || ms < 0 || ms > 3600000
    || points > correct * 1000 || points < correct * 500
    // Sanity bounds for a 3-question round (audit F-10, cheap half;
    // upper bound loosened Iteration 2): at least 2 s per correct
    // answer to have read and answered it. The upper bound only needs
    // to catch absurd forgeries — ms spans round start to final answer
    // INCLUDING the time spent reading the per-question feedback before
    // tapping Next, so a slow reader legitimately exceeds 30 s; 120 s
    // (3 questions x 10 s answer time + reading dwell) is the bound
    // that rejects forgeries without rejecting genuine slow readers.
    // The lower bound (ms >= correct*2000) is the real anti-forgery
    // check; it is unchanged.
    || ms < correct * 2000 || ms > 120000) {
    return res.status(400).json({ error: 'bad submission' });
  }
  const checked = cleanTriviaName(req.body.name);
  if (!checked.ok) {
    return res.status(400).json({ error: 'bad name', message: 'Please choose a different name for the leaderboard.' });
  }
  const name = checked.name;
  if (!(await scoreRateOk(sourceTokenHash(req), 'trivia', points))) return res.status(429).json({ error: 'too fast' });
  const day = easternDateStr();
  try {
    await pool.query(
      `INSERT INTO trivia_daily_scores (day, name, points, correct, ms)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (day, lower(name)) DO UPDATE SET
         points = GREATEST(trivia_daily_scores.points, EXCLUDED.points),
         correct = CASE WHEN EXCLUDED.points > trivia_daily_scores.points THEN EXCLUDED.correct ELSE trivia_daily_scores.correct END,
         ms = CASE WHEN EXCLUDED.points > trivia_daily_scores.points THEN EXCLUDED.ms
                   WHEN EXCLUDED.points = trivia_daily_scores.points THEN LEAST(trivia_daily_scores.ms, EXCLUDED.ms)
                   ELSE trivia_daily_scores.ms END,
         name = EXCLUDED.name,
         updated_at = NOW()`,
      [day, name, points, correct, Math.round(ms)]);
    const { rows: top } = await pool.query(
      `SELECT name, points, correct, ms FROM trivia_daily_scores WHERE day=$1 ORDER BY points DESC, ms ASC LIMIT 5`,
      [day]);
    const { rows: rk } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM trivia_daily_scores WHERE day=$1 AND (points > $2 OR (points = $2 AND ms < $3))`,
      [day, points, Math.round(ms)]);
    const rank = rk[0].n + 1;
    const best = top[0] || { name, points, correct, ms: Math.round(ms) };
    res.json({ ok: true, best: { name: best.name, points: best.points, correct: best.correct, ms: best.ms, score: best.correct }, isNewBest: rank === 1 && points > 0, rank, top: top.map((r) => ({ name: r.name, points: r.points, correct: r.correct, ms: r.ms })) });
  } catch (e) { res.status(500).json({ error: 'save failed' }); }
});

app.get('/games', (req, res) => res.send(page('Games', `
  <div id="arcade-root"><p class="small">Loading games&hellip;</p><div class="skeleton" style="height:120px;margin-top:12px"></div><div class="skeleton" style="height:120px;margin-top:12px"></div></div>
  <noscript><p class="notice">The arcade needs JavaScript enabled to play. Turn JavaScript on and reload the page.</p></noscript>
  <script${cspNonceAttr()}>window.RMF_TRIVIA_ARCADE = ${JSON.stringify(TRIVIA_ARCADE_QUESTIONS).replace(/</g, '\\u003c')};</script>
  <script src="/arcade.js?v=${ARCADE_VERSION}"></script>
  <script${cspNonceAttr()}>(function () {
    // If the games shelf never renders (script blocked or failed), say so
    // and offer a retry instead of leaving "Loading games…" up forever.
    setTimeout(function () {
      var root = document.getElementById('arcade-root');
      if (!root || root.querySelector('.arcade-shelf, .game-stage, .pastor-wrap')) return;
      root.innerHTML = '<p class="notice">The games did not load. Check your connection and try again.</p><p><button type="button" id="games-retry">Try again</button></p>';
      var rb = document.getElementById('games-retry');
      if (rb) rb.addEventListener('click', function () { location.reload(); });
    }, 6000);
  })();</script>`)));

// Saved priests: the list lives in the visitor's own browser (localStorage),
// so this page is a shell that public/saved.js fills in. No account,
// nothing leaves the browser.
app.get('/saved', (req, res) => res.send(page('Saved priests', `
    <div class="section-head">
    <p class="eyebrow">Your list</p>
    <h1>Saved priests</h1>
    <p class="lede">Priests you saved while browsing. Saved only in this browser, on this device. No account, nothing leaves your browser.</p>
    </div>
    <div id="saved-root"><p>Loading your saved priests&hellip;</p><div class="skeleton" style="height:96px;margin-top:12px"></div><div class="skeleton" style="height:96px;margin-top:12px"></div></div>
    <noscript><p class="notice">Saved priests live in this browser, so this page needs JavaScript to show them.</p></noscript>`)));

// Batch lookup for saved priests: full rows (with review stats) for ids
// stored in the visitor's own browser. Public directory data only; no auth,
// no writes.
app.get('/api/priests/batch', async (req, res) => {
  const ids = String(req.query.ids || '').split(',').map((s) => Number(s.trim()))
    .filter((n) => Number.isSafeInteger(n) && n > 0 && n <= 2147483647);
  const unique = [...new Set(ids)].slice(0, 50);
  if (!unique.length) return res.json([]);
  try {
    const { rows } = await pool.query(
      `SELECT p.id, p.name, p.parish, p.city, p.state, p.diocese_code, p.ordination_year, p.user_added,
              COUNT(r.id)::int AS n, AVG(r.pace) AS pace, AVG(r.homily) AS homily, AVG(r.likability) AS likability,
              COUNT(r.id) FILTER (WHERE r.church_beauty IS NOT NULL)::int AS church_n,
              AVG(r.church_beauty) AS church_avg
       FROM priests p LEFT JOIN reviews r ON r.priest_id = p.id AND r.status='approved'
       WHERE p.status='approved' AND COALESCE(p.life_status,'') <> 'deceased' AND p.id = ANY($1) GROUP BY p.id ORDER BY array_position($1, p.id)`, [unique]);
    res.json(rows.map((r) => ({ ...r, diocese_name: r.diocese_code ? dioceseName(r.diocese_code) : null })));
  } catch (e) { console.error('batch priests failed', e.message); res.status(500).json([]); }
});

// Search and browse list only priests who may currently be serving.
// life_status comes from the Nov 8, 2026 verification sweep; the parish
// label is the 2017 directory's own status word. A priest is excluded when
// the sweep found him deceased, retired, laicized, removed, suspended, on
// leave, or a bishop, or when the 2017 listing itself labels the parish
// Retired, Laicized, Suspended, or Leave of Absence. A sweep-confirmed
// active priest is always listed, even if the 2017 parish label says
// Retired. Priests the sweep could not verify (life_status NULL) stay
// listed as 2017 listings.
const INACTIVE_LIFE = `'deceased','retired','laicized','removed','suspended','on_leave','bishop'`;
const ACTIVE_WHERE = `(COALESCE(life_status,'') NOT IN (${INACTIVE_LIFE}) AND ((parish IS DISTINCT FROM 'Retired' AND parish IS DISTINCT FROM 'Laicized' AND parish IS DISTINCT FROM 'Suspended' AND parish IS DISTINCT FROM 'Leave of Absence') OR life_status = 'active'))`;
const ACTIVE_WHERE_P = `(COALESCE(p.life_status,'') NOT IN (${INACTIVE_LIFE}) AND ((p.parish IS DISTINCT FROM 'Retired' AND p.parish IS DISTINCT FROM 'Laicized' AND p.parish IS DISTINCT FROM 'Suspended' AND p.parish IS DISTINCT FROM 'Leave of Absence') OR p.life_status = 'active'))`;
const INACTIVE_LIFE_SET = new Set(['deceased', 'retired', 'laicized', 'removed', 'suspended', 'on_leave', 'bishop']);
const FILTERS = { quick: 'pace', homily: 'homily', lovable: 'likability' };
// Multi-word search helpers. A query like "Erie Saint George" is split into
// words; each word is matched against name, parish, or city, and rows are
// ranked by how many words they match, so a row matching all words outranks
// a row matching only one. "Saint" and "St." are the same word: the field is
// normalised so a whole-word St. or St becomes Saint, and the search word is
// normalised the same way, so "Saint George" finds "St. George" and vice versa.
// Normalize the standard US place-name abbreviations so "Mt Calvary",
// "Ft Wayne", and "Ste Anne" match "Mount Calvary", "Fort Wayne", and
// "St. Anne" exactly like the full forms do. Both the query words and the
// stored columns are normalized the same way, so the phrase place gate and
// the field-weighted matching treat abbreviations and full forms
// identically. Whole words only, so names like Stephen, Clifton, or
// Stevens are untouched. Dotted forms are replaced before bare forms:
// a trailing word boundary after an optional period does not match when
// the period is followed by a space, so a single optional-period pattern
// would leave the period behind ("St. Paul" -> "Saint. Paul") and the
// phrase gate would then miss every row stored in abbreviated form.
function searchNormField(col) {
  const subs = [
    ['\\ySt\\.', 'Saint'],
    ['\\ySte\\.', 'Saint'],
    ['\\ySt\\y', 'Saint'],
    ['\\ySte\\y', 'Saint'],
    ['\\ySainte\\y', 'Saint'],
    ['\\yMt\\.', 'Mount'],
    ['\\yMt\\y', 'Mount'],
    ['\\yFt\\.', 'Fort'],
    ['\\yFt\\y', 'Fort'],
  ];
  let expr = col;
  for (const [pat, rep] of subs) expr = `regexp_replace(${expr}, '${pat}', '${rep}', 'gi')`;
  return expr;
}
function searchNormWord(w) {
  const t = w.replace(/\./g, '').toLowerCase();
  if (t === 'st' || t === 'ste' || t === 'sainte') return 'saint';
  if (t === 'mt') return 'mount';
  if (t === 'ft') return 'fort';
  return t;
}
function searchLikeEscape(s) {
  return s.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}
// Qualify bare priest column names for the FILTERS join (p.name, p.parish...).
function qualifyPriestFragment(w) {
  return w
    .replace(/\blife_status\b/g, 'p.life_status')
    .replace(/\bstatus\b/g, 'p.status').replace(/\bstate\b/g, 'p.state')
    .replace(/\bname\b/g, 'p.name').replace(/\bparish\b/g, 'p.parish')
    .replace(/\bcity\b/g, 'p.city').replace(/\bdiocese_code\b/g, 'p.diocese_code')
    .replace(/\buser_added\b/g, 'p.user_added')
    .replace(/\bzip\b/g, 'p.zip');
}
const FILTER_LABELS = { quick: 'Quick Mass (pace)', homily: 'Great homily', lovable: 'Lovable priest (likability)' };

app.get('/browse', async (req, res) => {
  const { q = '', state = '', city = '', diocese = '', region = '', zip: legacyZip = '', filter = '' } = req.query;
  // Pagination: 50 priests a page. A page past the end redirects to the
  // last page instead of showing an empty list.
  const PAGE_SIZE = 50;
  const pageReq = parseInt(req.query.page, 10);
  const pageNum = Number.isFinite(pageReq) && pageReq > 0 ? pageReq : 1;
  const offset = (pageNum - 1) * PAGE_SIZE;
  const where = [`status='approved'`, ACTIVE_WHERE];
  const params = [];
  let note = '';
  if (state) { params.push(state.toUpperCase()); where.push(`state = $${params.length}`); }
  if (city) { params.push(searchLikeEscape(city)); where.push(`city ILIKE $${params.length}`); }
  if (diocese) { params.push(diocese.toUpperCase()); where.push(`diocese_code = $${params.length}`); }
  if (region) {
    const states = REGIONS[region];
    if (states) { params.push(states); where.push(`state = ANY($${params.length})`); }
    else if (region === 'Other listings') {
      const all = Object.values(REGIONS).flat();
      params.push(all); where.push(`NOT (state = ANY($${params.length}))`);
    } else {
      // An unknown region used to be silently ignored, which returned the
      // whole directory with no explanation. Say so and show nothing.
      note = `<p class="notice">We do not have a region called &ldquo;${esc(region)}&rdquo;. Try Northeast, Midwest, South, West, or Other listings.</p>`;
      where.push('false');
    }
  }
  // Multi-word search: each word is matched against name, parish, or city.
  // A row matching any word is returned; rows matching more words rank first
  // (see the relevance score below). "Erie Saint George" therefore finds the
  // St. George priests in Erie, even though "Erie" is the city and
  // "St. George" is the parish, in different fields.
  // Unified search: a 5-digit number typed anywhere in the single box
  // (alone or beside words) is pulled out and resolved to its metro area
  // behind the scenes; the remaining words match name, parish, or city
  // as before. A legacy ?zip= parameter is folded in the same way, so
  // old links keep working.
  const zipMatch = q.match(/\b\d{5}\b/);
  const zip = zipMatch ? zipMatch[0] : legacyZip;
  // Words shorter than 3 letters, and a few filler words, are dropped before
  // matching: as substrings they match nearly everything ("no" alone matched
  // 3,323 priests, "of" 9,217), so a nonsense query like "Zzqx No Such"
  // returned thousands of results. "St" still works because it normalizes
  // to "saint" first; real place phrases ("El Paso", "De La Salle") still
  // work because the remaining word carries them.
  const STOPWORDS = new Set(['the', 'and', 'for', 'with', 'from']);
  const rawWords = q.trim().split(/\s+/).filter(Boolean).filter((t) => !/^\d{5}$/.test(t)).slice(0, 10);
  const words = rawWords.map(searchNormWord).filter((w) => w.length >= 3 && !STOPWORDS.has(w));
  let relevance = null;
  if (words.length) {
    const matchParts = [];
    const relParts = [];
    const wordPhs = [];
    for (const w of words) {
      params.push(`%${searchLikeEscape(w)}%`);
      const ph = `$${params.length}`;
      wordPhs.push(ph);
      // Field-weighted match: a word in the city outranks the same word in
      // the parish, which outranks it in the name. A place query ("San
      // Diego") therefore surfaces place matches instead of priests who
      // merely share a name ("Diego"), and a parish query ("St. Michael")
      // surfaces that parish instead of priests named Michael elsewhere.
      const cityM = `${searchNormField('city')} ILIKE ${ph}`;
      const parishM = `${searchNormField('parish')} ILIKE ${ph}`;
      const nameM = `${searchNormField('name')} ILIKE ${ph}`;
      matchParts.push(`(${cityM} OR ${parishM} OR ${nameM})`);
      relParts.push(`(CASE WHEN ${cityM} THEN 3 WHEN ${parishM} THEN 2 WHEN ${nameM} THEN 1 ELSE 0 END)`);
    }
    where.push(`(${matchParts.join(' OR ')})`);
    relevance = `(${relParts.join(' + ')})`;
    // The place phrase this query resolved to, if any: the full phrase
    // when the whole query is a place, a subsequence when a place hides
    // inside a longer query, or the single word when it names a city.
    // Used by place resolution below.
    let placePhrase = null;
    let placeRaw = null;
    if (rawWords.length >= 2) {
      // A multi-word query that matches a city or parish as a phrase is a
      // place query, not a name query: restrict to rows matching the phrase
      // in city or parish, so priests who merely share a word of the place
      // name (a Diego for "San Diego", a Paul for "St. Paul") do not show
      // up at all. When no place phrase matches, boost a row whose name
      // contains every word instead, so a real full-name search
      // ("Michael DeMartinis", stored "DeMartinis, Michael") still ranks
      // first. The name bonus reuses the word params already pushed, so
      // the count query's parameter list stays in sync.
      // The phrase is built from the raw words, not the filtered ones:
      // short words are dropped from matching, but "De La Salle" is still
      // a parish phrase, and "El Paso" is still a city phrase.
      const phrase = rawWords.map(searchNormWord).join(' ');
      const phraseLike = `%${searchLikeEscape(phrase)}%`;
      let phraseIsPlace = false;
      try {
        const ex = await pool.query(
          `SELECT EXISTS(SELECT 1 FROM priests WHERE status='approved' AND ${ACTIVE_WHERE} AND (${searchNormField('city')} ILIKE $1 OR ${searchNormField('parish')} ILIKE $1)) AS yes`,
          [phraseLike]);
        phraseIsPlace = !!ex.rows[0]?.yes;
      } catch (e) { console.error(e.message); }
      if (phraseIsPlace) {
        params.push(phraseLike);
        const pph = `$${params.length}`;
        where.push(`(${searchNormField('city')} ILIKE ${pph} OR ${searchNormField('parish')} ILIKE ${pph})`);
        placePhrase = phrase;
        placeRaw = rawWords.join(' ');
      } else {
        const nameAll = wordPhs.map((ph) => `${searchNormField('name')} ILIKE ${ph}`).join(' AND ');
        relevance += ` + (CASE WHEN (${nameAll}) THEN 6 ELSE 0 END)`;
      }
      // A place phrase can hide inside a longer query ("San Diego CA",
      // "St Paul Minnesota", "Fort Worth Texas"): the full-phrase gate
      // above only fires when the whole query is the place, so the extra
      // word lets the place words split across fields again and the
      // result set explodes (15,609 for "St Paul Minnesota" against 416
      // for "St. Paul" alone). Try contiguous subsequences of the query,
      // longest first, against the city field only. A city phrase is
      // never part of a priest's name, so this cannot gate a name search
      // the way a parish phrase ("John Paul") could. The first city
      // phrase found restricts results to that place, exactly like the
      // full-phrase gate. Capped at 6 existence checks.
      if (!phraseIsPlace && rawWords.length >= 3) {
        const normWords = rawWords.map(searchNormWord);
        let subGate = null;
        let subGateRaw = null;
        let checks = 0;
        outer: for (let len = normWords.length - 1; len >= 2 && checks < 6; len--) {
          for (let i = 0; i + len <= normWords.length && checks < 6; i++) {
            const sub = normWords.slice(i, i + len).join(' ');
            checks++;
            try {
              const ex = await pool.query(
                `SELECT EXISTS(SELECT 1 FROM priests WHERE status='approved' AND ${ACTIVE_WHERE} AND ${searchNormField('city')} ILIKE $1) AS yes`,
                [`%${searchLikeEscape(sub)}%`]);
              if (ex.rows[0]?.yes) { subGate = sub; subGateRaw = rawWords.slice(i, i + len).join(' '); break outer; }
            } catch (e) { console.error(e.message); }
          }
        }
        if (subGate) {
          params.push(`%${searchLikeEscape(subGate)}%`);
          const sph = `$${params.length}`;
          where.push(`(${searchNormField('city')} ILIKE ${sph} OR ${searchNormField('parish')} ILIKE ${sph})`);
          placePhrase = subGate;
          placeRaw = subGateRaw;
        }
      }
    } else if (rawWords.length === 1) {
      // A single word can still be a place ("Erie"). The word-level
      // matching already ran; place resolution below tests it against
      // the city list.
      placePhrase = searchNormWord(rawWords[0]);
      placeRaw = rawWords[0];
    }
    // Place resolution: a place name can be ambiguous in two ways the
    // phrase gates above do not fix. (1) Wrong field: a single word
    // matches as a substring where it does not belong, so "Erie" pulls
    // in "Deaneries" (parish), "Valerie" and "Ceriello" (names), and
    // "Cemeteries" (parish). (2) Wrong place: a name shared by several
    // cities, so "Erie" mixes Erie, PA with Erie, MI and Erie, KS.
    // When the query resolved to a place phrase, test whether the place
    // interpretation clearly dominates: C is the priest count in the
    // largest city exactly by that name, P is every other priest
    // matching the phrase in city or parish, N is priests with the
    // phrase as a whole word in their name. Resolve to the largest city
    // only when C beats both P and N, so a parish name ("St. George",
    // "St. Paul") and a personal name ("George", "Lawrence") keep their
    // current behavior, and a fragmented name ("Springfield", thirteen
    // cities, none dominant) stays mixed. Only for a bare place search:
    // an explicit state, city, region, or ZIP is the visitor's own
    // disambiguation, so it is left alone.
    if (placePhrase && !state && !city && !region && !/^\d{5}$/.test(zip)) {
      try {
        const normCityExpr = `BTRIM(${searchNormField('city')})`;
        // Group by the normalized city, not the raw spelling, so
        // "St. Louis" and "Saint Louis" count as one place instead of
        // the note pointing at a spelling twin as a different city.
        const cityRows = (await pool.query(
          `SELECT MAX(city) AS city, state, COUNT(*)::int AS n FROM priests WHERE status='approved' AND ${ACTIVE_WHERE} AND ${normCityExpr} ILIKE $1 GROUP BY ${normCityExpr}, state ORDER BY n DESC`,
          [placePhrase])).rows;
        if (cityRows.length) {
          const dom = cityRows[0];
          const C = dom.n;
          const tRow = await pool.query(
            `SELECT COUNT(*)::int AS n FROM priests WHERE status='approved' AND ${ACTIVE_WHERE} AND (${searchNormField('city')} ILIKE $1 OR ${searchNormField('parish')} ILIKE $1)`,
            [`%${searchLikeEscape(placePhrase)}%`]);
          const T = tRow.rows[0]?.n || 0;
          const namePhrase = placePhrase.replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
          const nRow = await pool.query(
            `SELECT COUNT(*)::int AS n FROM priests WHERE status='approved' AND ${ACTIVE_WHERE} AND (' ' || regexp_replace(${searchNormField('name')}, '[^a-z0-9]+', ' ', 'gi') || ' ') ILIKE $1`,
            [`% ${namePhrase} %`]);
          const N = nRow.rows[0]?.n || 0;
          const P = T - C;
          if (C > P && C > N) {
            params.push(placePhrase);
            const cph = `$${params.length}`;
            params.push(dom.state);
            const sph = `$${params.length}`;
            where.push(`(${normCityExpr} ILIKE ${cph} AND state = ${sph})`);
            const others = cityRows.slice(1);
            if (others.length) {
              const links = others.map((o) => `<a href="/browse?q=${encodeURIComponent(placeRaw)}&amp;state=${esc(o.state)}">${esc(o.city)}, ${esc(o.state)} (${o.n} priest${o.n === 1 ? '' : 's'})</a>`).join(', ');
              note += `<p class="notice">Showing priests in ${esc(dom.city)}, ${esc(dom.state)}. Also listed under this name: ${links}.</p>`;
            }
          }
        }
      } catch (e) { console.error('place resolution failed', e.message); }
    }
  }
  if (/^\d{5}$/.test(zip)) {
    const area = areaForZip(zip);
    if (area) {
      note = `<p class="notice">Showing priests in the ${esc(area.city)}, ${esc(area.state)} area.</p>`;
      params.push(area.city, area.state, zip);
      where.push(`((city ILIKE $${params.length - 2} AND state = $${params.length - 1}) OR (user_added = true AND zip = $${params.length}))`);
    } else if (words.length) {
      note = `<p class="notice">The 5-digit number in your search did not match a known area, so it was ignored. Results below are from the rest of your search.</p>`;
    } else {
      note = `<p class="notice">We could not match that number to a known area, so no results are shown. Try a name, parish, or city search instead.</p>`;
      where.push('false');
    }
  }
  // The visitor typed words, but every one was too short or a filler word to
  // match on (and no ZIP resolved to an area): show nothing with a plain
  // explanation instead of the whole directory, which is what an empty
  // search used to return here.
  if (rawWords.length && !words.length && !/^\d{5}$/.test(zip)) {
    note = `<p class="notice">That search was too general to match anything. Try a full name, parish, or city.</p>`;
    where.push('false');
  }
  let cards = [];
  let totalCount = 0;
  if (FILTERS[filter]) {
    // Rank across ALL rated priests matching the search, not just the first
    // 200 alphabetical rows: join approved reviews and order by category
    // average, then review count. Bare column names in the where fragments
    // are qualified to the priests table for the join.
    const col = FILTERS[filter];
    const whereP = where.map(qualifyPriestFragment);
    const relP = relevance ? qualifyPriestFragment(relevance) : null;
    const fsql = `SELECT p.*, ${relP ? `${relP} AS relevance, ` : ''}COUNT(r.id)::int AS n, AVG(r.pace) AS pace, AVG(r.homily) AS homily, AVG(r.likability) AS likability FROM priests p JOIN reviews r ON r.priest_id = p.id AND r.status='approved' WHERE ${whereP.join(' AND ')} GROUP BY p.id ORDER BY ${relP ? 'relevance DESC, ' : ''}AVG(r.${col}) DESC, COUNT(r.id) DESC LIMIT ${PAGE_SIZE} OFFSET ${offset}`;
    try {
      const frows = (await pool.query(fsql, params)).rows;
      cards = frows.map((p) => ({ p, st: { n: p.n, pace: p.pace, homily: p.homily, likability: p.likability } }));
      const csql = `SELECT COUNT(*)::int AS n FROM (${fsql.replace(/ ORDER BY.*$/, '')}) t`;
      totalCount = (await pool.query(csql, params)).rows[0].n;
    } catch (e) { console.error(e.message); }
  } else {
    let sql = relevance
      ? `SELECT *, ${relevance} AS relevance FROM priests WHERE ${where.join(' AND ')} ORDER BY relevance DESC, name LIMIT ${PAGE_SIZE} OFFSET ${offset}`
      : `SELECT * FROM priests WHERE ${where.join(' AND ')} ORDER BY name LIMIT ${PAGE_SIZE} OFFSET ${offset}`;
    let rows = [];
    try { rows = (await pool.query(sql, params)).rows; } catch (e) { console.error(e.message); }
    const stats = await statsFor(rows.map((r) => r.id));
    cards = rows.map((p) => ({ p, st: stats[p.id] }));
    try { totalCount = (await pool.query(`SELECT COUNT(*)::int AS n FROM priests WHERE ${where.join(' AND ')}`, params)).rows[0].n; } catch (e) { console.error(e.message); }
  }
  const heading = filter ? FILTER_LABELS[filter] : 'Search & Browse';
  // Pagination bookkeeping. A page past the end redirects to the last
  // page, so a stale or hand-typed ?page= never shows an empty list.
  const pageCount = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const pageQs = (p) => {
    const parts = [];
    if (q) parts.push(`q=${encodeURIComponent(q)}`);
    if (state) parts.push(`state=${encodeURIComponent(state)}`);
    if (city) parts.push(`city=${encodeURIComponent(city)}`);
    if (diocese) parts.push(`diocese=${encodeURIComponent(diocese)}`);
    if (region) parts.push(`region=${encodeURIComponent(region)}`);
    if (FILTERS[filter]) parts.push(`filter=${encodeURIComponent(filter)}`);
    if (p > 1) parts.push(`page=${p}`);
    return parts.length ? '/browse?' + parts.join('&') : '/browse';
  };
  if (pageNum > pageCount && totalCount > 0) return res.redirect(pageQs(pageCount));
  // A category filter with no results means nobody has been rated yet
  // (production has no reviews), not a broken search: say so plainly.
  const emptyHtml = FILTERS[filter]
    ? `<div class="empty-state"><p>No priests have been rated yet.</p><p class="small">This list only shows rated priests, and nobody has rated one yet. Be the first to rate a priest you know.</p><div class="btnrow"><a class="btn" href="/browse">Browse all priests</a></div></div>`
    : `<div class="empty-state"><p>No priests matched that search.</p><p class="small">If the priest is not listed, you can submit them for moderation review.</p><div class="btnrow"><a class="btn" href="/add-priest">Add this priest</a> <a class="btn btn-secondary" href="/browse">Clear search and filters</a></div></div>`;
  const body = cards.length
    ? cards.map((c) => priestCard(c.p, c.st)).join('')
    : emptyHtml;
  const firstShown = totalCount ? offset + 1 : 0;
  const lastShown = Math.min(totalCount, offset + PAGE_SIZE);
  // A one-priest page reads "Showing 3,101 of 3,101", not "3,101–3,101".
  const shownRange = firstShown === lastShown ? firstShown.toLocaleString() : `${firstShown.toLocaleString()}&ndash;${lastShown.toLocaleString()}`;
  const matchLine = cards.length
    ? `<p class="match-count">Showing ${shownRange} of ${totalCount.toLocaleString()} priest${totalCount === 1 ? '' : 's'}${words.length ? ' &middot; best matches first' : ''}${pageCount > 1 ? ` &middot; page ${pageNum} of ${pageCount}` : ''}</p>`
    : '';
  // Pager: previous / next plus a small window of page numbers around the
  // current page, so a common search (John: 3,101 priests, 63 pages) can
  // actually be walked through instead of stopping at the first 50.
  let pagerHtml = '';
  if (pageCount > 1) {
    const winStart = Math.max(1, Math.min(pageNum - 2, pageCount - 4));
    const winEnd = Math.min(pageCount, winStart + 4);
    const nums = [];
    for (let p = winStart; p <= winEnd; p++) {
      nums.push(p === pageNum ? `<span class="pager-num pager-current" aria-current="page">${p}</span>` : `<a class="pager-num" href="${pageQs(p)}">${p}</a>`);
    }
    if (winStart > 2) nums.unshift('<span class="pager-ellipsis" aria-hidden="true">&hellip;</span>');
    if (winStart > 1) nums.unshift(`<a class="pager-num" href="${pageQs(1)}">1</a>`);
    if (winEnd < pageCount - 1) nums.push('<span class="pager-ellipsis" aria-hidden="true">&hellip;</span>');
    if (winEnd < pageCount) nums.push(`<a class="pager-num" href="${pageQs(pageCount)}">${pageCount}</a>`);
    pagerHtml = `<nav class="pager" aria-label="More priests">
      ${pageNum > 1 ? `<a class="pager-btn" href="${pageQs(pageNum - 1)}">&larr; Previous</a>` : '<span class="pager-btn pager-disabled" aria-hidden="true">&larr; Previous</span>'}
      <span class="pager-pages">${nums.join('')}</span>
      ${pageNum < pageCount ? `<a class="pager-btn" href="${pageQs(pageNum + 1)}">Next &rarr;</a>` : '<span class="pager-btn pager-disabled" aria-hidden="true">Next &rarr;</span>'}
    </nav>`;
  }
  // The page lede: what this list is, in one line.
  const browseLede = filter === 'quick'
    ? 'Priests whose Sunday Mass moves briskly, ranked by pace, highest first. Pace is speed only, never a quality grade.'
    : filter === 'homily'
      ? 'Preaching worth sitting still for, ranked by homily, highest first.'
      : filter === 'lovable'
        ? 'Priests people would cross town to see, ranked by likability, highest first.'
        : 'Search by name, parish, or city. A 5-digit ZIP in the box finds priests near that area.';
  // Active filters, as removable chips: each chip links to the same search
  // minus that one filter, so a visitor can see what is narrowing the list
  // and drop one piece at a time. Place filters arrive by URL (home region
  // links, Find by place); the single search box stays the only text input.
  const qsWithout = (drop) => {
    const parts = [];
    if (q && drop !== 'q') parts.push(`q=${encodeURIComponent(q)}`);
    if (state && drop !== 'state') parts.push(`state=${encodeURIComponent(state)}`);
    if (city && drop !== 'city') parts.push(`city=${encodeURIComponent(city)}`);
    if (diocese && drop !== 'diocese') parts.push(`diocese=${encodeURIComponent(diocese)}`);
    if (region && drop !== 'region') parts.push(`region=${encodeURIComponent(region)}`);
    if (FILTERS[filter] && drop !== 'filter') parts.push(`filter=${encodeURIComponent(filter)}`);
    return parts.length ? '/browse?' + parts.join('&amp;') : '/browse';
  };
  const chipDefs = [];
  if (state) chipDefs.push(['state', `State: ${esc(state.toUpperCase())}`]);
  if (city) chipDefs.push(['city', `City: ${esc(city)}`]);
  if (diocese) chipDefs.push(['diocese', `Diocese: ${esc(dioceseName(diocese.toUpperCase()))}`]);
  if (region) chipDefs.push(['region', `Region: ${esc(region)}`]);
  if (FILTERS[filter]) chipDefs.push(['filter', esc(FILTER_LABELS[filter])]);
  const chipsHtml = chipDefs.length
    ? `<p class="filter-chips"><span class="filter-chips-label">Filtered by</span> ${chipDefs.map(([key, label]) => `<a class="filter-chip" href="${qsWithout(key)}" title="Remove this filter">${label} <span aria-hidden="true">&times;</span></a>`).join(' ')} <a class="filter-clear" href="/browse">Clear all</a></p>`
    : '';
  // With no search and no filters, offer the regions as Find by place
  // links, so the page still browses somewhere instead of listing 200
  // priests alphabetically with no way in.
  const regionLinks = (!q && !state && !city && !diocese && !region && !FILTERS[filter])
    ? `<p class="region-links"><span class="filter-chips-label">Browse by region</span> ${['Northeast', 'Midwest', 'South', 'West', 'Other listings'].map((r) => `<a class="chip" href="/browse?region=${encodeURIComponent(r)}">${r}</a>`).join(' ')}</p>`
    : '';
  const searchIcon = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><line x1="16.5" y1="16.5" x2="21" y2="21"/></svg>`;
  // Find by place: the visible state, city, and diocese selects carry the
  // place filter, so refining the text search cannot silently drop it.
  // places.js enhances them into searchable comboboxes and restores the
  // active values from the data attributes; the options are server-rendered
  // (see placeOptions) so they also work with no JavaScript. A 5-digit
  // number typed in the box still resolves to its metro area behind the
  // scenes.
  const placeOpts = await placeOptions(state, city, diocese);
  const placeSection = `<div class="place-section">
    <h2>Find by place</h2>
    <p class="explainer">Pick a state, then a city, then a diocese. Type in any box to search the list.</p>
    ${placeFiltersHtml(placeOpts, state, city, diocese, true)}
  </div>`;
  // The category filter select was removed from the search row to keep it one
  // box; an active filter is kept as a hidden input so refining the text
  // search does not silently drop it. Entry points are the home chips.
  const filterHidden = FILTERS[filter] ? `<input type="hidden" name="filter" value="${esc(filter)}">` : '';
  res.send(page(heading, `<div class="section-head">
    <p class="eyebrow">The directory</p>
    <h1>${esc(heading)}</h1>
    <p class="lede">${browseLede}</p>
    </div>
    <form action="/browse" method="get" id="browse-form">
      <div class="search">
        <span class="search-field">${searchIcon}<input name="q" value="${esc(q)}" placeholder="Search by name, parish, or city" aria-label="Search by name, parish, or city" enterkeyhint="search"></span>
        ${filterHidden}
        <button type="submit">Search</button>
      </div>
      ${placeSection}
    </form>
    ${chipsHtml}${regionLinks}${note}${matchLine}
    ${cards.length ? '<div class="rule" aria-hidden="true"><span></span></div>' : ''}
    <div class="cards">${body}</div>${pagerHtml}`));
});

// Attendance-duration answers for the review form (required dropdown).
// Kept as the exact option values; the form and the POST handler both use
// this list so a tampered value cannot be stored.
const ATTENDANCE_OPTIONS = [
  'Just visiting / first time', 'Less than 6 months', '6 months to 1 year',
  '1 to 3 years', '3 to 5 years', '5 to 10 years', 'More than 10 years',
  'Lifelong parishioner',
];

// Anchored rating scales: what each star means, so a reviewer picks from a
// real basis instead of guessing. `label` is the short tag shown on review
// cards and profiles; `text` is the full sentence shown under the dropdown
// in the form as the reviewer selects a star. Score math is unchanged: the
// priest's score is still pace, homily, and likability only, and church
// beauty never enters it.
// Pace times are grounded in Catholic Index data (209,000 livestreamed
// Sunday Masses from 3,253 US parishes, published March 2026): Sunday Mass
// runs about 71 minutes at the median, and about 7 in 10 Sunday Masses fall
// between 60 and 90 minutes. The spread works out to a standard deviation of
// roughly 14 minutes, estimated from the published distribution, not a figure
// the source prints. Livestream timing includes a few minutes of camera
// setup, so time in the pew runs slightly shorter. Weekday Mass is a
// different world, about 43 minutes at the median.
const ANCHORS = {
  pace: {
    1: { label: 'Very slow', text: 'A long, slow Mass, usually over 90 minutes on a Sunday.' },
    2: { label: 'Slow', text: 'Unhurried, about 75 to 90 minutes on a Sunday.' },
    3: { label: 'About average', text: 'About average, about 60 to 75 minutes on a Sunday.' },
    4: { label: 'Brisk', text: 'Brisk, about 45 to 60 minutes on a Sunday.' },
    5: { label: 'Very quick', text: 'Very quick, under 45 minutes on a Sunday.' },
  },
  homily: {
    1: { label: 'Lost me', text: 'Lost me entirely, or I could not follow it.' },
    2: { label: 'Forgettable', text: 'Thin or wandering, little to take home.' },
    3: { label: 'Solid', text: 'Clear and faithful, it did the job.' },
    4: { label: 'Memorable', text: 'Good preaching, I kept thinking about it after Mass.' },
    5: { label: 'Shapes my week', text: 'Preaching that shapes how I live the week.' },
  },
  likability: {
    1: { label: 'Off-putting', text: 'Cold or off-putting in person.' },
    2: { label: 'Distant', text: 'Distant, hard to warm to.' },
    3: { label: 'Pleasant', text: 'Pleasant enough, no strong impression either way.' },
    4: { label: 'Warm', text: 'Warm and easy to talk to, I would seek him out.' },
    5: { label: 'A real shepherd', text: 'A priest I would cross town to see, a real shepherd.' },
  },
  church_beauty: {
    1: { label: 'Run down', text: 'Plain or run down, nothing that lifts the eye.' },
    2: { label: 'Modest', text: 'Serviceable, but little beauty to it.' },
    3: { label: 'Pleasant', text: 'A decent church, some things worth looking at.' },
    4: { label: 'Beautiful', text: 'A beautiful church, the space itself helps prayer.' },
    5: { label: 'Stunning', text: 'A stunning church, the building alone is worth the visit.' },
  },
};
// Short label for one star, or '' when the value is not a 1-5 rating.
function anchorLabel(key, v) {
  const n = Number(v);
  const a = ANCHORS[key] && ANCHORS[key][n];
  return a ? a.label : '';
}
// Nearest-star label for an average (used on profile bars).
function anchorLabelForAvg(key, v) {
  if (v == null) return '';
  return anchorLabel(key, Math.max(1, Math.min(5, Math.round(Number(v)))));
}
const MASS_TIMING_NOTE = 'Typical Sunday Mass runs about 71 minutes (median), and about 7 in 10 fall between 60 and 90 minutes. The spread is roughly 14 minutes either way. Weekday Mass is shorter, about 43 minutes at the median. Figures: Catholic Index, 209,000 Masses from 3,253 US parishes, March 2026.';

// ---------- profile + rating ----------
app.get('/priest/:id', async (req, res) => {
  const { rows } = await pool.query(`SELECT * FROM priests WHERE id=$1 AND status='approved'`, [req.params.id]);
  if (!rows.length) return sendErrorPage(res, 404, notFoundPage());
  const p = rows[0];
  // Deceased priests are not served at all: no profile, no link to one
  // anywhere on the site, and a direct URL returns the 404 page exactly
  // as if the profile did not exist. The row and its memorial note stay
  // in the database for the record; only the page stops being served.
  // Retired priests are unaffected: their profiles still load.
  if (p.life_status === 'deceased') return sendErrorPage(res, 404, notFoundPage());
  const stats = await statsFor([p.id]);
  const st = stats[p.id];
  const revs = (await pool.query(`SELECT id, pace, homily, likability, church_beauty, mass_context, attendance_duration, body, created_at FROM reviews WHERE priest_id=$1 AND status='approved' ORDER BY created_at DESC LIMIT 50`, [p.id])).rows;
  // Church beauty is a separate average over the BUILDING only. It never
  // enters the priest's score, and it has its own review count.
  const church = (await pool.query(`SELECT COUNT(*)::int AS n, AVG(church_beauty) AS avg FROM reviews WHERE priest_id=$1 AND status='approved' AND church_beauty IS NOT NULL`, [p.id])).rows[0];
  const reviewHtml = revs.length ? revs.map((r) => {
    const ravg = (Number(r.pace) + Number(r.homily) + Number(r.likability)) / 3;
    const date = r.created_at ? new Date(r.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
    return `<article class="review card--ruled">
    <div class="review-head"><span class="review-score">${ravg.toFixed(1)} out of 5</span>${starsHtml(ravg)}<span class="review-date">${date}${r.mass_context ? ` &middot; ${esc(r.mass_context)}` : ''}</span></div>
    <p class="review-cats">Pace <strong>${r.pace}</strong> <span class="small">${esc(anchorLabel('pace', r.pace))}</span> &middot; Homily <strong>${r.homily}</strong> <span class="small">${esc(anchorLabel('homily', r.homily))}</span> &middot; Likability <strong>${r.likability}</strong> <span class="small">${esc(anchorLabel('likability', r.likability))}</span></p>
    ${r.church_beauty ? `<p class="review-church">Church beauty: <strong>${r.church_beauty} out of 5</strong> <span class="small">${esc(anchorLabel('church_beauty', r.church_beauty))} (the building, not the priest)</span></p>` : ''}
    ${r.attendance_duration ? `<p class="review-attendance">Attending this parish / knows this priest: <strong>${esc(r.attendance_duration)}</strong></p>` : ''}
    ${r.body ? `<p class="review-body">${esc(r.body)}</p>` : '<p class="review-body small">Star-only review (no written comment).</p>'}
    <div class="review-actions"><a href="/report?review=${r.id}&priest=${p.id}">Report this review</a></div></article>`;
  }).join('')
    : '<p>No published reviews for this priest yet.</p>';
  const avg = overallAvg(st);
  const scoreBoxLg = avg == null
    ? `<span class="score-box-lg unrated">Not yet rated</span>`
    : `<span class="score-box-lg"><span class="num">${avg.toFixed(1)}</span><span class="lbl">out of 5</span></span>`;
  const bar = (label, key, v) => `<div class="bar-row"><span class="bar-label">${label}</span><span class="bar-track"><span class="bar-fill" style="width:${(Number(v) / 5 * 100).toFixed(0)}%"></span></span><span class="bar-value">${fmtAvg(v)}</span><span class="small">${esc(anchorLabelForAvg(key, v))}</span></div>`;
  const barsHtml = st && st.n
    ? bar('Pace', 'pace', st.pace) + bar('Homily', 'homily', st.homily) + bar('Likability', 'likability', st.likability)
    : '';
  // Editorial facts for the profile header: diocese, ordination year as
  // listed, and where the profile comes from. The parish and city stay in
  // assignment(), worded exactly as before ("Listed at ..." is a historical
  // listing from the directory, not a claim about today).
  const factRows = [];
  if (p.diocese_code) factRows.push(`<div><dt>Diocese</dt><dd>${esc(dioceseName(p.diocese_code))} (${esc(p.diocese_code)})</dd></div>`);
  if (p.ordination_year) factRows.push(`<div><dt>Ordination year</dt><dd>${esc(p.ordination_year)} (as listed)</dd></div>`);
  factRows.push(`<div><dt>Source</dt><dd>${p.user_added ? 'User-added profile' : '2017 Official Catholic Directory'}</dd></div>`);
  // Priests who are not currently serving cannot be rated: the profile
  // shows the status notice instead of the form.
  const rateSection = INACTIVE_LIFE_SET.has(p.life_status)
    ? `<p class="notice">New ratings are closed for this priest.</p>`
    : `  <section class="rate-section">
    <div class="section-head">
      <p class="eyebrow">Your turn</p>
      <h2>Rate this priest</h2>
      <p class="lede">Each star has a meaning, so pick the one that matches what you actually experienced. Pace is speed only, not a quality grade: a slow Mass is not a bad Mass.</p>
    </div>
    <form action="/priest/${p.id}/review" method="post" class="rate-form rate-card">
      <p><label>Pace (speed only, not a quality grade): <select name="pace" required>
        <option value="">Choose</option><option value="1">1: very slow, over 90 min</option><option value="2">2: slow, 75 to 90 min</option>
        <option value="3">3: moderate, 60 to 75 min</option><option value="4">4: brisk, 45 to 60 min</option><option value="5">5: very quick, under 45 min</option></select></label></p>
      <p class="small" data-anchor="pace">Pick a pace to see what it means.</p>
      <p class="small">${MASS_TIMING_NOTE}</p>
      <p><label>Homily performance: <select name="homily" required>
        <option value="">Choose</option><option value="1">1: lost me</option><option value="2">2: forgettable</option>
        <option value="3">3: solid</option><option value="4">4: memorable</option><option value="5">5: shapes my week</option></select></label></p>
      <p class="small" data-anchor="homily">Pick a homily rating to see what it means.</p>
      <p><label>Likability: <select name="likability" required>
        <option value="">Choose</option><option value="1">1: off-putting</option><option value="2">2: distant</option>
        <option value="3">3: pleasant</option><option value="4">4: warm</option><option value="5">5: a real shepherd</option></select></label></p>
      <p class="small" data-anchor="likability">Pick a likability rating to see what it means.</p>
      <fieldset class="church-fieldset"><legend>The church building (optional)</legend>
      <p><label>How beautiful is the church building itself? <select name="church_beauty">
        <option value="">No rating</option><option value="1">1: run down</option><option value="2">2: modest</option>
        <option value="3">3: pleasant</option><option value="4">4: beautiful</option><option value="5">5: stunning</option></select></label></p>
      <p class="small" data-anchor="church_beauty">Pick a rating to see what it means.</p>
      <p class="small">This rates the building, not the priest. It never affects the priest's score, and it is shown separately on the profile.</p></fieldset>
      <p><label>How long have you attended this parish or known this priest? <select name="attendance_duration" required>
        <option value="">Choose</option>${ATTENDANCE_OPTIONS.map((o) => `<option value="${esc(o)}">${esc(o)}</option>`).join('')}</select></label></p>
      <p><label>Mass context (optional): <input name="mass_context" maxlength="120" placeholder="e.g. Sunday 10am Mass"></label></p>
      <p><label>Written review (optional):<br><textarea name="body" rows="4" maxlength="2000"></textarea></label></p>
      <p class="small">Reviews are anonymous. No name or email is collected.</p>
      <p><label><input type="checkbox" name="attest_age" required> I confirm I am 18 or older.</label></p>
      <p><label><input type="checkbox" name="attest_honest" required> I confirm this review is my own honest opinion.</label></p>
      <button type="submit" class="btn btn--gold">Submit review</button>
    </form>
  </section>`;
  res.send(page(p.name, `<article class="profile-card">
    <div class="profile-banner" aria-hidden="true"></div>
    <div class="profile-body">
      <header class="profile-head">
        <p class="eyebrow">Priest profile</p>
        <h1 class="profile-name">${esc(p.name)}</h1>
        <p class="profile-meta">${assignment(p)}</p>
        ${lifeStatusHtml(p)}
        ${p.user_added ? '<p><span class="badge">User-added profile</span></p>' : ''}
        <p>${saveBtn(p, 'Save this priest')}</p>
      </header>
      <dl class="profile-facts">${factRows.join('')}</dl>
      <div class="rule" aria-hidden="true"><span></span></div>
      <section class="rating-summary band" aria-label="Rating summary">
        <p class="eyebrow">Ratings</p>
        <div class="score-row">${scoreBoxLg}${barsHtml ? `<div class="bars">${barsHtml}</div>` : ''}</div>
        ${st && st.n ? `<p class="profile-count">Based on ${st.n} review${st.n === 1 ? '' : 's'}${st.n === 1 ? ' &mdash; a first impression, not a consensus' : ''}.</p>` : '<p class="profile-count">No published reviews yet. Be the first to rate this priest.</p>'}
        ${st && st.n ? '<p class="small">Pace measures speed only, not quality.</p>' : ''}
      </section>
      ${church && church.n ? `<div class="church-box card--ruled"><p class="eyebrow">The building, not the priest</p><h3>The church building</h3><p><strong>${Number(church.avg).toFixed(1)} out of 5</strong> for church beauty, from ${church.n} review${church.n === 1 ? '' : 's'}. This rates the building, not the priest, and it never affects the priest's score above.</p></div>` : '<div class="church-box card--ruled"><p class="eyebrow">The building, not the priest</p><h3>The church building</h3><p>No church beauty ratings yet. When you review, you can rate how beautiful the building is. That rating is about the church, not the priest, and it never affects the priest\'s score.</p></div>'}
      ${massTimesHtml(p)}
      <p class="profile-note">${DISCLAIMER}</p>
    </div>
  </article>
  ${rateSection}
  <section class="reviews-section">
    <div class="section-head">
      <p class="eyebrow">Reviews</p>
      <h2>Published reviews</h2>
      ${revs.length ? `<p class="lede">${revs.length} published review${revs.length === 1 ? '' : 's'}, most recent first. Approved reviews only.</p>` : ''}
    </div>
    ${reviewHtml}
    <p class="correction-row"><a class="btn btn--ghost btn--sm" href="/priest/${p.id}/correct">Correction, right of reply, or removal request</a></p>
  </section>`, '<script' + cspNonceAttr() + '>window.RMF_ANCHORS = ' + JSON.stringify(ANCHORS).replace(/</g, '\\u003c') + ';</script><script src="/review.js"></script>'));
});

app.post('/priest/:id/review', async (req, res) => {
  const pid = Number(req.params.id);
  const { rows } = await pool.query(`SELECT id FROM priests WHERE id=$1 AND status='approved' AND ${ACTIVE_WHERE}`, [pid]);
  if (!rows.length) return res.status(404).send(page('Not found', '<h1>Priest not found</h1>'));
  const pace = Number(req.body.pace), homily = Number(req.body.homily), likability = Number(req.body.likability);
  const body = (req.body.body || '').trim().slice(0, 2000);
  const massContext = (req.body.mass_context || '').trim().slice(0, 120);
  const attendance = (req.body.attendance_duration || '').trim();
  // Church beauty is optional and rates the BUILDING, not the priest. It is
  // stored on the review but never enters the priest's score.
  const churchRaw = String(req.body.church_beauty || '').trim();
  const churchBeauty = churchRaw === '' ? null : Number(churchRaw);
  if (churchBeauty !== null && !(Number.isInteger(churchBeauty) && churchBeauty >= 1 && churchBeauty <= 5)) {
    return res.status(400).send(page('Review not submitted', '<h1>Review not submitted</h1><p>Church beauty, if given, must be a whole number from 1 to 5.</p>'));
  }
  if (![pace, homily, likability].every((v) => Number.isInteger(v) && v >= 1 && v <= 5)) {
    return res.status(400).send(page('Review not submitted', '<h1>Review not submitted</h1><p>Each rating must be a whole number from 1 to 5.</p>'));
  }
  if (!ATTENDANCE_OPTIONS.includes(attendance)) {
    return res.status(400).send(page('Review not submitted', '<h1>Review not submitted</h1><p>Please choose how long you have attended this parish or known this priest.</p>'));
  }
  if (!req.body.attest_age || !req.body.attest_honest) {
    return res.status(400).send(page('Review not submitted', '<h1>Review not submitted</h1><p>Both attestations are required: you must confirm you are 18 or older and that the review is your own honest opinion.</p>'));
  }
  const token = sourceTokenHash(req);
  const screen = screenBody(body);
  if (screen.outcome === 'refuse') {
    const msg = screen.reason === 'profanity'
      ? 'Reviews with bad language are not accepted. Please reword your review without the bad language. Nothing was published and nothing is held.'
      : 'Reviews containing private contact details such as phone numbers or email addresses are not accepted. Nothing was published and nothing is held.';
    return res.status(400).send(page('Review refused', `<h1>Review refused</h1><p>${msg}</p>`));
  }
  // Duplicate check: same priest, same source token (any non-rejected review).
  const dup = await pool.query(`SELECT id FROM reviews WHERE priest_id=$1 AND source_token_hash=$2 AND status <> 'rejected' LIMIT 1`, [pid, token]);
  if (dup.rows.length) {
    return res.status(400).send(page('Review refused', '<h1>Review refused</h1><p>You have already submitted a review of this priest. Repeat reviews of the same priest from the same source are not accepted.</p>'));
  }
  // Burst check: more than BURST_LIMIT reviews in the last hour from this source.
  const burst = await pool.query(`SELECT COUNT(*)::int AS n FROM reviews WHERE source_token_hash=$1 AND created_at > NOW() - INTERVAL '1 hour'`, [token]);
  if (burst.rows[0].n >= BURST_LIMIT) {
    return res.status(429).send(page('Review refused', `<h1>Review refused</h1><p>Too many reviews in a short time. After ${BURST_LIMIT} reviews in an hour from one source, further reviews are refused. Please try again later.</p>`));
  }
  let status = screen.outcome === 'approve' ? 'approved' : 'pending';
  let abuseFlag = !!screen.abuseFlag;
  let flagReason = screen.outcome === 'hold' ? screen.reason : null;
  // Spike check: SPIKE_THRESHOLD+ reviews of this priest in 24h force-holds this one.
  const spike = await pool.query(`SELECT COUNT(*)::int AS n FROM reviews WHERE priest_id=$1 AND created_at > NOW() - INTERVAL '24 hours'`, [pid]);
  if (spike.rows[0].n >= SPIKE_THRESHOLD) { status = 'pending'; flagReason = 'spike'; }
  const ins = await pool.query(
    `INSERT INTO reviews (priest_id, pace, homily, likability, church_beauty, mass_context, attendance_duration, body, status, source_token_hash, abuse_flag, flag_reason)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
    [pid, pace, homily, likability, churchBeauty, massContext || null, attendance, body || null, status, token, abuseFlag, flagReason]);
  await audit(status === 'approved' ? 'review_auto_approved' : 'review_held', 'review', ins.rows[0].id, flagReason);
  if (status === 'approved') {
    res.send(page('Review published', `<h1>Thank you</h1><p>Your review passed screening and is now public. It can still be removed later if it is reported and found to break the rules.</p><p><a href="/priest/${pid}">Back to profile</a></p>`));
  } else {
    res.send(page('Review held for moderation', `<h1>Thank you</h1><p>Your review is held for moderation and is <strong>not public</strong>. A held review counts toward nothing: no averages, no counts, no listings. Nothing is live until it passes screening.</p><p><a href="/priest/${pid}">Back to profile</a></p>`));
  }
});

// ---------- public feed-in: add priest, report, correction, legal ----------
app.get('/add-priest', (req, res) => res.send(page('Add a priest', `<h1>Add a priest</h1>
  <p>Submitted priests are held for moderation before going public. Approved user-added priests are marked as user-added.</p>
  <form action="/add-priest" method="post">
    <p><label>Name (required): <input name="name" required maxlength="200"></label></p>
    <p><label>Parish: <input name="parish" maxlength="200"></label></p>
    <p><label>City: <input name="city" maxlength="100"></label></p>
    <p><label>State: <input name="state" maxlength="2"></label></p>
    <p><label>ZIP (optional, only used for exact-ZIP matching of this user-added profile): <input name="zip" pattern="\\d{5}"></label></p>
    <button type="submit">Submit for moderation</button></form>`)));
app.post('/add-priest', submitLimiter, async (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).send(page('Not submitted', '<h1>Not submitted</h1><p>A name is required.</p>'));
  if (name.length > 200) return res.status(400).send(page('Not submitted', '<h1>Not submitted</h1><p>A name must be 200 characters or fewer.</p>'));
  const parish = (req.body.parish || '').trim().slice(0, 200) || null;
  const city = (req.body.city || '').trim().slice(0, 100) || null;
  const state = (req.body.state || '').trim().toUpperCase().slice(0, 2) || null;
  await pool.query(`INSERT INTO priests (name, parish, city, state, zip, source, user_added, status)
    VALUES ($1,$2,$3,$4,$5,'user_submitted',true,'pending')`,
    [name, parish, city, state, /^\d{5}$/.test(req.body.zip || '') ? req.body.zip : null]);
  await audit('priest_submitted', 'priest', null, name);
  res.send(page('Submitted', '<h1>Thank you</h1><p>This priest has been submitted and is held for moderation. It will not appear publicly until an owner approves it.</p>'));
});

app.get('/report', async (req, res) => res.send(page('Report a review', `<h1>Report a review</h1>
  <p>Reporting only flags the review for the moderation queue. It does not remove anything by itself.</p>
  <form action="/report" method="post">
    <input type="hidden" name="review_id" value="${esc(req.query.review || '')}">
    <input type="hidden" name="priest_id" value="${esc(req.query.priest || '')}">
    <p><label>Reason: <select name="reason" required><option value="">Choose</option>
      <option>Contains a factual allegation</option><option>Abusive or harassing</option>
      <option>Private information</option><option>Spam</option><option>Other</option></select></label></p>
    <p><label>Details (optional):<br><textarea name="details" rows="4" maxlength="2000"></textarea></label></p>
    <button type="submit">Submit report</button></form>`)));
const REPORT_REASONS = ['Contains a factual allegation', 'Abusive or harassing', 'Private information', 'Spam', 'Other'];
app.post('/report', submitLimiter, async (req, res) => {
  const reason = REPORT_REASONS.includes(req.body.reason) ? req.body.reason : 'Other';
  const details = (req.body.details || '').trim().slice(0, 2000) || null;
  await pool.query(`INSERT INTO reports (review_id, priest_id, reason, details) VALUES ($1,$2,$3,$4)`,
    [numOrNull(req.body.review_id), numOrNull(req.body.priest_id), reason, details]);
  await audit('report_submitted', 'report', null, reason);
  res.send(page('Report received', '<h1>Report received</h1><p>Thank you. The report has been flagged for the moderation queue. Nothing has been removed by this report alone.</p>'));
});

app.get('/priest/:id/correct', async (req, res) => res.send(page('Correction or removal request', `<h1>Correction, right of reply, or removal request</h1>
  <p>Use this form for a correction to a listing, a right of reply to a review, or a removal request. Submissions go to the moderation queue. Any contact details you provide are never published.</p>
  <form action="/correction" method="post">
    <input type="hidden" name="priest_id" value="${esc(req.params.id)}">
    <p><label>Type: <select name="type" required><option value="correction">Correction</option><option value="reply">Right of reply</option><option value="removal">Removal request</option></select></label></p>
    <p><label>Details (required):<br><textarea name="details" rows="5" maxlength="3000" required></textarea></label></p>
    <p><label>Contact (optional, never published): <input name="contact" maxlength="200"></label></p>
    <button type="submit">Submit</button></form>`)));
app.post('/correction', submitLimiter, async (req, res) => {
  const priestId = numOrNull(req.body.priest_id);
  const details = (req.body.details || '').trim();
  if (!details || !priestId) return res.status(400).send(page('Not submitted', '<h1>Not submitted</h1><p>Details and a priest are required.</p>'));
  if (details.length > 3000) return res.status(400).send(page('Not submitted', '<h1>Not submitted</h1><p>Details must be 3000 characters or fewer.</p>'));
  const type = ['correction', 'reply', 'removal'].includes(req.body.type) ? req.body.type : 'correction';
  const contact = (req.body.contact || '').trim().slice(0, 200) || null;
  await pool.query(`INSERT INTO corrections (priest_id, type, details, contact) VALUES ($1,$2,$3,$4)`,
    [priestId, type, details, contact]);
  await audit('correction_submitted', 'correction', null, type);
  res.send(page('Request received', '<h1>Request received</h1><p>Thank you. Your request has been flagged for the moderation queue.</p>'));
});

app.get('/legal', (req, res) => res.send(page('Legal notices', `<h1>Legal notices</h1>
  <p>Use this form to submit a legal notice. Notices go to the moderation queue. No personal email is published on this site.</p>
  <form action="/legal" method="post">
    <p><label>Notice (required):<br><textarea name="details" rows="6" maxlength="5000" required></textarea></label></p>
    <p><label>Contact (optional, never published): <input name="contact" maxlength="200"></label></p>
    <button type="submit">Submit notice</button></form>`)));
app.post('/legal', submitLimiter, async (req, res) => {
  const details = (req.body.details || '').trim();
  if (!details) return res.status(400).send(page('Not submitted', '<h1>Not submitted</h1><p>Notice text is required.</p>'));
  if (details.length > 5000) return res.status(400).send(page('Not submitted', '<h1>Not submitted</h1><p>Notice text must be 5000 characters or fewer.</p>'));
  const contact = (req.body.contact || '').trim().slice(0, 200) || null;
  await pool.query(`INSERT INTO legal_notices (details, contact) VALUES ($1,$2)`, [details, contact]);
  await audit('legal_notice_submitted', 'legal_notice', null, '');
  res.send(page('Notice received', '<h1>Notice received</h1><p>Thank you. Your notice has been flagged for the moderation queue.</p>'));
});

// ---------- informational pages ----------
function infoPage(title, inner) { return page(title, `<div class="prose"><h1>${esc(title)}</h1>${inner}</div>`); }
app.get('/about', (req, res) => res.send(page('About', `<div class="prose about-page">
  <div class="section-head">
    <p class="eyebrow">About RateMyFather</p>
    <h1>About</h1>
    <p class="lede">Anonymous ratings of pace, homily, and likability.</p>
  </div>
  <section class="about-section"><h2>What this is</h2>
  <p>RateMyFather is a place for people in the pews to share honest, anonymous ratings of Catholic priests. Every priest is rated on three things: pace (how quickly Mass moves), the homily, and likability. The idea is simple. If you are new to a town, travelling, or looking for a parish that fits you better, you can see what other people in the pews actually thought, and find a priest and a parish that suit you.</p></section>
  <div class="rule" aria-hidden="true"><span></span></div>
  <section class="about-section band"><h2>How the ratings work</h2>
  <p>Reviews are anonymous. No name or email is collected, and every rating is 1 to 5 on pace, homily, and likability only. Pace measures speed alone, not quality: a slow Mass is not a bad Mass. Every average is shown with its review count, so you can see how many people stand behind a score.</p>
  <p>You can also rate the church building itself, from 1 (plain) to 5 (stunning). That rating is about the building, not the priest. It lives in its own box on the profile, and it never affects the priest's score, averages, or rankings. A priest is never punished because their church is not beautiful.</p></section>
  <div class="rule" aria-hidden="true"><span></span></div>
  <section class="about-section"><h2>Where the profiles come from</h2>
  <p>The priest profiles come from the 2017 Official Catholic Directory Priests Index. Each directory profile says so on the page. Assignments shown as "Listed at ..." are historical listings from that directory, not a claim about where a priest serves today.</p>
  <p>We have also gone through the directory and attempted to verify and update the profiles against current diocese and parish sources, and that work is still going. In the verification sweep so far, about 37,793 profiles were checked and about 15,272 were resolved. But the underlying directory is still the 2017 one, so some listings may be out of date. Please treat parish assignments as a starting point, not a guarantee.</p></section>
  <div class="rule" aria-hidden="true"><span></span></div>
  <section class="about-section"><h2>If something is wrong</h2>
  <p>If a listing is wrong or out of date, you can report it. Every priest's profile has a correction form, and the owner reviews each correction. ${DISCLAIMER}</p><p>No paid placement. No sponsored priests.</p></section>
  <section class="tip-box">
    <h2>Buy the creator a coffee</h2>
    <p>RateMyFather is a passion project, kept free and ad free. If it has helped you find a Mass you love, a small tip keeps it that way.</p>
    <a class="tip-link" href="https://ko-fi.com/ratemyfather" target="_blank" rel="noopener">Buy the creator a coffee on Ko-fi</a>
  </section></div>`)));
// Star tables for the How page, built from ANCHORS itself so the page can
// never drift from what the review form shows. 5 first, 1 last.
// Pace rows drop the repeated "on a Sunday" (stripSunday): the Sunday basis
// is stated once, in the line above the pace list.
function anchorRows(key, stripSunday) {
  return [5, 4, 3, 2, 1].map(n => {
    const a = ANCHORS[key][n];
    let text = a.text;
    if (stripSunday) text = text.replace(/ on a Sunday\./, '.');
    return `<li>${starsHtml(n)}<span>${esc(text)}</span></li>`;
  }).join('');
}
app.get('/how', (req, res) => res.send(page('How ratings work', `<div class="prose how-page">
  <div class="section-head">
    <p class="eyebrow">How ratings work</p>
    <h1>How ratings work</h1>
    <p class="lede">Each rating is 1 to 5 in three categories.</p>
  </div>
  <div class="how-cats">
    <div class="how-cat-card card--ruled"><h3>Pace</h3><p><strong>Pace measures speed only.</strong> 5 is brisk and quick, 1 is very slow. Pace is not a quality grade: a slow Mass is not a bad Mass.</p></div>
    <div class="how-cat-card card--ruled"><h3>Homily</h3><p><strong>Homily performance:</strong> 1 is poor, 5 is excellent.</p></div>
    <div class="how-cat-card card--ruled"><h3>Likability</h3><p><strong>Likability:</strong> 1 is not likable, 5 is very likable.</p></div>
  </div>
  <section class="how-section"><h2>What the stars mean</h2>
  <p>Each star has a plain description, the same one shown in the review form, so a reviewer picks from a real basis instead of guessing.</p>
  <h3>Pace</h3>
  <p>Pace times are for a Sunday Mass.</p>
  <ul class="anchor-list">${anchorRows('pace', true)}</ul>
  <p class="how-note">${esc(MASS_TIMING_NOTE)}</p>
  <h3>Homily</h3>
  <ul class="anchor-list">${anchorRows('homily')}</ul>
  <h3>Likability</h3>
  <ul class="anchor-list">${anchorRows('likability')}</ul>
  <h3>Church beauty</h3>
  <ul class="anchor-list">${anchorRows('church_beauty')}</ul></section>
  <section class="how-section"><h2>How averages work</h2>
  <p>Every average score is shown with its review count, everywhere it appears. Averages use approved reviews only. A held review counts toward nothing.</p>
  <p>Category lists ("Quick Mass", "Great homily", "Lovable priest") show rated priests only, sorted by that category average highest first, tie-broken by review count. Listings based on a single review carry a single-review caveat.</p>
  <p>Each review also says how long the reviewer has attended the parish or known the priest, from a first-time visitor to a lifelong parishioner, and that is printed on the review so readers can weigh it.</p></section>
  <section class="how-section"><h2>How reviews are checked</h2>
  <ul class="how-list">
    <li>Star-only and clearly clean reviews may auto-approve.</li>
    <li>Borderline reviews wait in the moderation queue.</li>
    <li>Possible unverified factual allegations (misconduct, crimes, improper behavior) are force-held with an abuse flag and never auto-approved.</li>
    <li>Reviews containing phone numbers or email addresses are refused outright.</li>
    <li>Reviews containing bad language are refused outright.</li>
    <li>A repeat review of the same priest from the same source is refused.</li>
    <li>After 5 reviews in an hour from one source, further reviews are refused.</li>
    <li>If 10 or more reviews of one priest arrive in 24 hours, further reviews of that priest are force-held.</li>
  </ul></section>
  <section class="how-section band"><h2>Church beauty is separate</h2>
  <p><strong>Church beauty is separate from the priest's score.</strong> When you review, you can optionally rate how beautiful the church building is, from 1 (plain) to 5 (stunning). That rating is about the building, not the priest. It is shown on the profile in its own box with its own review count, and it never affects the priest's score, averages, rankings, or category lists. A priest is never punished because their church is not beautiful.</p></section>
  <section class="how-section"><h2>Anonymous reviews</h2>
  <p>Reviews are anonymous. No name or email is collected. For abuse prevention only, the site stores a hashed token derived from request data (see Privacy Policy).</p></section>
  <section class="how-section"><h2>Opinions, not verified facts</h2>
  <p>Reviews are user opinions, not verified facts. The site does not verify or endorse them. If you believe a review is unlawful or about you, use the <a href="/legal">Legal notices</a> page or the correction form on the priest's profile.</p></section></div>`)));
app.get('/terms', (req, res) => res.send(infoPage('Terms of Use', `<p>Reviews are user-generated opinions. They are the individual reviewer's own opinion, not statements of fact, not verified by RateMyFather, and not endorsed by RateMyFather. A rating reflects one person's experience, not a finding about a priest.</p>
  <p>By submitting a review, you confirm you are 18 or older and that the review is your own honest opinion. You are responsible for what you submit. You must not submit private contact details, unverified factual allegations about identifiable people, or content you do not have the right to post.</p>
  <p>RateMyFather is not liable for user-submitted content. The site hosts reviews as a platform for user opinions; it does not adopt, verify, or stand behind them.</p>
  <p>The owner may approve, hold, reject, or remove any content at any time, for any reason, under the Content and Moderation Policy. Nothing on this site is guaranteed to stay published.</p>
  <p>If you believe content is unlawful, inaccurate, or about you, you can submit a legal notice or a correction. Use the <a href="/legal">Legal notices</a> page to submit a legal notice, or the correction form on a priest's profile to request a correction, a right of reply, or a removal. Links to both are in the footer of every page.</p>
  <p>No paid placement: no priest, parish, or diocese can pay for placement, ranking, or promotion on this site.</p>
  <p>This site does not claim that the site or its owner is immune from suit.</p>`)));
app.get('/privacy', (req, res) => res.send(infoPage('Privacy Policy', `<p>What is collected:</p>
  <ul><li><strong>Reviews:</strong> the three 1-5 ratings, how long you have attended the parish or known the priest, optional Mass context, and optional written review text you submit. No name or email is collected with reviews.</li>
  <li><strong>Daily trivia:</strong> an optional display name you type for the day's leaderboard, plus your points. No account, no email.</li>
  <li><strong>Abuse-prevention token:</strong> a SHA-256 hash derived from request data (IP address plus user agent). Only the hash is stored, never the raw IP address or user agent string. It is used only to refuse duplicates, enforce the hourly review limit, and detect review spikes.</li>
  <li><strong>Moderation submissions:</strong> reports, corrections, right-of-reply and removal requests, and legal notices, including any optional contact details you choose to provide. Contact details are never published.</li>
  <li><strong>Owner session:</strong> a signed, httpOnly session cookie is set only when the owner signs in. It contains an expiry time, a random session id, and a signature. The session id is also recorded server-side so signing out revokes the session; nothing else is stored with it.</li>
  <li><strong>Visit statistics:</strong> aggregate, anonymous counts of page views via Google Analytics 4, run in cookieless mode. It sets no cookies, collects no name, email, or IP address, and is used only to see which pages are visited.</li></ul>
  <p>Nothing else is collected. There is no advertising on this site.</p>
  <p>To request removal of personal information you submitted, use the <a href="/legal">Legal notices</a> page. Contact details you provide in a legal notice are never published.</p>`)));
app.get('/moderation', (req, res) => res.send(infoPage('Content & Moderation Policy', `<p>All moderation is owner-only and enforced on the server. Public buttons (report, correction, legal notice) only flag the queue; they never approve, reject, or delete anything.</p>
  <p>Star-only and clearly clean reviews may auto-approve. Borderline reviews wait for a human owner decision. Possible unverified factual allegations are force-held with an abuse flag and never auto-approved. Reviews with private contact details are refused. Reviews with bad language are refused. Repeat reviews of the same priest from the same source are refused. Hourly bursts (over 5 per source) are refused. 24-hour spikes (10 or more per priest) are force-held.</p>
  <p>The owner can approve or reject pending reviews and user-added profiles, delete reviews and user-added profiles, and resolve reports, corrections, and legal notices. Directory profiles are never deleted.</p>
  <p>Review of reviews and deletion are owner-only functions, enforced server side, not merely hidden in the interface.</p>`)));

// ---------- chatbot: site data only, aggregated approved scores with counts ----------
app.post('/api/chat', chatLimiter, async (req, res) => {
  // F-13 (Iteration 2): the message is a single-line search box, so it
  // is capped at 500 chars server-side (truncated, not rejected — a
  // long paste still searches on its first 500 chars), and the search
  // terms built from it are capped at 5, so a crafted message cannot
  // build a query with thousands of ILIKE conditions.
  const msg = String(req.body.message || '').trim().slice(0, 500);
  const lower = msg.toLowerCase();
  const filterMap = [['quick', 'quick'], ['quick mass', 'quick'], ['great homily', 'homily'], ['homily', 'homily'], ['lovable', 'lovable'], ['likable', 'lovable'], ['likeable', 'lovable']];
  let filter = null;
  for (const [phrase, f] of filterMap) if (lower.includes(phrase)) { filter = f; break; }
  const col = filter ? FILTERS[filter] : null;
  let priests = [];
  if (filter) {
    // Rank across ALL rated priests, not just the first 200 alphabetical rows.
    const { rows } = await pool.query(
      `SELECT p.*, COUNT(r.id)::int AS n, AVG(r.pace) AS pace, AVG(r.homily) AS homily, AVG(r.likability) AS likability FROM priests p JOIN reviews r ON r.priest_id = p.id AND r.status='approved' WHERE p.status='approved' AND ${ACTIVE_WHERE_P} GROUP BY p.id ORDER BY AVG(r.${col}) DESC, COUNT(r.id) DESC LIMIT 5`);
    priests = rows.map((p) => ({ p, st: { n: p.n, pace: p.pace, homily: p.homily, likability: p.likability } }));
  } else {
    const words = lower.replace(/[^a-z\s'-]/g, ' ').split(/\s+/).filter((w) => w.length >= 3);
    const stop = new Set(['who', 'what', 'where', 'about', 'priest', 'father', 'rated', 'rating', 'ratings', 'tell', 'show', 'find', 'search', 'for', 'the', 'and', 'any']);
    const terms = [...new Set(words.filter((w) => !stop.has(w)))].slice(0, 5);
    if (terms.length) {
      const like = terms.map((t) => `%${t}%`);
      // ALL terms must match the name. OR let one stray term (e.g. "such"
      // in "Zzqx No Such Priest") return an unrelated priest such as
      // "Bandsuch", instead of the no-match path with the add link.
      const cond = terms.map((_, i) => `name ILIKE $${i + 1}`).join(' AND ');
      const { rows } = await pool.query(`SELECT * FROM priests WHERE status='approved' AND ${ACTIVE_WHERE} AND (${cond}) ORDER BY name LIMIT 10`, like);
      // Rank by how many search terms the name actually contains, with a
      // bonus when the whole query phrase matches at a word boundary, so an
      // exact-name match (e.g. "Lech") outranks a mid-word substring match
      // (e.g. "Kelechi").
      const phrase = lower.replace(/[^a-z\s'-]/g, ' ').replace(/\s+/g, ' ').trim();
      const boundaryRe = phrase ? new RegExp('(^|[^a-z])' + phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')) : null;
      const stats0 = await statsFor(rows.map((r) => r.id));
      rows.sort((a, b) => {
        const score = (p) => {
          const ln = p.name.toLowerCase();
          return terms.filter((t) => ln.includes(t)).length + (boundaryRe && boundaryRe.test(ln) ? 2 : 0);
        };
        // Name-match score first, then review count (a rated match is more
        // informative than an unrated one), then alphabetical.
        return score(b) - score(a) || (stats0[b.id]?.n || 0) - (stats0[a.id]?.n || 0) || a.name.localeCompare(b.name);
      });
      const stats = stats0;
      priests = rows.slice(0, 5).map((p) => ({ p, st: stats[p.id] }));
    }
  }
  if (!priests.length) {
    return res.json({ text: `I could not find a matching priest in the directory. You can add a priest for moderation review.`, cards: [], addLink: '/add-priest' });
  }
  const cards = priests.map(({ p, st }) => ({
    id: p.id, url: `/priest/${p.id}`, name: p.name,
    assignment: `Listed at ${p.parish || 'an unlisted parish'}${p.city || p.state ? `, ${[p.city, p.state].filter(Boolean).join(', ')}` : ''}`,
    userAdded: !!p.user_added,
    reviewCount: st ? st.n : 0,
    averages: st ? { pace: fmtAvg(st.pace), homily: fmtAvg(st.homily), likability: fmtAvg(st.likability) } : null,
    ratedText: st ? `Pace ${fmtAvg(st.pace)}, homily ${fmtAvg(st.homily)}, likability ${fmtAvg(st.likability)} (based on ${st.n} review${st.n === 1 ? '' : 's'})` : 'Not rated yet',
  }));
  const first = cards[0];
  const text = filter
    ? `Top priests for ${FILTER_LABELS[filter]} (approved reviews only, with review counts):`
    : (first.reviewCount === 0
      ? `${first.name} is listed but has no reviews yet: Not rated yet.`
      : `${first.name} is listed at ${first.assignment.replace(/^Listed at /, '')}. Approved-review averages with counts are shown on the card.`);
  res.json({ text, cards });
});

// ---------- owner moderation (every route gated server side) ----------
app.get('/owner/login', (req, res) => res.send(page('Owner sign-in', `<h1>Owner moderation sign-in</h1>
  ${OWNER_SECRET ? '' : '<p class="notice">Owner moderation is not configured on this deployment (no owner secret set).</p>'}
  <form action="/owner/login" method="post">
    <p><label>Owner secret: <input type="password" name="secret" required autocomplete="off"></label></p>
    <button type="submit">Sign in</button></form>`)));
app.post('/owner/login', ownerCsrf, async (req, res) => {
  if (!OWNER_SECRET) return res.status(403).send(page('Forbidden', '<h1>Owner moderation is not configured.</h1>'));
  const ip = realClientIp(req);
  if (loginBlocked(ip)) {
    return res.status(429).send('Too many failed sign-in attempts. Please wait and try again later.');
  }
  const supplied = String(req.body.secret || '');
  // Timing-safe comparison against the env secret (hash both first so lengths match).
  const a = crypto.createHash('sha256').update(supplied).digest();
  const b = crypto.createHash('sha256').update(OWNER_SECRET).digest();
  if (!crypto.timingSafeEqual(a, b)) {
    recordLoginFailure(ip);
    return res.status(403).send(page('Sign-in failed', '<h1>Sign-in failed</h1><p>The secret did not match.</p>'));
  }
  resetLoginAttempts(ip);
  // New session: random sid, recorded server-side so logout can revoke
  // it (F-05). The cookie is set only after the row is written; if the
  // write fails, login fails rather than issuing an unrevocable token.
  const exp = Date.now() + 12 * 60 * 60 * 1000;
  const sid = crypto.randomUUID();
  try {
    await pool.query('INSERT INTO owner_sessions (sid, expires_at) VALUES ($1, $2)', [sid, new Date(exp)]);
    await pool.query('DELETE FROM owner_sessions WHERE expires_at < NOW()');
  } catch (e) {
    console.error('owner session create failed', e.message);
    return res.status(500).send(page('Sign-in failed', '<h1>Sign-in failed</h1><p>The sign-in could not be completed. Please try again.</p>'));
  }
  const cookie = signSession({ exp, sid });
  // __Host- prefix + Secure: the cookie is only ever sent over HTTPS and
  // cannot be shadowed by a subdomain cookie. This signs the owner out
  // once (the old rmf_owner cookie is no longer read); he must sign in
  // again with the secret saved in his password manager.
  res.setHeader('Set-Cookie', `__Host-rmf_owner=${cookie}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=43200`);
  res.redirect('/owner');
});
app.post('/owner/logout', ownerCsrf, async (req, res) => {
  // Logout revokes: delete the session row, so the signed cookie stops
  // working even though its 12-hour expiry has not passed (F-05). The
  // browser copy is cleared as well. A missing/invalid cookie is still
  // cleared and redirected — logout never errors.
  try {
    const payload = parseSession(req.headers.cookie || '');
    if (payload && payload.sid) await pool.query('DELETE FROM owner_sessions WHERE sid=$1', [payload.sid]);
  } catch (e) { console.error('owner session revoke failed', e.message); }
  res.setHeader('Set-Cookie', '__Host-rmf_owner=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0');
  res.redirect('/');
});

// Queue page: owner-only. Redirecting an unauthenticated browser to sign-in is
// presentation only; all data reads/writes below still pass requireOwner.
app.get('/owner', requireOwner, async (req, res) => {
  const pendingReviews = (await pool.query(`SELECT r.*, p.name AS priest_name FROM reviews r JOIN priests p ON p.id=r.priest_id WHERE r.status='pending' ORDER BY r.created_at DESC LIMIT 100`)).rows;
  const pendingPriests = (await pool.query(`SELECT * FROM priests WHERE status='pending' ORDER BY created_at DESC LIMIT 100`)).rows;
  const pendingReports = (await pool.query(`SELECT * FROM reports WHERE status='pending' ORDER BY created_at DESC LIMIT 100`)).rows;
  const pendingCorrections = (await pool.query(`SELECT * FROM corrections WHERE status='pending' ORDER BY created_at DESC LIMIT 100`)).rows;
  const pendingLegal = (await pool.query(`SELECT * FROM legal_notices WHERE status='pending' ORDER BY created_at DESC LIMIT 100`)).rows;
  const act = (action, id) => `<form action="/owner/${action}/${id}" method="post" style="display:inline"><button type="submit">`;
  const abuseFlagged = pendingReviews.filter((r) => r.abuse_flag);
  const regularReviews = pendingReviews.filter((r) => !r.abuse_flag);
  const abuseRows = abuseFlagged.map((r) => `<li><strong class="badge" style="background:#b8452a;color:#fff">ABUSE FLAG</strong> ${esc(r.priest_name)}: Pace ${r.pace}, Homily ${r.homily}, Likability ${r.likability}${r.church_beauty ? `, Church beauty ${r.church_beauty}` : ''}${r.flag_reason ? ` &mdash; ${esc(r.flag_reason)}` : ''}${r.body ? `: ${esc(r.body)}` : ' (star-only)'}
    ${act('review-approve', r.id)}Approve</button></form> ${act('review-reject', r.id)}Reject</button></form> ${act('review-delete', r.id)}Delete</button></form></li>`).join('') || '<li>None</li>';
  const reviewRows = regularReviews.map((r) => `<li>${esc(r.priest_name)}: Pace ${r.pace}, Homily ${r.homily}, Likability ${r.likability}${r.church_beauty ? `, Church beauty ${r.church_beauty}` : ''}${r.flag_reason ? ` [${esc(r.flag_reason)}]` : ''}${r.body ? `: ${esc(r.body)}` : ' (star-only)'}
    ${act('review-approve', r.id)}Approve</button></form> ${act('review-reject', r.id)}Reject</button></form> ${act('review-delete', r.id)}Delete</button></form></li>`).join('') || '<li>None</li>';
  const priestRows = pendingPriests.map((p) => `<li>${esc(p.name)} (${assignment(p)})
    ${act('priest-approve', p.id)}Approve</button></form> ${act('priest-reject', p.id)}Reject</button></form></li>`).join('') || '<li>None</li>';
  const reportRows = pendingReports.map((r) => `<li>Review ${r.review_id || 'n/a'}: ${esc(r.reason)}${r.details ? `: ${esc(r.details)}` : ''} ${act('report-resolve', r.id)}Resolve</button></form></li>`).join('') || '<li>None</li>';
  const corrRows = pendingCorrections.map((r) => `<li>Priest ${r.priest_id}: ${esc(r.type)}: ${esc(r.details)} ${act('correction-resolve', r.id)}Resolve</button></form></li>`).join('') || '<li>None</li>';
  const legalRows = pendingLegal.map((r) => `<li>${esc(r.details.slice(0, 200))} ${act('legal-resolve', r.id)}Resolve</button></form></li>`).join('') || '<li>None</li>';
  res.send(page('Owner moderation', `<h1>Owner moderation queue</h1>
    <p><a href="/owner/audit">View auto-approved audit list</a></p>
    <form action="/owner/logout" method="post"><button type="submit">Sign out</button></form>
    <h2>Abuse-flagged reviews &mdash; review these first</h2>
    <p class="small">These reviews were force-held because they may contain an unverified factual allegation (misconduct, a crime, or improper behavior). They are never auto-approved and are not public. Read each one and approve, reject, or delete it.</p>
    <ul>${abuseRows}</ul>
    <h2>Pending reviews</h2><ul>${reviewRows}</ul>
    <h2>Pending user-added priests</h2><ul>${priestRows}</ul>
    <h2>Pending reports</h2><ul>${reportRows}</ul>
    <h2>Corrections, replies, removals</h2><ul>${corrRows}</ul>
    <h2>Legal notices</h2><ul>${legalRows}</ul>
    <p class="small">Directory profiles are never deleted. Delete controls appear only here, for the owner.</p>`));
});
app.get('/owner/audit', requireOwner, async (req, res) => {
  const rows = (await pool.query(`SELECT * FROM moderation_audit ORDER BY created_at DESC LIMIT 200`)).rows;
  const list = rows.map((r) => `<li>${esc(r.created_at.toISOString())} ${esc(r.action)} ${esc(r.target_type)} ${esc(r.target_id == null ? '' : String(r.target_id))} ${esc(r.detail || '')}</li>`).join('') || '<li>No audit entries yet.</li>';
  res.send(page('Moderation audit', `<h1>Moderation audit</h1><p>Includes auto-approved reviews.</p><ul>${list}</ul><p><a href="/owner">Back to queue</a></p>`));
});

// Every mutation below passes requireOwner BEFORE touching data.
app.post('/owner/review-approve/:id', ownerCsrf, requireOwner, async (req, res) => {
  await pool.query(`UPDATE reviews SET status='approved' WHERE id=$1`, [req.params.id]);
  await audit('review_approved', 'review', Number(req.params.id), 'owner');
  res.redirect('/owner');
});
app.post('/owner/review-reject/:id', ownerCsrf, requireOwner, async (req, res) => {
  await pool.query(`UPDATE reviews SET status='rejected' WHERE id=$1`, [req.params.id]);
  await audit('review_rejected', 'review', Number(req.params.id), 'owner');
  res.redirect('/owner');
});
app.post('/owner/review-delete/:id', ownerCsrf, requireOwner, async (req, res) => {
  await pool.query(`DELETE FROM reviews WHERE id=$1`, [req.params.id]);
  await audit('review_deleted', 'review', Number(req.params.id), 'owner');
  res.redirect('/owner');
});
app.post('/owner/priest-approve/:id', ownerCsrf, requireOwner, async (req, res) => {
  await pool.query(`UPDATE priests SET status='approved' WHERE id=$1`, [req.params.id]);
  await audit('priest_approved', 'priest', Number(req.params.id), 'owner');
  res.redirect('/owner');
});
app.post('/owner/priest-reject/:id', ownerCsrf, requireOwner, async (req, res) => {
  await pool.query(`UPDATE priests SET status='rejected' WHERE id=$1`, [req.params.id]);
  await audit('priest_rejected', 'priest', Number(req.params.id), 'owner');
  res.redirect('/owner');
});
app.post('/owner/priest-delete/:id', ownerCsrf, requireOwner, async (req, res) => {
  const { rows } = await pool.query(`SELECT user_added, source FROM priests WHERE id=$1`, [req.params.id]);
  if (!rows.length) return res.status(404).send(page('Not found', '<h1>Priest not found</h1>'));
  // Directory profiles are NEVER deletable, regardless of owner status.
  if (!rows[0].user_added) return res.status(403).send(page('Refused', '<h1>Refused</h1><p>Directory profiles cannot be deleted. Only user-added profiles can be removed.</p>'));
  await pool.query(`DELETE FROM priests WHERE id=$1`, [req.params.id]);
  await audit('priest_deleted', 'priest', Number(req.params.id), 'user-added only');
  res.redirect('/owner');
});
app.post('/owner/report-resolve/:id', ownerCsrf, requireOwner, async (req, res) => {
  await pool.query(`UPDATE reports SET status='resolved' WHERE id=$1`, [req.params.id]);
  await audit('report_resolved', 'report', Number(req.params.id), 'owner');
  res.redirect('/owner');
});
app.post('/owner/correction-resolve/:id', ownerCsrf, requireOwner, async (req, res) => {
  await pool.query(`UPDATE corrections SET status='resolved' WHERE id=$1`, [req.params.id]);
  await audit('correction_resolved', 'correction', Number(req.params.id), 'owner');
  res.redirect('/owner');
});
app.post('/owner/legal-resolve/:id', ownerCsrf, requireOwner, async (req, res) => {
  await pool.query(`UPDATE legal_notices SET status='resolved' WHERE id=$1`, [req.params.id]);
  await audit('legal_resolved', 'legal_notice', Number(req.params.id), 'owner');
  res.redirect('/owner');
});

// Global error handler. Express 4 does not catch async route rejections, so
// any error that escapes a route lands here as a 500 instead of hanging the
// request or crashing the process on an unhandled rejection.
app.use((err, req, res, next) => {
  console.error(err && err.stack ? err.stack : err);
  if (res.headersSent) return next(err);
  sendErrorPage(res, 500, errorPage({
    title: 'Something went wrong',
    heading: 'The server is having a moment',
    message: 'Our server is busy right now. Give it a minute, then try again — or play a round of the Lost Sheep while you wait.',
    actions: `<div class="btnrow"><button class="btn" type="button" id="err-retry">Try again</button> <a class="btn btn-secondary" href="/">Back to home</a></div>`,
  }));
});

// Catch-all 404: any URL that matches no route above gets the site's helpful
// 404 page (search box, Browse, Arcade, Add-a-priest), not Express's bare
// default "Cannot GET" page.
app.use((req, res) => sendErrorPage(res, 404, notFoundPage()));

// ---------- boot ----------
async function boot() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set. Set it to a Postgres connection string and restart.');
    process.exit(1);
  }
  if (!OWNER_SECRET) console.warn('WARNING: OWNER_SECRET is not set. Owner moderation will refuse all access until it is set.');
  // Bind the port first so the deploy health check passes even if the
  // database is slow to wake (Neon free tier suspends when idle). Then run
  // migrations in the background; all are idempotent (IF NOT EXISTS), so
  // re-running them on boot is safe.
  const server = app.listen(PORT, () => console.log(`RateMyFather listening on port ${PORT}`));
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  const migDir = path.join(__dirname, 'migrations');
  if (fs.existsSync(migDir)) {
    for (const f of fs.readdirSync(migDir).sort()) {
      if (!f.endsWith('.sql')) continue;
      try {
        await pool.query(fs.readFileSync(path.join(migDir, f), 'utf8'));
      } catch (e) {
        console.error('migration failed', f, e.message);
      }
    }
  }
}
boot().catch((e) => { console.error(e); process.exit(1); });
