// Shared profanity filter, used in exactly two places so there is one
// list, not two: trivia leaderboard names (server.js) and review bodies
// (lib/screening.js, enforced in screenBody). Enforced server side in
// both cases, so it cannot be bypassed by submitting directly from a
// browser or a script. A blocked name or review is refused outright with
// a plain message asking for a different name or a rewording; nothing is
// saved under a blocked name and no profane review is ever published.
//
// Matching is whole-word only, the same rule the allegation check uses,
// so innocent words that merely contain a bad word as a substring
// ("class", "pass", "hello", "Sussex", "Cassandra") are never caught.
// Common dodge spellings are handled three ways: leetspeak decoding
// (sh1t, b1tch, a$$hole), collapsed repeats (shiiit, fuuuck), and
// explicit dodge forms in the list (fuk, fck, shyt, azz). Spaced-out
// letters ("f u c k") and split words ("f uck", "sh it") are caught by
// joining tokens and checking the joined form. Deliberately NOT in the
// list: ordinary words and names that overlap with crude words ("Dick"
// is a real first name; "sex", "snatch", "oral", "ho" are ordinary
// English). The list is meant to be reasonable, not exhaustive: it
// covers clear profanity, slurs, and crude terms, not mild annoyance.

const PROFANITY_WORDS = [
  // Core profanity
  'fuck', 'fucker', 'fucking', 'fucked', 'fuckin', 'motherfucker', 'fuk', 'fck', 'fuc', 'phuck', 'phuk', 'fvck',
  'shit', 'shitty', 'shite', 'shyt', 'sht', 'bullshit', 'horseshit', 'dogshit', 'dipshit', 'shithead',
  'bitch', 'bitches', 'bytch', 'biatch',
  'bastard', 'bastards',
  'asshole', 'asshat', 'ahole', 'ass', 'azz', 'dumbass', 'jackass', 'smartass', 'badass',
  'cunt', 'cunts',
  'whore', 'whores', 'slut', 'sluts', 'skank',
  'pussy', 'pussies', 'prick', 'dickhead', 'cock', 'cocks',
  'tits', 'tit', 'boobs', 'boner',
  'dildo', 'cum', 'jizz', 'blowjob', 'handjob', 'masturbate', 'porn', 'penis', 'vagina',
  'horny', 'anal',
  'piss', 'crap', 'turd', 'fart',
  'damn', 'hell',
  'douche', 'douchebag', 'wank', 'wanker', 'bollocks', 'bugger', 'arse',
  // Slurs
  'nigger', 'niggers', 'nigga', 'niggas', 'niggah', 'nigguh',
  'faggot', 'faggots', 'fag', 'fags',
  'dyke', 'dykes', 'tranny', 'trannies',
  'chink', 'chinks', 'spic', 'spics', 'kike', 'kikes', 'gook', 'gooks',
  'wetback', 'wetbacks', 'heeb', 'retard', 'retards',
];

const PROFANITY_SET = new Set(PROFANITY_WORDS);

// Leetspeak decoding. '1' is ambiguous (i or l), so decoding produces
// both variants where it appears.
const LEET = { '0': 'o', '3': 'e', '4': 'a', '5': 's', '6': 'g', '7': 't', '9': 'g', '@': 'a', '$': 's', '+': 't', '!': 'i', '|': 'i', '€': 'e' };

function decodeLeet(word) {
  const out = new Set([word]);
  let cur = new Set([word]);
  for (const ch of Object.keys(LEET)) {
    const next = new Set();
    for (const w of cur) {
      if (w.includes(ch)) next.add(w.split(ch).join(LEET[ch]));
      next.add(w);
    }
    cur = next;
  }
  for (const w of cur) out.add(w);
  // '1' -> 'i' and '1' -> 'l' both.
  const withI = new Set();
  for (const w of out) withI.add(w.includes('1') ? w.split('1').join('i') : w);
  const withL = new Set();
  for (const w of out) withL.add(w.includes('1') ? w.split('1').join('l') : w);
  return new Set([...out, ...withI, ...withL]);
}

// Collapse any run of the same letter to a single letter:
// "shiiit" -> "shit", "fuuuck" -> "fuck". The raw token is always
// checked too, so "ass" still matches even though collapsing it gives "as".
function collapseRepeats(word) {
  return word.replace(/(.)\1+/g, '$1');
}

// Candidate forms of one token: raw, leet-decoded, collapsed, and
// collapsed-decoded. A token matches if any candidate is in the list,
// or if the candidate minus a trailing plural "s"/"es" is.
function tokenMatches(token) {
  const forms = new Set();
  for (const d of decodeLeet(token)) {
    forms.add(d);
    forms.add(collapseRepeats(d));
  }
  for (const f of forms) {
    if (PROFANITY_SET.has(f)) return true;
    if (f.length > 3 && f.endsWith('s') && PROFANITY_SET.has(f.slice(0, -1))) return true;
    if (f.length > 4 && f.endsWith('es') && PROFANITY_SET.has(f.slice(0, -2))) return true;
  }
  return false;
}

// True when the text contains a blocked word as a whole word, including
// leetspeak, repeated-letter, and spaced-out dodge spellings.
function containsProfanity(text) {
  if (!text) return false;
  const tokens = String(text).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (!tokens.length) return false;
  for (const t of tokens) {
    if (/[a-z]/.test(t) && tokenMatches(t)) return true;
  }
  // Spaced-out letters: "f u c k" -> "fuck".
  let run = [];
  const flushRun = () => {
    if (run.length > 1) {
      const joined = run.join('');
      if (tokenMatches(joined)) return true;
    }
    run = [];
  };
  for (const t of tokens) {
    if (t.length === 1 && /[a-z]/.test(t)) run.push(t);
    else if (flushRun()) return true;
  }
  if (flushRun()) return true;
  // Split words: "f uck", "sh it" -> joined form checked exactly.
  // Exact equality only, so "Cassandra" or "Sussex" never match.
  if (tokens.length > 1) {
    const joined = tokens.join('');
    if (/[a-z]/.test(joined) && tokenMatches(joined)) return true;
  }
  return false;
}

// Validate a trivia leaderboard display name. Short, no account, nothing
// personal beyond the name typed. Blank means "Anonymous". Returns
// { ok, name } or { ok: false, reason } where reason is 'too_long',
// 'no_letters', 'bad_chars', or 'profanity'.
function cleanTriviaName(raw) {
  const name = String(raw == null ? '' : raw).trim().replace(/\s+/g, ' ');
  if (!name) return { ok: true, name: 'Anonymous' };
  if (name.length > 20) return { ok: false, reason: 'too_long' };
  if (!/[a-z]/i.test(name)) return { ok: false, reason: 'no_letters' };
  if (/[^a-z0-9 '\-.]/i.test(name)) return { ok: false, reason: 'bad_chars' };
  if (containsProfanity(name)) return { ok: false, reason: 'profanity' };
  return { ok: true, name };
}

module.exports = { PROFANITY_WORDS, containsProfanity, cleanTriviaName };
