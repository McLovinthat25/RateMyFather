// Review screening rules, enforced server side in server.js.
// Documented thresholds (change here, and update How ratings work + README together):
//   - CONTACT_REFUSED: a review containing a phone number or email address is REFUSED outright.
//   - ALLEGATION_HOLD: text matching ALLEGATION_KEYWORDS is force-held (pending, abuse_flag)
//     and NEVER auto-approved. This covers possible unverified factual allegations of
//     misconduct, crimes, or improper behavior. Allegations are never published by the
//     chatbot and never quoted anywhere.
//   - DUPLICATE_REFUSED: a repeat review of the same priest from the same source token is refused.
//   - BURST_LIMIT: after 5 reviews in an hour from one source token, further reviews are refused.
//   - SPIKE_THRESHOLD: 10+ reviews of one priest in 24h force-holds further reviews of that
//     priest (pending, flag_reason 'spike').
//   - Otherwise: star-only reviews (no written body) that are clean auto-approve. Written
//     reviews that are clean, short (<= 500 chars) and contain no BORDERLINE_MARKERS
//     auto-approve. Anything else (long text, borderline wording) waits in the queue.
// Source identity: SHA-256 of (IP + '|' + user agent). Only the hash is stored.

const crypto = require('crypto');

const ALLEGATION_KEYWORDS = [
  'abuse', 'abused', 'abusive', 'molest', 'molested', 'molestation',
  'assault', 'assaulted', 'rape', 'raped', 'rapist',
  'sexual misconduct', 'sexual harassment', 'sexually harassed',
  'pedophile', 'paedophile', 'predator', 'grooming', 'groomed',
  'inappropriate touching', 'touched inappropriately',
  'stole', 'stolen', 'theft', 'embezzle', 'embezzled', 'fraud', 'fraudulent',
  'criminal', 'crime', 'arrested', 'police', 'illegal',
  'drunk', 'intoxicated', 'alcoholic', 'addict',
  'harassed', 'harassment', 'threatened', 'threatening',
  'misconduct', 'improper behavior', 'improper behaviour',
];

const BORDERLINE_MARKERS = [
  'but ', 'however', 'disappoint', 'boring', 'rude', 'arrogant', 'cold',
  'political', 'rushed', 'unwelcoming', 'judgmental', 'judgemental',
  'inappropriate', 'uncomfortable', 'weird', 'creepy', 'angry', 'yelled',
  'money', 'donation', 'collection', 'scam',
];

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
// Loose phone matcher: 10+ digits with optional separators, incl. optional country code.
const PHONE_RE = /(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/;

const BURST_LIMIT = 5; // reviews per hour per source token, then refuse
const BURST_WINDOW_MS = 60 * 60 * 1000;
const SPIKE_THRESHOLD = 10; // reviews of one priest in 24h, then force-hold
const SPIKE_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_AUTO_APPROVE_BODY_CHARS = 500;

function sourceTokenHash(req) {
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || 'unknown';
  const ua = req.headers['user-agent'] || '';
  return crypto.createHash('sha256').update(ip + '|' + ua).digest('hex');
}

function containsContactDetails(text) {
  if (!text) return false;
  return EMAIL_RE.test(text) || PHONE_RE.test(text);
}

function containsAllegation(text) {
  if (!text) return false;
  const lower = ' ' + text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ') + ' ';
  // Whole-word match only (plus an optional plural "s"), so innocent words
  // containing a keyword as a substring ("grape", "scrape", "drape" contain
  // "rape") do not force-hold a review. Plurals such as "crimes" or
  // "predators" still match via the trailing "s" form.
  return ALLEGATION_KEYWORDS.some((k) => lower.includes(' ' + k + ' ') || lower.includes(' ' + k + 's '));
}

function containsBorderline(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return BORDERLINE_MARKERS.some((m) => lower.includes(m));
}

// Pure decision step (no DB). Returns { outcome, flagReason } where outcome is
// 'refuse' | 'hold' | 'approve'. DB checks (duplicate, burst, spike) run in server.js
// and override an 'approve' with 'refuse'/'hold' as documented above.
function screenBody(body) {
  const text = (body || '').trim();
  if (containsContactDetails(text)) {
    return { outcome: 'refuse', reason: 'contact_details' };
  }
  if (containsAllegation(text)) {
    return { outcome: 'hold', reason: 'allegation', abuseFlag: true };
  }
  if (!text) return { outcome: 'approve', reason: 'star_only_clean' };
  if (text.length > MAX_AUTO_APPROVE_BODY_CHARS || containsBorderline(text)) {
    return { outcome: 'hold', reason: 'borderline', abuseFlag: false };
  }
  return { outcome: 'approve', reason: 'clean_written' };
}

module.exports = {
  ALLEGATION_KEYWORDS, BORDERLINE_MARKERS, BURST_LIMIT, SPIKE_THRESHOLD,
  MAX_AUTO_APPROVE_BODY_CHARS, sourceTokenHash, containsContactDetails,
  containsAllegation, containsBorderline, screenBody,
};
