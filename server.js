// RateMyFather — Node + Express + PostgreSQL. No build step.
// Entry point: server.js. Env: DATABASE_URL, OWNER_SECRET (no default, never hardcoded),
// PORT (default 3000). Run migrations/001_init.sql on boot (idempotent).
// Moderation is enforced SERVER SIDE: every /owner route checks the signed owner
// session cookie before touching data (see requireOwner). Owner login compares the
// supplied secret with OWNER_SECRET using a timing-safe comparison.
// Directory profiles can NEVER be deleted: delete routes refuse user_added=false rows.

const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { screenBody, sourceTokenHash, BURST_LIMIT, SPIKE_THRESHOLD } = require('./lib/screening');
const { REGIONS, regionOf, areaForZip } = require('./lib/regions');

const PORT = process.env.PORT || 3000;
const OWNER_SECRET = process.env.OWNER_SECRET || '';
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.set('trust proxy', 1);

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
  if (!st || !st.n) return `<p class="unrated">Not rated yet</p>`;
  const caveat = st.n === 1 ? `<p class="caveat">Based on a single review.</p>` : '';
  return `<p class="scores">Pace ${fmtAvg(st.pace)} &middot; Homily ${fmtAvg(st.homily)} &middot; Likability ${fmtAvg(st.likability)} <span class="count">(${st.n} review${st.n === 1 ? '' : 's'})</span></p>${caveat}`;
}
function assignment(p) {
  const parts = [];
  if (p.parish) parts.push('Listed at ' + esc(p.parish));
  const loc = [p.city, p.state].filter(Boolean).join(', ');
  if (loc) parts.push(esc(loc));
  return parts.join(' &middot; ') || 'Listing details not available';
}
function priestCard(p, st) {
  return `<article class="card">
    <h3><a href="/priest/${p.id}">${esc(p.name)}</a></h3>
    <p class="assign">${assignment(p)}</p>
    ${p.user_added ? '<p class="badge">User-added profile</p>' : ''}
    ${avgLine(st)}
    <p><a class="btn" href="/priest/${p.id}">View profile</a></p>
  </article>`;
}
const DISCLAIMER = 'Reviews are individual users&rsquo; opinions, not statements of fact, and are not verified or endorsed by RateMyFather.';
const GLASS = `<div class="glass-strip" aria-hidden="true"><span></span><span></span><span></span><span></span><span></span><span></span><span></span></div>`;

function layout(title, body, extraHead = '') {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)} | RateMyFather</title>
  <link rel="stylesheet" href="/style.css">${extraHead}</head><body>
  <header class="topnav"><div class="wrap nav-inner">
    <a class="brand" href="/">RateMyFather</a>
    <nav><a href="/">Home</a><a href="/browse">Search &amp; Browse</a><a href="/about">About</a><a href="/how">How ratings work</a><a href="/terms">Terms</a><a href="/privacy">Privacy</a><a href="/moderation">Content &amp; Moderation Policy</a></nav>
  </div></header>
  <main class="wrap">${body}</main>
  <footer class="wrap"><p>${DISCLAIMER}</p>
  <p>No paid placement. No sponsored priests. Reviews are never sold or promoted for payment.</p>
  <p><a href="/owner/login">Owner moderation</a> &middot; <a href="/legal">Legal notices</a> &middot; <a href="/add-priest">Add a priest</a></p></footer>
  <div id="chat-widget"><button id="chat-toggle" type="button">Ask about a priest</button>
  <div id="chat-panel" hidden><div id="chat-log"></div>
  <form id="chat-form"><input id="chat-input" name="message" placeholder="e.g. Who is rated for a quick Mass?" required>
  <button type="submit">Ask</button></form>
  <p class="small">Answers use approved-review averages with review counts only. Individual reviews are never quoted.</p></div></div>
  <script src="/chat.js"></script></body></html>`;
}
function page(title, inner) { return layout(title, inner); }

// ---------- owner auth (server side) ----------
function signSession(payload) {
  const b = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', OWNER_SECRET).update(b).digest('hex');
  return b + '.' + sig;
}
function verifySession(cookieHeader) {
  if (!OWNER_SECRET || !cookieHeader) return false;
  const m = /(?:^|;\s*)rmf_owner=([^;]+)/.exec(cookieHeader);
  if (!m) return false;
  const [b, sig] = m[1].split('.');
  if (!b || !sig) return false;
  const expected = crypto.createHmac('sha256', OWNER_SECRET).update(b).digest('hex');
  let ok = false;
  try { ok = Buffer.from(sig).length === Buffer.from(expected).length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)); } catch { ok = false; }
  if (!ok) return false;
  try {
    const payload = JSON.parse(Buffer.from(b, 'base64url').toString('utf8'));
    return payload && payload.exp && payload.exp > Date.now();
  } catch { return false; }
}
function isOwner(req) { return verifySession(req.headers.cookie || ''); }
// Refuses non-owners BEFORE touching data. Used on every moderation route.
function requireOwner(req, res, next) {
  if (!OWNER_SECRET) return res.status(403).send(page('Forbidden', '<h1>Moderation unavailable</h1><p>Owner moderation is not configured on this deployment.</p>'));
  if (!isOwner(req)) return res.status(403).send(page('Forbidden', '<h1>Owner access required</h1><p>This area is owner-only. <a href="/owner/login">Sign in as owner</a>.</p>'));
  next();
}
async function audit(action, targetType, targetId, detail) {
  try { await pool.query('INSERT INTO moderation_audit (action, target_type, target_id, detail) VALUES ($1,$2,$3,$4)', [action, targetType, targetId, detail || null]); } catch (e) { console.error('audit failed', e.message); }
}

// ---------- public pages ----------
app.get('/', async (req, res) => {
  let regionCounts = {};
  try {
    const { rows } = await pool.query(`SELECT state, COUNT(*)::int AS n FROM priests WHERE status='approved' GROUP BY state`);
    for (const r of rows) {
      const region = regionOf(r.state);
      regionCounts[region] = (regionCounts[region] || 0) + r.n;
    }
  } catch (e) { console.error(e.message); }
  const regions = ['Northeast', 'Midwest', 'South', 'West', 'Other listings'];
  const regionHtml = regions.map((r) => `<li><a href="/browse?region=${encodeURIComponent(r)}">${r}</a> <span class="count">${regionCounts[r] || 0} profiles</span></li>`).join('');
  res.send(page('Home', `
    <section class="hero"><div class="hero-frame"><h1>RateMyFather</h1>
    <p>Anonymous ratings of pace, homily, and likability, from people in the pews.</p>
    <form class="search" action="/browse" method="get">
      <input name="q" placeholder="Search by name, parish, or city" aria-label="Search">
      <input name="zip" placeholder="ZIP (area-level)" aria-label="ZIP code" pattern="\\d{5}" title="5-digit ZIP">
      <button type="submit">Search</button>
    </form>
    <p class="small">ZIP search is area-level only: it finds the city and state area for a ZIP prefix, never an exact address.</p>
    </div></section>${GLASS}
    <h2>Browse by region</h2><ul class="regions">${regionHtml}</ul>
    <h2>Find priests by what matters to you</h2>
    <p><a class="btn" href="/browse?filter=quick">Quick Mass</a> <a class="btn" href="/browse?filter=homily">Great homily</a> <a class="btn" href="/browse?filter=lovable">Lovable priest</a></p>
    <p class="small">Category lists show rated priests only, sorted by that category average, highest first, with review counts always shown.</p>
    <p>${DISCLAIMER}</p>`));
});

const FILTERS = { quick: 'pace', homily: 'homily', lovable: 'likability' };
const FILTER_LABELS = { quick: 'Quick Mass (pace)', homily: 'Great homily', lovable: 'Lovable priest (likability)' };

app.get('/browse', async (req, res) => {
  const { q = '', state = '', region = '', zip = '', filter = '' } = req.query;
  const where = [`status='approved'`];
  const params = [];
  let note = '';
  if (state) { params.push(state.toUpperCase()); where.push(`state = $${params.length}`); }
  if (region) {
    const states = REGIONS[region];
    if (states) { params.push(states); where.push(`state = ANY($${params.length})`); }
    else if (region === 'Other listings') {
      const all = Object.values(REGIONS).flat();
      params.push(all); where.push(`NOT (state = ANY($${params.length}))`);
    }
  }
  if (q) { params.push(`%${q}%`); where.push(`(name ILIKE $${params.length} OR parish ILIKE $${params.length} OR city ILIKE $${params.length})`); }
  if (/^\d{5}$/.test(zip)) {
    const area = areaForZip(zip);
    if (area) {
      note = `<p class="notice">ZIP ${esc(zip)} resolves to the ${esc(area.city)}, ${esc(area.state)} area. Results below are area-level, not exact-ZIP matches (except user-added profiles carrying that exact ZIP).</p>`;
      params.push(area.city, area.state, zip);
      where.push(`((city ILIKE $${params.length - 2} AND state = $${params.length - 1}) OR (user_added = true AND zip = $${params.length}))`);
    } else {
      note = `<p class="notice">We could not map ZIP ${esc(zip)} to a known area, so no area results are shown. Try a name, parish, or city search instead.</p>`;
      where.push('false');
    }
  }
  let cards = [];
  if (FILTERS[filter]) {
    // Rank across ALL rated priests matching the search, not just the first
    // 200 alphabetical rows: join approved reviews and order by category
    // average, then review count. Bare column names in the where fragments
    // are qualified to the priests table for the join.
    const col = FILTERS[filter];
    const whereP = where.map((w) => w
      .replace(/\bstatus\b/g, 'p.status').replace(/\bstate\b/g, 'p.state')
      .replace(/\bname\b/g, 'p.name').replace(/\bparish\b/g, 'p.parish')
      .replace(/\bcity\b/g, 'p.city').replace(/\buser_added\b/g, 'p.user_added')
      .replace(/\bzip\b/g, 'p.zip'));
    const fsql = `SELECT p.*, COUNT(r.id)::int AS n, AVG(r.pace) AS pace, AVG(r.homily) AS homily, AVG(r.likability) AS likability FROM priests p JOIN reviews r ON r.priest_id = p.id AND r.status='approved' WHERE ${whereP.join(' AND ')} GROUP BY p.id ORDER BY AVG(r.${col}) DESC, COUNT(r.id) DESC LIMIT 200`;
    try {
      const frows = (await pool.query(fsql, params)).rows;
      cards = frows.map((p) => ({ p, st: { n: p.n, pace: p.pace, homily: p.homily, likability: p.likability } }));
    } catch (e) { console.error(e.message); }
  } else {
    let sql = `SELECT * FROM priests WHERE ${where.join(' AND ')} ORDER BY name LIMIT 200`;
    let rows = [];
    try { rows = (await pool.query(sql, params)).rows; } catch (e) { console.error(e.message); }
    const stats = await statsFor(rows.map((r) => r.id));
    cards = rows.map((p) => ({ p, st: stats[p.id] }));
  }
  const heading = filter ? FILTER_LABELS[filter] : 'Search & Browse';
  const body = cards.length
    ? cards.map((c) => priestCard(c.p, c.st)).join('')
    : `<p>No priests matched that search.</p><p><a class="btn" href="/add-priest">Add this priest</a></p><p class="small">If the priest is not listed, you can submit them for moderation review.</p>`;
  res.send(page(heading, `<h1>${esc(heading)}</h1>
    <form class="search" action="/browse" method="get">
      <input name="q" value="${esc(q)}" placeholder="Name, parish, or city">
      <input name="state" value="${esc(state)}" placeholder="State (e.g. PA)" maxlength="2">
      <input name="zip" value="${esc(zip)}" placeholder="ZIP (area-level)" pattern="\\d{5}">
      <select name="filter"><option value="">All priests</option>
        <option value="quick" ${filter === 'quick' ? 'selected' : ''}>Quick Mass</option>
        <option value="homily" ${filter === 'homily' ? 'selected' : ''}>Great homily</option>
        <option value="lovable" ${filter === 'lovable' ? 'selected' : ''}>Lovable priest</option></select>
      <button type="submit">Search</button></form>
    <p class="small">Nationwide search works within your chosen state when one is given. ZIP results are area-level only.</p>
    ${note}<div class="cards">${body}</div>`));
});

// ---------- profile + rating ----------
app.get('/priest/:id', async (req, res) => {
  const { rows } = await pool.query(`SELECT * FROM priests WHERE id=$1 AND status='approved'`, [req.params.id]);
  if (!rows.length) return res.status(404).send(page('Not found', '<h1>Priest not found</h1><p><a href="/add-priest">Add this priest</a></p>'));
  const p = rows[0];
  const stats = await statsFor([p.id]);
  const st = stats[p.id];
  const revs = (await pool.query(`SELECT id, pace, homily, likability, mass_context, body, created_at FROM reviews WHERE priest_id=$1 AND status='approved' ORDER BY created_at DESC LIMIT 50`, [p.id])).rows;
  const reviewHtml = revs.length ? revs.map((r) => `<article class="review">
    <p class="scores">Pace ${r.pace} &middot; Homily ${r.homily} &middot; Likability ${r.likability}${r.mass_context ? ` &middot; ${esc(r.mass_context)}` : ''}</p>
    ${r.body ? `<p>${esc(r.body)}</p>` : '<p class="small">Star-only review (no written comment).</p>'}
    <p><a href="/report?review=${r.id}&priest=${p.id}">Report this review</a></p></article>`).join('')
    : '<p>No published reviews for this priest yet.</p>';
  res.send(page(p.name, `<h1>${esc(p.name)}</h1>
    <p class="assign">${assignment(p)}</p>
    ${p.user_added ? '<p class="badge">User-added profile</p>' : `<p class="small discreet">Directory listing: this profile comes from the 2017 directory.</p>`}
    ${p.diocese_code ? `<p class="small">Diocese code: ${esc(p.diocese_code)}</p>` : ''}
    ${p.ordination_year ? `<p class="small">Ordination year (as listed): ${esc(p.ordination_year)}</p>` : ''}
    <p>${DISCLAIMER}</p>
    <h2>Ratings</h2>${avgLine(st)}${GLASS}
    <h2>Rate this priest</h2>
    <form action="/priest/${p.id}/review" method="post" class="rate-form">
      <p><label>Pace of play (speed only, not a quality grade): <select name="pace" required>
        <option value="">Choose</option><option value="1">1: very slow</option><option value="2">2: slow</option>
        <option value="3">3: moderate</option><option value="4">4: brisk</option><option value="5">5: brisk and quick</option></select></label></p>
      <p><label>Homily performance: <select name="homily" required>
        <option value="">Choose</option><option value="1">1: poor</option><option value="2">2: below average</option>
        <option value="3">3: average</option><option value="4">4: good</option><option value="5">5: excellent</option></select></label></p>
      <p><label>Likability: <select name="likability" required>
        <option value="">Choose</option><option value="1">1: not likable</option><option value="2">2: below average</option>
        <option value="3">3: average</option><option value="4">4: likable</option><option value="5">5: very likable</option></select></label></p>
      <p><label>Mass context (optional): <input name="mass_context" maxlength="120" placeholder="e.g. Sunday 10am Mass"></label></p>
      <p><label>Written review (optional):<br><textarea name="body" rows="4" maxlength="2000"></textarea></label></p>
      <p class="small">Reviews are anonymous. No name or email is collected.</p>
      <p><label><input type="checkbox" name="attest_age" required> I confirm I am 18 or older.</label></p>
      <p><label><input type="checkbox" name="attest_honest" required> I confirm this review is my own honest opinion.</label></p>
      <button type="submit">Submit review</button>
    </form>
    <h2>Published reviews</h2>${reviewHtml}
    <p><a class="btn" href="/priest/${p.id}/correct">Correction, right of reply, or removal request</a></p>`));
});

app.post('/priest/:id/review', async (req, res) => {
  const pid = Number(req.params.id);
  const { rows } = await pool.query(`SELECT id FROM priests WHERE id=$1 AND status='approved'`, [pid]);
  if (!rows.length) return res.status(404).send(page('Not found', '<h1>Priest not found</h1>'));
  const pace = Number(req.body.pace), homily = Number(req.body.homily), likability = Number(req.body.likability);
  const body = (req.body.body || '').trim().slice(0, 2000);
  const massContext = (req.body.mass_context || '').trim().slice(0, 120);
  if (![pace, homily, likability].every((v) => Number.isInteger(v) && v >= 1 && v <= 5)) {
    return res.status(400).send(page('Review not submitted', '<h1>Review not submitted</h1><p>Each rating must be a whole number from 1 to 5.</p>'));
  }
  if (!req.body.attest_age || !req.body.attest_honest) {
    return res.status(400).send(page('Review not submitted', '<h1>Review not submitted</h1><p>Both attestations are required: you must confirm you are 18 or older and that the review is your own honest opinion.</p>'));
  }
  const token = sourceTokenHash(req);
  const screen = screenBody(body);
  if (screen.outcome === 'refuse') {
    return res.status(400).send(page('Review refused', '<h1>Review refused</h1><p>Reviews containing private contact details such as phone numbers or email addresses are not accepted. Nothing was published and nothing is held.</p>'));
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
    `INSERT INTO reviews (priest_id, pace, homily, likability, mass_context, body, status, source_token_hash, abuse_flag, flag_reason)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [pid, pace, homily, likability, massContext || null, body || null, status, token, abuseFlag, flagReason]);
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
app.post('/add-priest', async (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).send(page('Not submitted', '<h1>Not submitted</h1><p>A name is required.</p>'));
  await pool.query(`INSERT INTO priests (name, parish, city, state, zip, source, user_added, status)
    VALUES ($1,$2,$3,$4,$5,'user_submitted',true,'pending')`,
    [name, req.body.parish || null, req.body.city || null, (req.body.state || '').toUpperCase() || null, /^\d{5}$/.test(req.body.zip || '') ? req.body.zip : null]);
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
app.post('/report', async (req, res) => {
  await pool.query(`INSERT INTO reports (review_id, priest_id, reason, details) VALUES ($1,$2,$3,$4)`,
    [req.body.review_id ? Number(req.body.review_id) : null, req.body.priest_id ? Number(req.body.priest_id) : null, req.body.reason || 'Other', req.body.details || null]);
  await audit('report_submitted', 'report', null, req.body.reason || '');
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
app.post('/correction', async (req, res) => {
  if (!req.body.details || !req.body.priest_id) return res.status(400).send(page('Not submitted', '<h1>Not submitted</h1><p>Details and a priest are required.</p>'));
  await pool.query(`INSERT INTO corrections (priest_id, type, details, contact) VALUES ($1,$2,$3,$4)`,
    [Number(req.body.priest_id), req.body.type || 'correction', req.body.details, req.body.contact || null]);
  await audit('correction_submitted', 'correction', null, req.body.type || '');
  res.send(page('Request received', '<h1>Request received</h1><p>Thank you. Your request has been flagged for the moderation queue.</p>'));
});

app.get('/legal', (req, res) => res.send(page('Legal notices', `<h1>Legal notices</h1>
  <p>Use this form to submit a legal notice. Notices go to the moderation queue. No personal email is published on this site.</p>
  <form action="/legal" method="post">
    <p><label>Notice (required):<br><textarea name="details" rows="6" maxlength="5000" required></textarea></label></p>
    <p><label>Contact (optional, never published): <input name="contact" maxlength="200"></label></p>
    <button type="submit">Submit notice</button></form>`)));
app.post('/legal', async (req, res) => {
  if (!req.body.details) return res.status(400).send(page('Not submitted', '<h1>Not submitted</h1><p>Notice text is required.</p>'));
  await pool.query(`INSERT INTO legal_notices (details, contact) VALUES ($1,$2)`, [req.body.details, req.body.contact || null]);
  await audit('legal_notice_submitted', 'legal_notice', null, '');
  res.send(page('Notice received', '<h1>Notice received</h1><p>Thank you. Your notice has been flagged for the moderation queue.</p>'));
});

// ---------- informational pages ----------
function infoPage(title, inner) { return page(title, `<h1>${esc(title)}</h1>${inner}`); }
app.get('/about', (req, res) => res.send(infoPage('About', `<p>RateMyFather is a RateMyProfessor-style site for anonymous ratings of Catholic priests on three things: pace of play (how fast Mass moves), homily performance, and likability.</p>
  <p>Directory profiles come from the 2017 directory. Each directory profile carries one small line noting that. Assignments are historical listings ("Listed at ..."), not a claim about where a priest serves today.</p>
  <p>${DISCLAIMER}</p><p>No paid placement. No sponsored priests.</p>`)));
app.get('/how', (req, res) => res.send(infoPage('How ratings work', `<p>Each rating is 1 to 5 in three categories:</p>
  <ul><li><strong>Pace of play measures speed only.</strong> 5 is brisk and quick, 1 is very slow. Pace is not a quality grade: a slow Mass is not a bad Mass.</li>
  <li><strong>Homily performance:</strong> 1 is poor, 5 is excellent.</li>
  <li><strong>Likability:</strong> 1 is not likable, 5 is very likable.</li></ul>
  <p>Every average score is shown with its review count, everywhere it appears. Averages use approved reviews only. A held review counts toward nothing.</p>
  <p>Screening: star-only and clearly clean reviews may auto-approve. Borderline reviews wait in the moderation queue. Possible unverified factual allegations (misconduct, crimes, improper behavior) are force-held with an abuse flag and never auto-approved. Reviews containing phone numbers or email addresses are refused outright. A repeat review of the same priest from the same source is refused. After 5 reviews in an hour from one source, further reviews are refused. If 10 or more reviews of one priest arrive in 24 hours, further reviews of that priest are force-held.</p>
  <p>Category lists ("Quick Mass", "Great homily", "Lovable priest") show rated priests only, sorted by that category average highest first, tie-broken by review count. Listings based on a single review carry a single-review caveat.</p>
  <p>Reviews are anonymous. No name or email is collected. For abuse prevention only, the site stores a hashed token derived from request data (see Privacy Policy).</p>`)));
app.get('/terms', (req, res) => res.send(infoPage('Terms of Use', `<p>By submitting a review, you confirm you are 18 or older and that the review is your own honest opinion. Reviews are individual users' opinions, not statements of fact.</p>
  <p>You must not submit private contact details, unverified factual allegations about identifiable people, or content you do not have the right to post. The owner may approve, hold, reject, or remove content under the Content and Moderation Policy.</p>
  <p>No paid placement: no priest, parish, or diocese can pay for placement, ranking, or promotion on this site.</p>
  <p>This site does not claim that the site or its owner is immune from suit.</p>`)));
app.get('/privacy', (req, res) => res.send(infoPage('Privacy Policy', `<p>What is collected:</p>
  <ul><li><strong>Reviews:</strong> the three 1-5 ratings, optional Mass context, and optional written review text you submit. No name or email is collected with reviews.</li>
  <li><strong>Abuse-prevention token:</strong> a SHA-256 hash derived from request data (IP address plus user agent). Only the hash is stored, never the raw IP address or user agent string. It is used only to refuse duplicates, enforce the hourly review limit, and detect review spikes.</li>
  <li><strong>Moderation submissions:</strong> reports, corrections, right-of-reply and removal requests, and legal notices, including any optional contact details you choose to provide. Contact details are never published.</li>
  <li><strong>Owner session:</strong> a signed, httpOnly session cookie is set only when the owner signs in. It contains an expiry time and a signature, nothing else.</li></ul>
  <p>Nothing else is collected for tracking or advertising. There is no advertising on this site.</p>`)));
app.get('/moderation', (req, res) => res.send(infoPage('Content & Moderation Policy', `<p>All moderation is owner-only and enforced on the server. Public buttons (report, correction, legal notice) only flag the queue; they never approve, reject, or delete anything.</p>
  <p>Star-only and clearly clean reviews may auto-approve. Borderline reviews wait for a human owner decision. Possible unverified factual allegations are force-held with an abuse flag and never auto-approved. Reviews with private contact details are refused. Repeat reviews of the same priest from the same source are refused. Hourly bursts (over 5 per source) are refused. 24-hour spikes (10 or more per priest) are force-held.</p>
  <p>The owner can approve or reject pending reviews and user-added profiles, delete reviews and user-added profiles, and resolve reports, corrections, and legal notices. Directory profiles are never deleted.</p>
  <p>Review of reviews and deletion are owner-only functions, enforced server side, not merely hidden in the interface.</p>`)));

// ---------- chatbot: site data only, aggregated approved scores with counts ----------
app.post('/api/chat', async (req, res) => {
  const msg = String(req.body.message || '').trim();
  const lower = msg.toLowerCase();
  const filterMap = [['quick', 'quick'], ['quick mass', 'quick'], ['great homily', 'homily'], ['homily', 'homily'], ['lovable', 'lovable'], ['likable', 'lovable'], ['likeable', 'lovable']];
  let filter = null;
  for (const [phrase, f] of filterMap) if (lower.includes(phrase)) { filter = f; break; }
  const col = filter ? FILTERS[filter] : null;
  let priests = [];
  if (filter) {
    // Rank across ALL rated priests, not just the first 200 alphabetical rows.
    const { rows } = await pool.query(
      `SELECT p.*, COUNT(r.id)::int AS n, AVG(r.pace) AS pace, AVG(r.homily) AS homily, AVG(r.likability) AS likability FROM priests p JOIN reviews r ON r.priest_id = p.id AND r.status='approved' WHERE p.status='approved' GROUP BY p.id ORDER BY AVG(r.${col}) DESC, COUNT(r.id) DESC LIMIT 5`);
    priests = rows.map((p) => ({ p, st: { n: p.n, pace: p.pace, homily: p.homily, likability: p.likability } }));
  } else {
    const words = lower.replace(/[^a-z\s'-]/g, ' ').split(/\s+/).filter((w) => w.length >= 3);
    const stop = new Set(['who', 'what', 'where', 'about', 'priest', 'father', 'rated', 'rating', 'ratings', 'tell', 'show', 'find', 'search', 'for', 'the', 'and', 'any']);
    const terms = [...new Set(words.filter((w) => !stop.has(w)))];
    if (terms.length) {
      const like = terms.map((t) => `%${t}%`);
      const cond = terms.map((_, i) => `name ILIKE $${i + 1}`).join(' OR ');
      const { rows } = await pool.query(`SELECT * FROM priests WHERE status='approved' AND (${cond}) ORDER BY name LIMIT 10`, like);
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
app.post('/owner/login', (req, res) => {
  if (!OWNER_SECRET) return res.status(403).send(page('Forbidden', '<h1>Owner moderation is not configured.</h1>'));
  const supplied = String(req.body.secret || '');
  // Timing-safe comparison against the env secret (hash both first so lengths match).
  const a = crypto.createHash('sha256').update(supplied).digest();
  const b = crypto.createHash('sha256').update(OWNER_SECRET).digest();
  if (!crypto.timingSafeEqual(a, b)) return res.status(403).send(page('Sign-in failed', '<h1>Sign-in failed</h1><p>The secret did not match.</p>'));
  const cookie = signSession({ exp: Date.now() + 12 * 60 * 60 * 1000 });
  res.setHeader('Set-Cookie', `rmf_owner=${cookie}; HttpOnly; SameSite=Lax; Path=/; Max-Age=43200`);
  res.redirect('/owner');
});
app.post('/owner/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'rmf_owner=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
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
  const reviewRows = pendingReviews.map((r) => `<li>${esc(r.priest_name)}: Pace ${r.pace}, Homily ${r.homily}, Likability ${r.likability}${r.abuse_flag ? ' <strong>[abuse flag]</strong>' : ''}${r.flag_reason ? ` [${esc(r.flag_reason)}]` : ''}${r.body ? `: ${esc(r.body)}` : ' (star-only)'}
    ${act('review-approve', r.id)}Approve</button></form> ${act('review-reject', r.id)}Reject</button></form> ${act('review-delete', r.id)}Delete</button></form></li>`).join('') || '<li>None</li>';
  const priestRows = pendingPriests.map((p) => `<li>${esc(p.name)} (${assignment(p)})
    ${act('priest-approve', p.id)}Approve</button></form> ${act('priest-reject', p.id)}Reject</button></form></li>`).join('') || '<li>None</li>';
  const reportRows = pendingReports.map((r) => `<li>Review ${r.review_id || 'n/a'}: ${esc(r.reason)}${r.details ? `: ${esc(r.details)}` : ''} ${act('report-resolve', r.id)}Resolve</button></form></li>`).join('') || '<li>None</li>';
  const corrRows = pendingCorrections.map((r) => `<li>Priest ${r.priest_id}: ${esc(r.type)}: ${esc(r.details)} ${act('correction-resolve', r.id)}Resolve</button></form></li>`).join('') || '<li>None</li>';
  const legalRows = pendingLegal.map((r) => `<li>${esc(r.details.slice(0, 200))} ${act('legal-resolve', r.id)}Resolve</button></form></li>`).join('') || '<li>None</li>';
  res.send(page('Owner moderation', `<h1>Owner moderation queue</h1>
    <p><a href="/owner/audit">View auto-approved audit list</a></p>
    <form action="/owner/logout" method="post"><button type="submit">Sign out</button></form>
    <h2>Pending reviews</h2><ul>${reviewRows}</ul>
    <h2>Pending user-added priests</h2><ul>${priestRows}</ul>
    <h2>Pending reports</h2><ul>${reportRows}</ul>
    <h2>Corrections, replies, removals</h2><ul>${corrRows}</ul>
    <h2>Legal notices</h2><ul>${legalRows}</ul>
    <p class="small">Directory profiles are never deleted. Delete controls appear only here, for the owner.</p>`));
});
app.get('/owner/audit', requireOwner, async (req, res) => {
  const rows = (await pool.query(`SELECT * FROM moderation_audit ORDER BY created_at DESC LIMIT 200`)).rows;
  const list = rows.map((r) => `<li>${esc(r.created_at.toISOString())} ${esc(r.action)} ${esc(r.target_type)} ${r.target_id || ''} ${esc(r.detail || '')}</li>`).join('') || '<li>No audit entries yet.</li>';
  res.send(page('Moderation audit', `<h1>Moderation audit</h1><p>Includes auto-approved reviews.</p><ul>${list}</ul><p><a href="/owner">Back to queue</a></p>`));
});

// Every mutation below passes requireOwner BEFORE touching data.
app.post('/owner/review-approve/:id', requireOwner, async (req, res) => {
  await pool.query(`UPDATE reviews SET status='approved' WHERE id=$1`, [req.params.id]);
  await audit('review_approved', 'review', Number(req.params.id), 'owner');
  res.redirect('/owner');
});
app.post('/owner/review-reject/:id', requireOwner, async (req, res) => {
  await pool.query(`UPDATE reviews SET status='rejected' WHERE id=$1`, [req.params.id]);
  await audit('review_rejected', 'review', Number(req.params.id), 'owner');
  res.redirect('/owner');
});
app.post('/owner/review-delete/:id', requireOwner, async (req, res) => {
  await pool.query(`DELETE FROM reviews WHERE id=$1`, [req.params.id]);
  await audit('review_deleted', 'review', Number(req.params.id), 'owner');
  res.redirect('/owner');
});
app.post('/owner/priest-approve/:id', requireOwner, async (req, res) => {
  await pool.query(`UPDATE priests SET status='approved' WHERE id=$1`, [req.params.id]);
  await audit('priest_approved', 'priest', Number(req.params.id), 'owner');
  res.redirect('/owner');
});
app.post('/owner/priest-reject/:id', requireOwner, async (req, res) => {
  await pool.query(`UPDATE priests SET status='rejected' WHERE id=$1`, [req.params.id]);
  await audit('priest_rejected', 'priest', Number(req.params.id), 'owner');
  res.redirect('/owner');
});
app.post('/owner/priest-delete/:id', requireOwner, async (req, res) => {
  const { rows } = await pool.query(`SELECT user_added, source FROM priests WHERE id=$1`, [req.params.id]);
  if (!rows.length) return res.status(404).send(page('Not found', '<h1>Priest not found</h1>'));
  // Directory profiles are NEVER deletable, regardless of owner status.
  if (!rows[0].user_added) return res.status(403).send(page('Refused', '<h1>Refused</h1><p>Directory profiles cannot be deleted. Only user-added profiles can be removed.</p>'));
  await pool.query(`DELETE FROM priests WHERE id=$1`, [req.params.id]);
  await audit('priest_deleted', 'priest', Number(req.params.id), 'user-added only');
  res.redirect('/owner');
});
app.post('/owner/report-resolve/:id', requireOwner, async (req, res) => {
  await pool.query(`UPDATE reports SET status='resolved' WHERE id=$1`, [req.params.id]);
  await audit('report_resolved', 'report', Number(req.params.id), 'owner');
  res.redirect('/owner');
});
app.post('/owner/correction-resolve/:id', requireOwner, async (req, res) => {
  await pool.query(`UPDATE corrections SET status='resolved' WHERE id=$1`, [req.params.id]);
  await audit('correction_resolved', 'correction', Number(req.params.id), 'owner');
  res.redirect('/owner');
});
app.post('/owner/legal-resolve/:id', requireOwner, async (req, res) => {
  await pool.query(`UPDATE legal_notices SET status='resolved' WHERE id=$1`, [req.params.id]);
  await audit('legal_resolved', 'legal_notice', Number(req.params.id), 'owner');
  res.redirect('/owner');
});

// ---------- boot ----------
async function boot() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set. Set it to a Postgres connection string and restart.');
    process.exit(1);
  }
  if (!OWNER_SECRET) console.warn('WARNING: OWNER_SECRET is not set. Owner moderation will refuse all access until it is set.');
  const mig = path.join(__dirname, 'migrations', '001_init.sql');
  if (fs.existsSync(mig)) await pool.query(fs.readFileSync(mig, 'utf8'));
  app.listen(PORT, () => console.log(`RateMyFather listening on port ${PORT}`));
}
boot().catch((e) => { console.error(e); process.exit(1); });
