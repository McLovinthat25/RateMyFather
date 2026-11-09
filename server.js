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

// Numeric :id params only. Express 4 does not catch async route rejections,
// so a non-numeric id (e.g. /priest/abc) used in a Postgres integer query
// would throw as an unhandled promise rejection and hang or crash the
// process. Reject it here with a 404 instead. The bound also keeps absurdly
// large ids from reaching Postgres as an out-of-range integer.
app.param('id', (req, res, next, id) => {
  const n = Number(id);
  if (!/^\d+$/.test(id) || !Number.isSafeInteger(n) || n > 2147483647) {
    return res.status(404).send(notFoundPage());
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
  if (p.parish) parts.push('Listed at ' + esc(p.parish));
  const loc = [p.city, p.state].filter(Boolean).join(', ');
  if (loc) parts.push(esc(loc));
  return parts.join(' &middot; ') || 'Listing details not available';
}
// Plain-text version of assignment(), for title attributes (no HTML entities).
function assignmentText(p) {
  const parts = [];
  if (p.parish) parts.push('Listed at ' + p.parish);
  const loc = [p.city, p.state].filter(Boolean).join(', ');
  if (loc) parts.push(loc);
  return parts.join(' - ') || 'Listing details not available';
}
function priestCard(p, st) {
  const avg = overallAvg(st);
  const scoreBox = avg == null
    ? `<span class="score-box unrated">Not yet rated</span>`
    : `<span class="score-box"><span class="num">${avg.toFixed(1)}</span><span class="lbl">out of 5</span></span>`;
  return `<a class="card card-lift priest-card" href="/priest/${p.id}" title="${esc(p.name)} — ${esc(assignmentText(p))}">
    ${scoreBox}
    <span class="priest-main">
      <span class="priest-name" title="${esc(p.name)}">${esc(p.name)}</span>
      <span class="assign" title="${esc(assignmentText(p))}">${assignment(p)}</span>
      ${avg == null ? '' : starsHtml(avg)}
      ${p.user_added ? '<span class="badge">User-added profile</span>' : ''}
      ${avg == null ? '' : avgLine(st)}
    </span>
    <span class="chevron" aria-hidden="true">&rsaquo;</span>
  </a>`;
}
const DISCLAIMER = 'Reviews are individual users&rsquo; opinions, not statements of fact, and are not verified or endorsed by RateMyFather.';
// Leaded-glass divider strip: five panes, weights 3,1,3,1,3, alternating ruby/amber.
function glassStrip(cls = '') {
  return `<div class="glass-strip ${cls}" aria-hidden="true"><span class="w3"></span><span></span><span class="w3"></span><span></span><span class="w3"></span></div>`;
}
const GLASS = glassStrip();

function layout(title, body, extraHead = '') {
  const description = 'Anonymous ratings of Catholic priests on pace, homily, and likability, from the pews. Searchable by name, parish, city, state, or diocese.';
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="${description}">
  <meta property="og:title" content="${esc(title)} | RateMyFather">
  <meta property="og:description" content="${description}">
  <meta property="og:type" content="website">
  <meta name="theme-color" content="#7a1f2b">
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <title>${esc(title)} | RateMyFather</title>
  <link rel="stylesheet" href="/style.css">${extraHead}</head><body>
  <header class="topnav"><div class="wrap nav-inner">
    <a class="brand" href="/">Rate<span class="accent">My</span>Father</a>
    <nav><a href="/">Home</a><a href="/browse">Search &amp; Browse</a><a href="/games">Games</a><a href="/about">About</a><a href="/how">How ratings work</a></nav>
  </div><div class="wrap">${glassStrip('thin')}</div></header>
  <main class="wrap">${body}</main>
  <footer class="wrap site-footer">${glassStrip('gs-7')}
  <nav class="footer-nav"><a href="/terms">Terms</a><a href="/privacy">Privacy</a><a href="/moderation">Content &amp; Moderation Policy</a><a href="/legal">Legal notices</a><a href="/owner/login">Owner moderation</a><a href="/add-priest">Add a priest</a></nav>
  <p>${DISCLAIMER}</p>
  <p>No paid placement. No sponsored priests. Reviews are never sold or promoted for payment.</p></footer>
  <div id="chat-widget"><button id="chat-toggle" type="button" aria-expanded="false" aria-controls="chat-panel">Ask about a priest</button>
  <div id="chat-panel" hidden role="region" aria-label="Chat about a priest"><div id="chat-log"></div>
  <form id="chat-form"><input id="chat-input" name="message" placeholder="e.g. Who is rated for a quick Mass?" required>
  <button type="submit">Ask</button></form>
  <p class="small">Answers use approved-review averages with review counts only. Individual reviews are never quoted.</p></div></div>
  <script src="/chat.js"></script><script src="/places.js"></script></body></html>`;
}
function page(title, inner, extraHead = '') { return layout(title, inner, extraHead); }
// A 404 that helps the visitor recover: search box, browse, games, add.
// Used for bad ids and for priest profiles that do not exist.
function notFoundPage() {
  return page('Not found', `<h1>We could not find that page</h1>
  <p>The link may be mistyped, or the priest may not be listed. Try searching by name, parish, or city:</p>
  <form action="/browse" method="get"><div class="search">
    <span class="search-field"><input name="q" placeholder="Search by name, parish, or city" aria-label="Search"></span>
    <button type="submit">Search</button>
  </div></form>
  <p><a class="btn" href="/browse">Browse all priests</a> <a class="btn btn-secondary" href="/games">Play the arcade</a></p>
  <p class="small">If the priest is not listed, you can <a href="/add-priest">submit them for moderation review</a>.</p>`);
}

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

// Stained-glass window art, shared by the home hero and the profile banner.
const HERO_ART = `<svg viewBox="0 0 800 420" role="img" aria-label="Stained-glass church window" preserveAspectRatio="xMidYMid slice">
    <defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#e8c96a"/><stop offset="0.55" stop-color="#f6e7b8"/><stop offset="1" stop-color="#fbf7ef"/>
    </linearGradient>
    <clipPath id="archClip"><path d="M170 420 L170 190 A230 170 0 0 1 630 190 L630 420 Z"/></clipPath></defs>
    <rect width="800" height="420" fill="url(#sky)"/>
    <circle cx="648" cy="76" r="42" fill="#c49a3c" opacity="0.85"/>
    <g clip-path="url(#archClip)">
      <rect x="150" y="40" width="500" height="380" fill="#7a1f2b"/>
      <rect x="150" y="40" width="125" height="140" fill="#c49a3c"/>
      <rect x="275" y="40" width="125" height="140" fill="#8a2a35"/>
      <rect x="400" y="40" width="125" height="140" fill="#2e5e4e"/>
      <rect x="525" y="40" width="125" height="140" fill="#7a1f2b"/>
      <rect x="150" y="180" width="125" height="120" fill="#c49a3c"/>
      <rect x="275" y="180" width="125" height="120" fill="#3a6ea5"/>
      <rect x="400" y="180" width="125" height="120" fill="#7a1f2b"/>
      <rect x="525" y="180" width="125" height="120" fill="#c49a3c"/>
      <rect x="150" y="300" width="125" height="120" fill="#5b2a4a"/>
      <rect x="275" y="300" width="125" height="120" fill="#c49a3c"/>
      <rect x="400" y="300" width="125" height="120" fill="#8a2a35"/>
      <rect x="525" y="300" width="125" height="120" fill="#2e5e4e"/>
      <g stroke="#38291a" stroke-width="6">
        <line x1="275" y1="40" x2="275" y2="420"/><line x1="400" y1="40" x2="400" y2="420"/><line x1="525" y1="40" x2="525" y2="420"/>
        <line x1="150" y1="180" x2="650" y2="180"/><line x1="150" y1="300" x2="650" y2="300"/>
      </g>
      <circle cx="400" cy="150" r="52" fill="#c49a3c" stroke="#38291a" stroke-width="6"/>
      <circle cx="400" cy="150" r="30" fill="#7a1f2b" stroke="#38291a" stroke-width="5"/>
      <circle cx="400" cy="150" r="10" fill="#c49a3c"/>
      <g stroke="#38291a" stroke-width="4">
        <line x1="400" y1="98" x2="400" y2="202"/><line x1="348" y1="150" x2="452" y2="150"/>
      </g>
      <g fill="#c49a3c" stroke="#38291a" stroke-width="5">
        <rect x="388" y="330" width="24" height="90"/>
        <rect x="356" y="356" width="88" height="20"/>
      </g>
    </g>
    <path d="M170 420 L170 190 A230 170 0 0 1 630 190 L630 420 Z" fill="none" stroke="#38291a" stroke-width="6"/>
    <rect x="140" y="404" width="520" height="16" fill="#38291a"/>
  </svg>`;

// ---------- public pages ----------
app.get('/', async (req, res) => {
  const regions = ['Northeast', 'Midwest', 'South', 'West', 'Other listings'];
  const regionHtml = regions.map((r) => `<li><a href="/browse?region=${encodeURIComponent(r)}">${r}</a></li>`).join('');
  const searchIcon = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><line x1="16.5" y1="16.5" x2="21" y2="21"/></svg>`;
  res.send(page('Home', `
    <section class="hero">
      <div class="sg-frame" aria-hidden="true">${HERO_ART}</div>
      <h1>Find your Father.<br><span class="accent">Rate your Mass.</span></h1>
      <p class="tagline">Anonymous ratings of pace, homily, and likability, from the pews.</p>
    </section>${GLASS}
    <form action="/browse" method="get" id="home-search">
      <div class="search">
        <span class="search-field">${searchIcon}<input name="q" placeholder="Search by name, parish, or city" aria-label="Search"></span>
        <input name="zip" placeholder="ZIP (area-level)" aria-label="ZIP code" pattern="\\d{5}" title="5-digit ZIP" inputmode="numeric" maxlength="5">
        <button type="submit">Search</button>
      </div>
      <div class="place-section">
        <h2>Find by place</h2>
        <p class="explainer">Pick a state, then a city, then a diocese.</p>
        <div class="place-filters" data-state="" data-city="" data-diocese="">
          <select id="place-state" name="state" aria-label="State"><option value="">Choose a state</option></select>
          <select id="place-city" name="city" disabled aria-label="City"><option value="">Choose a city</option></select>
          <select id="place-diocese" name="diocese" disabled aria-label="Diocese"><option value="">Choose a diocese</option></select>
        </div>
      </div>
    </form>
    <p class="small">ZIP search is area-level only: it finds the city and state area for a ZIP prefix, never an exact address.</p>
    <section class="home-section">
    <h2>Browse by region</h2><ul class="regions">${regionHtml}</ul>
    </section>
    <section class="home-section">
    <h2>Find priests by what matters to you</h2>
    <p class="explainer">Category lists show rated priests only, sorted by that category average, highest first, with review counts always shown.</p>
    <p class="chip-row"><a class="chip press" href="/browse?filter=quick">Quick Mass</a> <a class="chip press" href="/browse?filter=homily">Great homily</a> <a class="chip press" href="/browse?filter=lovable">Lovable priest</a></p>
    </section>
    <section class="home-section">
    <h2>Add a priest</h2>
    <p>Know a priest who is not listed? Submit them for moderation review. Approved user-added priests are marked as user-added.</p>
    <form action="/add-priest" method="post" class="rate-form">
      <p><label>Name (required): <input name="name" required maxlength="200"></label></p>
      <p><label>Parish: <input name="parish" maxlength="200"></label></p>
      <p><label>City: <input name="city" maxlength="100"></label></p>
      <p><label>State: <input name="state" maxlength="2"></label></p>
      <button type="submit">Submit for moderation</button></form>
    </section>
    <section class="breather card-lift">
      <h2>Need a breather?</h2>
      <p class="explainer">Take a break between Masses with nine little games in the arcade. Best scores live only in your browser.</p>
      <p><a class="btn btn-pill press" href="/games">Play the arcade</a></p>
    </section>`));
});

// Diocese codes (2017 directory) to full names, for the Find by place filters.
// Codes not listed here are religious-order or eparchy codes that do not map
// to a single geographic diocese; the UI shows the code itself for those.
const DIOCESE_NAMES = {
  AGN: 'Agaña', ALB: 'Albany', ALN: 'Allentown', ALT: 'Altoona-Johnstown', ALX: 'Alexandria',
  AMA: 'Amarillo', ANC: 'Anchorage', ARE: 'Arecibo', ARL: 'Arlington', ATL: 'Atlanta',
  AUS: 'Austin', B: 'Boise', BAK: 'Baker', BAL: 'Baltimore', BEA: 'Beaumont', BEL: 'Belleville',
  BGP: 'Bridgeport', BIR: 'Birmingham', BIS: 'Bismarck', BLX: 'Biloxi', BR: 'Baton Rouge',
  BRK: 'Brooklyn', BUF: 'Buffalo', BUR: 'Burlington', BWN: 'Brownsville', CAM: 'Camden',
  CC: 'Corpus Christi', CGS: 'Caguas', CHI: 'Chicago', CHK: 'Chalan Kanoa', CHL: 'Charlotte',
  CHR: 'Charleston', CHY: 'Cheyenne', CIN: 'Cincinnati', CLV: 'Cleveland', COL: 'Columbus',
  COS: 'Colorado Springs', COV: 'Covington', CR: 'Crookston', DAL: 'Dallas', DAV: 'Davenport',
  DEN: 'Denver', DET: 'Detroit', DM: 'Des Moines', DOD: 'Dodge City', DUB: 'Dubuque',
  DUL: 'Duluth', ELP: 'El Paso', EVN: 'Evansville', FAJ: 'Fajardo-Humacao', FAR: 'Fargo',
  FBK: 'Fairbanks', FR: 'Fall River', FRS: 'Fresno', FTW: 'Fort Wayne-South Bend',
  FWT: 'Fort Worth', GAL: 'Galveston-Houston', GB: 'Green Bay', GBG: 'Greensburg',
  GF: 'Great Falls', GI: 'Grand Island', GLP: 'Gallup', GR: 'Grand Rapids', GRY: 'Gary',
  HBG: 'Harrisburg', HEL: 'Helena', HON: 'Honolulu', HRT: 'Hartford', HT: 'Houma-Thibodaux',
  IND: 'Indianapolis', JC: 'Jefferson City', JKS: 'Jackson', JOL: 'Joliet', JUN: 'Juneau',
  KAL: 'Kalamazoo', KC: 'Kansas City', KCK: 'Kansas City in Kansas', KNX: 'Knoxville',
  LA: 'Los Angeles', LAF: 'Lafayette', LAN: 'Lansing', LAR: 'Laredo', LC: 'La Crosse',
  LEX: 'Lexington', LFT: 'Lafayette in Indiana', LIN: 'Lincoln', LKC: 'Lake Charles',
  LR: 'Little Rock', LSC: 'Las Cruces', LUB: 'Lubbock', MAD: 'Madison', MAN: 'Manchester',
  MAR: 'Marquette', MEM: 'Memphis', MET: 'Metuchen', MIA: 'Miami', MIL: 'Milwaukee',
  MOB: 'Mobile', MRY: 'Monterey', NEW: 'Newark', NO: 'New Orleans', NOR: 'Norwich',
  NSH: 'Nashville', NU: 'New Ulm', NY: 'New York', OAK: 'Oakland', OG: 'Ogdensburg',
  OKL: 'Oklahoma City', OM: 'Omaha', ORG: 'Orange', ORL: 'Orlando', OWN: 'Owensboro',
  PAT: 'Paterson', PBL: 'Pueblo', PEO: 'Peoria', PH: 'Philadelphia', PHX: 'Phoenix',
  PIT: 'Pittsburgh', PMB: 'Palm Beach', PCE: 'Ponce', PRO: 'Providence', PRT: 'Portland',
  PSC: 'Pensacola', RC: 'Rapid City', RCK: 'Rockford', RIC: 'Richmond', RNO: 'Reno',
  ROC: 'Rochester', RVC: 'Rockville Centre', SAC: 'Sacramento', SAG: 'Saginaw', SAL: 'Salina',
  SAN: 'San Angelo', SAT: 'San Antonio', SAV: 'Savannah', SB: 'San Bernardino',
  SC: 'Sioux City', SCL: 'Saint Cloud', SCR: 'Scranton', SEA: 'Seattle', SFD: 'Springfield in Illinois',
  SFE: 'Santa Fe', SFR: 'San Francisco', SFS: 'Sioux Falls', SHP: 'Shreveport', SJ: 'San Jose',
  SJN: 'San Juan', SLC: 'Salt Lake City', SP: 'Saint Petersburg', SPC: 'Springfield-Cape Girardeau',
  SPK: 'Spokane', SPP: 'Samoa-Pago Pago', SPR: 'Springfield in Massachusetts', SR: 'Santa Rosa',
  STA: 'Saint Augustine', STL: 'St. Louis', STN: 'Steubenville', STO: 'Stockton',
  STP: 'Saint Paul', SUP: 'Superior', SY: 'Syracuse', TLS: 'Tulsa', TOL: 'Toledo',
  TR: 'Trenton', TUC: 'Tucson', TYL: 'Tyler', VEN: 'Venice', VIC: 'Victoria', WCH: 'Wichita',
  WDC: 'Washington', WH: 'Wheeling-Charleston', WIL: 'Wilmington', WIN: 'Winona-Rochester',
  WOR: 'Worcester', Y: 'Youngstown', YAK: 'Yakima',
};
function dioceseName(code) { return DIOCESE_NAMES[code] || code; }

// Find by place: state, then city, then diocese. Data comes from the directory.
app.get('/api/places/states', async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT state, COUNT(*)::int AS n FROM priests WHERE status='approved' AND state IS NOT NULL AND state <> '' GROUP BY state ORDER BY state`);
    res.json(rows.map((r) => ({ state: r.state, n: r.n })));
  } catch (e) { res.json([]); }
});
app.get('/api/places/cities', async (req, res) => {
  const state = String(req.query.state || '').toUpperCase();
  if (!state) return res.json([]);
  try {
    const { rows } = await pool.query(`SELECT city, COUNT(*)::int AS n FROM priests WHERE status='approved' AND state=$1 AND city IS NOT NULL AND city <> '' GROUP BY city ORDER BY n DESC, city LIMIT 200`, [state]);
    res.json(rows);
  } catch (e) { res.json([]); }
});
app.get('/api/places/dioceses', async (req, res) => {
  const state = String(req.query.state || '').toUpperCase();
  if (!state) return res.json([]);
  try {
    const { rows } = await pool.query(`SELECT diocese_code, COUNT(*)::int AS n FROM priests WHERE status='approved' AND state=$1 AND diocese_code IS NOT NULL AND diocese_code <> '' GROUP BY diocese_code ORDER BY n DESC, diocese_code LIMIT 200`, [state]);
    res.json(rows.map((r) => ({ code: r.diocese_code, name: dioceseName(r.diocese_code), n: r.n })));
  } catch (e) { res.json([]); }
});

// Arcade page shell; the games themselves live in /arcade.js.
app.get('/games', (req, res) => res.send(page('Games', `
  <h1>The Arcade</h1>
  <p>Take a breather between Masses. Nine little games, all free, all right here. Best scores live only in your browser.</p>
  <div id="arcade-root"><p class="small">Loading games&hellip;</p></div>
  <noscript><p class="notice">The arcade needs JavaScript enabled to play. Turn JavaScript on and reload the page.</p></noscript>
  <script src="/arcade.js"></script>
  <script>(function () {
    // If the games shelf never renders (script blocked or failed), say so
    // and offer a retry instead of leaving "Loading games…" up forever.
    setTimeout(function () {
      var root = document.getElementById('arcade-root');
      if (!root || root.querySelector('.arcade-shelf, .game-stage')) return;
      root.innerHTML = '<p class="notice">The games did not load. Check your connection and try again.</p><p><button type="button" onclick="location.reload()">Try again</button></p>';
    }, 6000);
  })();</script>`)));

const FILTERS = { quick: 'pace', homily: 'homily', lovable: 'likability' };
// Multi-word search helpers. A query like "Erie Saint George" is split into
// words; each word is matched against name, parish, or city, and rows are
// ranked by how many words they match, so a row matching all words outranks
// a row matching only one. "Saint" and "St." are the same word: the field is
// normalised so a whole-word St. or St becomes Saint, and the search word is
// normalised the same way, so "Saint George" finds "St. George" and vice versa.
function searchNormField(col) {
  return `regexp_replace(${col}, '\\ySt\\.?\\y', 'Saint', 'gi')`;
}
function searchNormWord(w) {
  const t = w.replace(/\./g, '').toLowerCase();
  return t === 'st' ? 'saint' : t;
}
function searchLikeEscape(s) {
  return s.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}
// Qualify bare priest column names for the FILTERS join (p.name, p.parish...).
function qualifyPriestFragment(w) {
  return w
    .replace(/\bstatus\b/g, 'p.status').replace(/\bstate\b/g, 'p.state')
    .replace(/\bname\b/g, 'p.name').replace(/\bparish\b/g, 'p.parish')
    .replace(/\bcity\b/g, 'p.city').replace(/\bdiocese_code\b/g, 'p.diocese_code')
    .replace(/\buser_added\b/g, 'p.user_added')
    .replace(/\bzip\b/g, 'p.zip');
}
const FILTER_LABELS = { quick: 'Quick Mass (pace)', homily: 'Great homily', lovable: 'Lovable priest (likability)' };

app.get('/browse', async (req, res) => {
  const { q = '', state = '', city = '', diocese = '', region = '', zip = '', filter = '' } = req.query;
  const where = [`status='approved'`];
  const params = [];
  let note = '';
  if (state) { params.push(state.toUpperCase()); where.push(`state = $${params.length}`); }
  if (city) { params.push(city); where.push(`city ILIKE $${params.length}`); }
  if (diocese) { params.push(diocese.toUpperCase()); where.push(`diocese_code = $${params.length}`); }
  if (region) {
    const states = REGIONS[region];
    if (states) { params.push(states); where.push(`state = ANY($${params.length})`); }
    else if (region === 'Other listings') {
      const all = Object.values(REGIONS).flat();
      params.push(all); where.push(`NOT (state = ANY($${params.length}))`);
    }
  }
  // Multi-word search: each word is matched against name, parish, or city.
  // A row matching any word is returned; rows matching more words rank first
  // (see the relevance score below). "Erie Saint George" therefore finds the
  // St. George priests in Erie, even though "Erie" is the city and
  // "St. George" is the parish, in different fields.
  const words = q.trim().split(/\s+/).filter(Boolean).slice(0, 10).map(searchNormWord);
  let relevance = null;
  if (words.length) {
    const matchParts = [];
    const relParts = [];
    for (const w of words) {
      params.push(`%${searchLikeEscape(w)}%`);
      const ph = `$${params.length}`;
      const m = `(${searchNormField('name')} ILIKE ${ph} OR ${searchNormField('parish')} ILIKE ${ph} OR ${searchNormField('city')} ILIKE ${ph})`;
      matchParts.push(m);
      relParts.push(`(CASE WHEN ${m} THEN 1 ELSE 0 END)`);
    }
    where.push(`(${matchParts.join(' OR ')})`);
    relevance = `(${relParts.join(' + ')})`;
  }
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
  let totalCount = 0;
  if (FILTERS[filter]) {
    // Rank across ALL rated priests matching the search, not just the first
    // 200 alphabetical rows: join approved reviews and order by category
    // average, then review count. Bare column names in the where fragments
    // are qualified to the priests table for the join.
    const col = FILTERS[filter];
    const whereP = where.map(qualifyPriestFragment);
    const relP = relevance ? qualifyPriestFragment(relevance) : null;
    const fsql = `SELECT p.*, ${relP ? `${relP} AS relevance, ` : ''}COUNT(r.id)::int AS n, AVG(r.pace) AS pace, AVG(r.homily) AS homily, AVG(r.likability) AS likability FROM priests p JOIN reviews r ON r.priest_id = p.id AND r.status='approved' WHERE ${whereP.join(' AND ')} GROUP BY p.id ORDER BY ${relP ? 'relevance DESC, ' : ''}AVG(r.${col}) DESC, COUNT(r.id) DESC LIMIT 200`;
    try {
      const frows = (await pool.query(fsql, params)).rows;
      cards = frows.map((p) => ({ p, st: { n: p.n, pace: p.pace, homily: p.homily, likability: p.likability } }));
      const csql = `SELECT COUNT(*)::int AS n FROM (${fsql.replace(/ ORDER BY.*$/, '')}) t`;
      totalCount = (await pool.query(csql, params)).rows[0].n;
    } catch (e) { console.error(e.message); }
  } else {
    let sql = relevance
      ? `SELECT *, ${relevance} AS relevance FROM priests WHERE ${where.join(' AND ')} ORDER BY relevance DESC, name LIMIT 200`
      : `SELECT * FROM priests WHERE ${where.join(' AND ')} ORDER BY name LIMIT 200`;
    let rows = [];
    try { rows = (await pool.query(sql, params)).rows; } catch (e) { console.error(e.message); }
    const stats = await statsFor(rows.map((r) => r.id));
    cards = rows.map((p) => ({ p, st: stats[p.id] }));
    try { totalCount = (await pool.query(`SELECT COUNT(*)::int AS n FROM priests WHERE ${where.join(' AND ')}`, params)).rows[0].n; } catch (e) { console.error(e.message); }
  }
  const heading = filter ? FILTER_LABELS[filter] : 'Search & Browse';
  const body = cards.length
    ? cards.map((c) => priestCard(c.p, c.st)).join('')
    : `<p>No priests matched that search.</p><p><a class="btn" href="/add-priest">Add this priest</a> <a class="btn btn-secondary" href="/browse">Clear search and filters</a></p><p class="small">If the priest is not listed, you can submit them for moderation review.</p>`;
  const matchLine = cards.length && totalCount > 200
    ? `<p class="match-count">Showing the first 200 priests</p>`
    : '';
  const searchIcon = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><line x1="16.5" y1="16.5" x2="21" y2="21"/></svg>`;
  res.send(page(heading, `<h1>${esc(heading)}</h1>
    <form action="/browse" method="get" id="browse-form">
      <div class="search">
        <span class="search-field">${searchIcon}<input name="q" value="${esc(q)}" placeholder="Name, parish, or city" aria-label="Search by name, parish, or city"></span>
        <input name="zip" value="${esc(zip)}" placeholder="ZIP (area-level)" aria-label="ZIP code" pattern="\\d{5}" inputmode="numeric" maxlength="5">
        <select name="filter" aria-label="Filter by category"><option value="">All priests</option>
          <option value="quick" ${filter === 'quick' ? 'selected' : ''}>Quick Mass</option>
          <option value="homily" ${filter === 'homily' ? 'selected' : ''}>Great homily</option>
          <option value="lovable" ${filter === 'lovable' ? 'selected' : ''}>Lovable priest</option></select>
        <button type="submit">Search</button>
      </div>
      <div class="place-section">
        <h2>Find by place</h2>
        <p class="explainer">Pick a state, then a city, then a diocese.</p>
        <div class="place-filters stacked" data-state="${esc(state)}" data-city="${esc(city)}" data-diocese="${esc(diocese)}">
          <select id="place-state" name="state" aria-label="State"><option value="">Choose a state</option></select>
          <select id="place-city" name="city" disabled aria-label="City"><option value="">Choose a city</option></select>
          <select id="place-diocese" name="diocese" disabled aria-label="Diocese"><option value="">Choose a diocese</option></select>
        </div>
      </div>
    </form>
    <p class="small">Nationwide search works within your chosen state when one is given. ZIP results are area-level only.</p>
    ${note}${matchLine}<div class="cards">${body}</div>`));
});

// Attendance-duration answers for the review form (required dropdown).
// Kept as the exact option values; the form and the POST handler both use
// this list so a tampered value cannot be stored.
const ATTENDANCE_OPTIONS = [
  'Just visiting / first time', 'Less than 6 months', '6 months to 1 year',
  '1 to 3 years', '3 to 5 years', '5 to 10 years', 'More than 10 years',
  'Lifelong parishioner',
];

// ---------- profile + rating ----------
app.get('/priest/:id', async (req, res) => {
  const { rows } = await pool.query(`SELECT * FROM priests WHERE id=$1 AND status='approved'`, [req.params.id]);
  if (!rows.length) return res.status(404).send(notFoundPage());
  const p = rows[0];
  const stats = await statsFor([p.id]);
  const st = stats[p.id];
  const revs = (await pool.query(`SELECT id, pace, homily, likability, church_beauty, mass_context, attendance_duration, body, created_at FROM reviews WHERE priest_id=$1 AND status='approved' ORDER BY created_at DESC LIMIT 50`, [p.id])).rows;
  // Church beauty is a separate average over the BUILDING only. It never
  // enters the priest's score, and it has its own review count.
  const church = (await pool.query(`SELECT COUNT(*)::int AS n, AVG(church_beauty) AS avg FROM reviews WHERE priest_id=$1 AND status='approved' AND church_beauty IS NOT NULL`, [p.id])).rows[0];
  const reviewHtml = revs.length ? revs.map((r) => {
    const ravg = (Number(r.pace) + Number(r.homily) + Number(r.likability)) / 3;
    const date = r.created_at ? new Date(r.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
    return `<article class="review">
    <div class="review-head"><span class="review-score">${ravg.toFixed(1)} out of 5</span>${starsHtml(ravg)}<span class="review-date">${date}${r.mass_context ? ` &middot; ${esc(r.mass_context)}` : ''}</span></div>
    <p class="review-cats">Pace <strong>${r.pace}</strong> &middot; Homily <strong>${r.homily}</strong> &middot; Likability <strong>${r.likability}</strong></p>
    ${r.church_beauty ? `<p class="review-church">Church beauty: <strong>${r.church_beauty} out of 5</strong> <span class="small">(the building, not the priest)</span></p>` : ''}
    ${r.attendance_duration ? `<p class="review-attendance">Attending this parish / knows this priest: <strong>${esc(r.attendance_duration)}</strong></p>` : ''}
    ${r.body ? `<p class="review-body">${esc(r.body)}</p>` : '<p class="review-body small">Star-only review (no written comment).</p>'}
    <div class="review-actions"><a href="/report?review=${r.id}&priest=${p.id}">Report this review</a></div></article>`;
  }).join('')
    : '<p>No published reviews for this priest yet.</p>';
  const avg = overallAvg(st);
  const scoreBoxLg = avg == null
    ? `<span class="score-box-lg unrated">Not yet rated</span>`
    : `<span class="score-box-lg"><span class="num">${avg.toFixed(1)}</span><span class="lbl">out of 5</span></span>`;
  const bar = (label, v) => `<div class="bar-row"><span class="bar-label">${label}</span><span class="bar-track"><span class="bar-fill" style="width:${(Number(v) / 5 * 100).toFixed(0)}%"></span></span><span class="bar-value">${fmtAvg(v)}</span></div>`;
  const barsHtml = st && st.n
    ? bar('Pace', st.pace) + bar('Homily', st.homily) + bar('Likability', st.likability)
    : '<p class="unrated">Not rated yet</p>';
  res.send(page(p.name, `<article class="profile-card">
    <div class="profile-banner" aria-hidden="true">${HERO_ART}</div>
    <div class="profile-body">
      <h1 class="profile-name">${esc(p.name)}</h1>
      <p class="profile-meta">${assignment(p)}</p>
      ${p.user_added ? '<p><span class="badge">User-added profile</span></p>' : `<p class="profile-sub">Directory listing: this profile comes from the 2017 directory.</p>`}
      ${p.diocese_code ? `<p class="profile-sub">Diocese: ${esc(dioceseName(p.diocese_code))} (${esc(p.diocese_code)})</p>` : ''}
      ${p.ordination_year ? `<p class="profile-sub">Ordination year (as listed): ${esc(p.ordination_year)}</p>` : ''}
      <div class="score-row">${scoreBoxLg}<div class="bars">${barsHtml}</div></div>
      ${st && st.n ? '<p class="small">Pace measures speed only, not quality.</p>' : ''}
      ${st && st.n === 1 ? '<p class="caveat">Based on a single review.</p>' : ''}
      ${church && church.n ? `<div class="church-box"><h3>The church building</h3><p><strong>${Number(church.avg).toFixed(1)} out of 5</strong> for church beauty, from ${church.n} review${church.n === 1 ? '' : 's'}. This rates the building, not the priest, and it never affects the priest's score above.</p></div>` : '<div class="church-box"><h3>The church building</h3><p>No church beauty ratings yet. When you review, you can rate how beautiful the building is. That rating is about the church, not the priest, and it never affects the priest\'s score.</p></div>'}
      <p class="profile-note">${DISCLAIMER}</p>
    </div>
  </article>
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
      <fieldset class="church-fieldset"><legend>The church building (optional)</legend>
      <p><label>How beautiful is the church building itself? <select name="church_beauty">
        <option value="">No rating</option><option value="1">1: plain</option><option value="2">2: modest</option>
        <option value="3">3: pleasant</option><option value="4">4: beautiful</option><option value="5">5: stunning</option></select></label></p>
      <p class="small">This rates the building, not the priest. It never affects the priest's score, and it is shown separately on the profile.</p></fieldset>
      <p><label>How long have you attended this parish or known this priest? <select name="attendance_duration" required>
        <option value="">Choose</option>${ATTENDANCE_OPTIONS.map((o) => `<option value="${esc(o)}">${esc(o)}</option>`).join('')}</select></label></p>
      <p><label>Mass context (optional): <input name="mass_context" maxlength="120" placeholder="e.g. Sunday 10am Mass"></label></p>
      <p><label>Written review (optional):<br><textarea name="body" rows="4" maxlength="2000"></textarea></label></p>
      <p class="small">Reviews are anonymous. No name or email is collected.</p>
      <p><label><input type="checkbox" name="attest_age" required> I confirm I am 18 or older.</label></p>
      <p><label><input type="checkbox" name="attest_honest" required> I confirm this review is my own honest opinion.</label></p>
      <button type="submit">Submit review</button>
    </form>
    <h2>Published reviews</h2>${reviewHtml}
    <p><a class="btn" href="/priest/${p.id}/correct">Correction, right of reply, or removal request</a></p>`, '<script src="/review.js"></script>'));
});

app.post('/priest/:id/review', async (req, res) => {
  const pid = Number(req.params.id);
  const { rows } = await pool.query(`SELECT id FROM priests WHERE id=$1 AND status='approved'`, [pid]);
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
    [numOrNull(req.body.review_id), numOrNull(req.body.priest_id), req.body.reason || 'Other', req.body.details || null]);
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
  const priestId = numOrNull(req.body.priest_id);
  if (!req.body.details || !priestId) return res.status(400).send(page('Not submitted', '<h1>Not submitted</h1><p>Details and a priest are required.</p>'));
  await pool.query(`INSERT INTO corrections (priest_id, type, details, contact) VALUES ($1,$2,$3,$4)`,
    [priestId, req.body.type || 'correction', req.body.details, req.body.contact || null]);
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
function infoPage(title, inner) { return page(title, `<h1>${esc(title)}</h1>${GLASS}${inner}`); }
app.get('/about', (req, res) => res.send(infoPage('About', `<p>RateMyFather is a RateMyProfessor-style site for anonymous ratings of Catholic priests on three things: pace of play (how fast Mass moves), homily performance, and likability.</p>
  <p>Directory profiles come from the 2017 directory. Each directory profile carries one small line noting that. Assignments are historical listings ("Listed at ..."), not a claim about where a priest serves today.</p>
  <p>${DISCLAIMER}</p><p>No paid placement. No sponsored priests.</p>`)));
app.get('/how', (req, res) => res.send(infoPage('How ratings work', `<p>Each rating is 1 to 5 in three categories:</p>
  <ul><li><strong>Pace of play measures speed only.</strong> 5 is brisk and quick, 1 is very slow. Pace is not a quality grade: a slow Mass is not a bad Mass.</li>
  <li><strong>Homily performance:</strong> 1 is poor, 5 is excellent.</li>
  <li><strong>Likability:</strong> 1 is not likable, 5 is very likable.</li></ul>
  <p>Every average score is shown with its review count, everywhere it appears. Averages use approved reviews only. A held review counts toward nothing.</p>
  <p>Each review also says how long the reviewer has attended the parish or known the priest, from a first-time visitor to a lifelong parishioner, and that is printed on the review so readers can weigh it.</p>
  <p>Screening: star-only and clearly clean reviews may auto-approve. Borderline reviews wait in the moderation queue. Possible unverified factual allegations (misconduct, crimes, improper behavior) are force-held with an abuse flag and never auto-approved. Reviews containing phone numbers or email addresses are refused outright. A repeat review of the same priest from the same source is refused. After 5 reviews in an hour from one source, further reviews are refused. If 10 or more reviews of one priest arrive in 24 hours, further reviews of that priest are force-held.</p>
  <p>Category lists ("Quick Mass", "Great homily", "Lovable priest") show rated priests only, sorted by that category average highest first, tie-broken by review count. Listings based on a single review carry a single-review caveat.</p>
  <p>Reviews are anonymous. No name or email is collected. For abuse prevention only, the site stores a hashed token derived from request data (see Privacy Policy).</p>
  <p>Reviews are user opinions, not verified facts. The site does not verify or endorse them. If you believe a review is unlawful or about you, use the <a href="/legal">Legal notices</a> page or the correction form on the priest's profile.</p>
  <p><strong>Church beauty is separate from the priest's score.</strong> When you review, you can optionally rate how beautiful the church building is, from 1 (plain) to 5 (stunning). That rating is about the building, not the priest. It is shown on the profile in its own box with its own review count, and it never affects the priest's score, averages, rankings, or category lists. A priest is never punished because their church is not beautiful.</p>`)));
app.get('/terms', (req, res) => res.send(infoPage('Terms of Use', `<p>Reviews are user-generated opinions. They are the individual reviewer's own opinion, not statements of fact, not verified by RateMyFather, and not endorsed by RateMyFather. A rating reflects one person's experience, not a finding about a priest.</p>
  <p>By submitting a review, you confirm you are 18 or older and that the review is your own honest opinion. You are responsible for what you submit. You must not submit private contact details, unverified factual allegations about identifiable people, or content you do not have the right to post.</p>
  <p>RateMyFather is not liable for user-submitted content. The site hosts reviews as a platform for user opinions; it does not adopt, verify, or stand behind them.</p>
  <p>The owner may approve, hold, reject, or remove any content at any time, for any reason, under the Content and Moderation Policy. Nothing on this site is guaranteed to stay published.</p>
  <p>If you believe content is unlawful, inaccurate, or about you, you can submit a legal notice or a correction. Use the <a href="/legal">Legal notices</a> page to submit a legal notice, or the correction form on a priest's profile to request a correction, a right of reply, or a removal. Links to both are in the footer of every page.</p>
  <p>No paid placement: no priest, parish, or diocese can pay for placement, ranking, or promotion on this site.</p>
  <p>This site does not claim that the site or its owner is immune from suit.</p>`)));
app.get('/privacy', (req, res) => res.send(infoPage('Privacy Policy', `<p>What is collected:</p>
  <ul><li><strong>Reviews:</strong> the three 1-5 ratings, how long you have attended the parish or known the priest, optional Mass context, and optional written review text you submit. No name or email is collected with reviews.</li>
  <li><strong>Abuse-prevention token:</strong> a SHA-256 hash derived from request data (IP address plus user agent). Only the hash is stored, never the raw IP address or user agent string. It is used only to refuse duplicates, enforce the hourly review limit, and detect review spikes.</li>
  <li><strong>Moderation submissions:</strong> reports, corrections, right-of-reply and removal requests, and legal notices, including any optional contact details you choose to provide. Contact details are never published.</li>
  <li><strong>Owner session:</strong> a signed, httpOnly session cookie is set only when the owner signs in. It contains an expiry time and a signature, nothing else.</li></ul>
  <p>Nothing else is collected for tracking or advertising. There is no advertising on this site.</p>
  <p>To request removal of personal information you submitted, use the <a href="/legal">Legal notices</a> page. Contact details you provide in a legal notice are never published.</p>`)));
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
      // ALL terms must match the name. OR let one stray term (e.g. "such"
      // in "Zzqx No Such Priest") return an unrelated priest such as
      // "Bandsuch", instead of the no-match path with the add link.
      const cond = terms.map((_, i) => `name ILIKE $${i + 1}`).join(' AND ');
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

// Global error handler. Express 4 does not catch async route rejections, so
// any error that escapes a route lands here as a 500 instead of hanging the
// request or crashing the process on an unhandled rejection.
app.use((err, req, res, next) => {
  console.error(err && err.stack ? err.stack : err);
  if (res.headersSent) return next(err);
  res.status(500).send(page('Something went wrong', '<h1>Something went wrong</h1><p>Please try again.</p>'));
});

// Catch-all 404: any URL that matches no route above gets the site's helpful
// 404 page (search box, Browse, Arcade, Add-a-priest), not Express's bare
// default "Cannot GET" page.
app.use((req, res) => res.status(404).send(notFoundPage()));

// ---------- boot ----------
async function boot() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set. Set it to a Postgres connection string and restart.');
    process.exit(1);
  }
  if (!OWNER_SECRET) console.warn('WARNING: OWNER_SECRET is not set. Owner moderation will refuse all access until it is set.');
  // Run every migration in order (001, 002, ...). All migrations are
  // idempotent (IF NOT EXISTS), so re-running them on boot is safe.
  const migDir = path.join(__dirname, 'migrations');
  if (fs.existsSync(migDir)) {
    for (const f of fs.readdirSync(migDir).sort()) {
      if (f.endsWith('.sql')) await pool.query(fs.readFileSync(path.join(migDir, f), 'utf8'));
    }
  }
  app.listen(PORT, () => console.log(`RateMyFather listening on port ${PORT}`));
}
boot().catch((e) => { console.error(e); process.exit(1); });
