#!/usr/bin/env python3
"""Parse the Official Catholic Directory 2017 Priests Index PDF into seed JSON.

Input : OCD17_PriestsIndex.pdf (285 pages, 3-column layout) in this directory.
Output: priests.json -- a JSON array of objects with exactly these keys:
    name, parish, city, state, diocese_code, ordination_year

Rules (from the brief):
  * One record per directory entry (not per assignment). The first assignment
    segment that carries a "City, ST" location supplies city/state/parish.
  * If no assignment segment carries a location, parish holds the first
    assignment/descriptor text (e.g. "Retired") and city/state are null.
  * A field that is genuinely missing is null; no value is ever invented.
  * Dedupe removes ONLY exactly identical rows (all six fields equal).
  * No ratings are created or implied anywhere in this output.

Method:
  * PyMuPDF word boxes are grouped into lines, lines into the three columns
    (x0 < 212, 212..392, >= 392), columns read left-to-right, pages in order.
    The running head (y < 40) and lone section letters ("A", "B", ...) are
    dropped. Line-end hyphens are rejoined (split words and hyphenated
    compounds alike), including across column/page boundaries.
  * Everything before the first directory entry is preamble (title and the
    religious-order abbreviations table) and is dropped.
  * Entries are split on the "Surname, Given ..." pattern validated by an
    ordination year ('YY) or diocese code (CODE) within the next ~100 chars.
  * Ordination years are two digits: '00..'17 -> 2000s, '18..'99 -> 1900s.
    (A 2017 directory cannot contain a 2018 ordination, and a priest ordained
    in 1917 would be implausibly old, so the pivot at 17 is safe.)
  * Diocese code is the parenthesised code after the ordination year, or, for
    entries with no year, the first parenthesised code after the name that is
    not a title-case nickname such as (Lito).
  * The name keeps the surname and given names (plus a nickname in parens),
    with honorifics (Rev., Msgr., Rt. Rev., ...) and religious-order suffixes
    (s.j., o.f.m.cap., ...) stripped from the given-name part.

Usage:  python3 parse-priests.py   (run from this directory)
"""

import json
import re
import sys
from collections import Counter

import pymupdf

PDF = "OCD17_PriestsIndex.pdf"
OUT = "priests.json"

# Column boundaries in PDF points (letter page, 612 wide).
COL2_X = 212
COL3_X = 392
HEADER_Y = 40  # running head / page number sits at y ~= 29

STATES = {
    "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI",
    "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN",
    "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH",
    "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA",
    "WV", "WI", "WY", "PR", "GU", "VI", "AS", "MP",
}
STATE_ALT = "|".join(sorted(STATES))

HONORIFICS = {
    "rev", "rev.", "msgr", "msgr.", "rt", "rt.", "very", "most", "dr",
    "dr.", "fr", "fr.", "br", "br.", "archimandrite", "bishop",
    "archbishop", "cardinal", "dom", "dom.", "ven", "ven.",
}

# Surname, Given ...  -- surname words are capitalised (or a small set of
# particles); the given-name part must start with a capital. Surname words
# are joined by literal spaces ONLY: allowing \s would let a match span a
# line break and swallow the next entry (e.g. "Jesus.\nAaron" as one name).
SURNAME_WORD = r"(?:[A-Z][A-Za-zÀ-ÿ'’\-.]*|de|van|von|der|den|di|du|la|del|della|dos|das|do)"
# A surname may also START with a lowercase particle: d'Anjou, de la Cruz.
SURNAME_FIRST = r"(?:[A-Z][A-Za-zÀ-ÿ'’\-.]*|d'[A-Z][A-Za-zÀ-ÿ'’\-.]*|de|di|van|von|der|den|du|la|del|della|dos|das|do)"
ENTRY_HEAD_RE = re.compile(
    r"(?P<surname>" + SURNAME_FIRST + r"(?: +" + SURNAME_WORD + r")*?),"
    r" +(?P<given>[A-Z])"
)
YEAR_RE = re.compile(r"['’](\d{2})\b")
PAREN_RE = re.compile(r"\(([A-Za-z]{1,6})\)")
BRACKET_RE = re.compile(r"^\s*\[[A-Za-z]+\]\s*")
CITY_STATE_RE = re.compile(
    r"(?P<city>[A-Z][A-Za-z'’.\-]*(?:\s+[A-Z][A-Za-z'’.\-]*)*?),\s*"
    r"(?P<state>" + STATE_ALT + r")\b"
)
ORDER_TOKEN_RE = re.compile(r"^[a-z]{1,6}(\.[a-z]{1,6})+\.?$")


def column_lines(page):
    """Return the page's text lines in reading order: col 1, col 2, col 3."""
    cols = [[], [], []]
    words = [w for w in page.get_text("words") if w[1] >= HEADER_Y]
    for w in words:
        x0 = w[0]
        cols[0 if x0 < COL2_X else (1 if x0 < COL3_X else 2)].append(w)
    lines = []
    for col in cols:
        col.sort(key=lambda w: (w[1], w[0]))
        cur_y, cur = None, []
        for w in col:
            if cur_y is None or abs(w[1] - cur_y) <= 3.0:
                cur.append(w)
                cur_y = w[1] if cur_y is None else cur_y
            else:
                lines.append(" ".join(x[4] for x in sorted(cur, key=lambda x: x[0])))
                cur, cur_y = [w], w[1]
        if cur:
            lines.append(" ".join(x[4] for x in sorted(cur, key=lambda x: x[0])))
    # Drop lone section letters ("A", "B", ...) printed as their own line.
    return [ln for ln in lines if not re.fullmatch(r"[A-Z]", ln.strip())]


def build_stream(doc):
    """Ordered lines for the whole book, with hyphenated breaks rejoined."""
    lines = []
    for page in doc:
        lines.extend(column_lines(page))
    # Rejoin a line that ends in an attached hyphen with the next line.
    # This covers both split words ("Inter-" + "national") and hyphenated
    # compounds ("Heart-" + "Albuquerque"), and works across column/page
    # boundaries because entries never end with a hyphen.
    joined = []
    for ln in lines:
        if joined and re.search(r"[A-Za-z0-9]-$", joined[-1]):
            joined[-1] = joined[-1] + ln.lstrip()
        else:
            joined.append(ln)
    # Repair surnames the PDF text layer splits into two tokens at a line
    # start ("Guzm an,", "Alay on,", "S anchez,"): a lowercase fragment
    # immediately before the comma, following capitalised word(s), is
    # never a legitimate surname ending, so rejoin it. Legitimate
    # multi-word surnames ("De La Cruz,", "Van Der Berg,") are untouched
    # because their pre-comma word is capitalised.
    repaired = []
    for ln in joined:
        ln = re.sub(
            r"^((?:[A-Z][\w'’\-.]* +)*)([A-Z][\w'’\-]*) ([a-z]{1,8},)",
            r"\1\2\3", ln)
        repaired.append(ln)
    return "\n".join(repaired)


def is_entry_start(stream, m):
    """True if match m sits at a line start or just after a sentence end."""
    pos = m.start()
    if pos == 0 or stream[pos - 1] == "\n":
        return True
    return stream[pos - 2:pos] == ". "


ORG_WORDS = {"inc", "inc.", "ltd", "ltd.", "co", "co.", "corp", "corp.",
             "company"}


def _first_given_token(stream, m):
    """The word the 'Surname, X' match's given-name part starts with."""
    rest = stream[m.end() - 1:]  # starts at the given initial letter
    tok = rest.split(" ", 1)[0].strip()
    return tok


def _header_ok(stream, m):
    """True if an ordination year or diocese code follows the name header.

    Guards against wrapped assignment lines that mimic entries, e.g.
    'Cresson, PA St. Francis Xavier; (MO) Navy Reserve Chaplains.' or
    'Wausau, WI Newman Catholic High School (NCS).' -- both start with a
    'Word, ST' lookalike and carry a parenthesised code that is NOT a
    diocese code. Rules:
      * the first given token must look like a person's name: it must not
        be a US state/territory code, an all-caps token, or an organisation
        word such as 'Inc.';
      * between the name and the year/code there must be no ';' and no
        second comma (true headers never contain either);
      * the year/code must sit on the SAME line as the name (the normal
        case), or, when the name itself wraps, at the very start of the
        next line in the form of a year, a code paren, an initial, a title
        or an order suffix -- never a full capitalised word, which would
        be assignment text.
    """
    tok = _first_given_token(stream, m)
    # An initial such as "J." / "P." is fine; a 2+ letter all-caps token is
    # a state code or similar, not a given name. (Strip the period first:
    # "P.".isupper() is True, which wrongly rejected initial-led names.)
    letters = tok.strip(".")
    if tok in STATES or tok.lower() in ORG_WORDS or (len(letters) >= 2 and letters.isupper()):
        return False

    line_end = stream.find("\n", m.end())
    line_end = len(stream) if line_end == -1 else line_end
    rest = stream[m.end():line_end]
    for pat in (YEAR_RE, PAREN_RE):
        pm = pat.search(rest)
        if pm:
            span = rest[:pm.start()]
            if ";" not in span and "," not in span:
                return True
    # Wrapped header? Only if this line carries no assignment text at all:
    # no ';', no City,ST, and it must not end with a sentence period.
    if ";" in rest or CITY_STATE_RE.search(rest) or rest.rstrip().endswith("."):
        return False
    nxt_end = stream.find("\n", line_end + 1)
    nxt_end = len(stream) if nxt_end == -1 else nxt_end
    nxt = stream[line_end + 1:nxt_end].strip()
    if not nxt:
        return False
    # Next line must OPEN with a year, a code paren, an initial, a title
    # or an order suffix -- not a full capitalised word.
    if YEAR_RE.match(nxt) or PAREN_RE.match(nxt):
        return True
    first = nxt.split(" ", 1)[0]
    if re.fullmatch(r"[A-Z]\.", first):
        return True
    if first.lower().strip(".") in HONORIFICS or ORDER_TOKEN_RE.match(first):
        return True
    return False


def split_entries(stream):
    """Split the stream into raw entry blocks."""
    # Drop the preamble: title + abbreviations table, everything before the
    # first validated entry start.
    starts = []
    for m in ENTRY_HEAD_RE.finditer(stream):
        if is_entry_start(stream, m) and _header_ok(stream, m):
            starts.append(m.start())
    if not starts:
        raise SystemExit("no entries found: check column geometry / patterns")
    blocks = []
    for i, s in enumerate(starts):
        e = starts[i + 1] if i + 1 < len(starts) else len(stream)
        blocks.append(stream[s:e].strip())
    return blocks


def clean_given(given_raw):
    """Strip honorifics / order suffixes from the given-name part."""
    tokens = given_raw.split()
    kept = []
    for tok in tokens:
        low = tok.strip(",").lower()
        if low in HONORIFICS:
            continue
        if ORDER_TOKEN_RE.match(tok.strip(",")):
            continue
        kept.append(tok)
    return " ".join(kept).strip(" ,").strip()


def parse_entry(block):
    text = re.sub(r"\s+", " ", block).strip()

    year_m = YEAR_RE.search(text)
    ord_year = None
    if year_m:
        yy = int(year_m.group(1))
        ord_year = 2000 + yy if yy <= 17 else 1900 + yy

    # Diocese code: paren right after the year, else first non-nickname paren
    # in the header (before the first assignment separator).
    diocese = None
    dio_end = None
    header_for_paren = text
    if year_m:
        pm = PAREN_RE.search(text, year_m.end())
        if pm:
            diocese, dio_end = pm.group(1), pm.end()
    if diocese is None:
        head_end = text.find(";")
        head_end = len(text) if head_end == -1 else head_end
        for pm in PAREN_RE.finditer(text[:head_end]):
            tok = pm.group(1)
            # Skip title-case nicknames such as (Lito); codes are all-caps
            # or mixed like FgM, never a plain lowercase-tailed word.
            if len(tok) > 2 and tok[1:].islower():
                continue
            diocese, dio_end = tok, pm.end()
            break

    # Name: everything before the year token, else before the diocese paren,
    # else before the first assignment separator.
    if year_m:
        name_raw = text[:year_m.start()]
    elif dio_end is not None:
        name_raw = text[: text.rfind("(", 0, dio_end)]
    else:
        name_raw = text.split(";")[0]
    name_raw = BRACKET_RE.sub("", name_raw).strip(" ,")
    if "," in name_raw:
        surname, given_raw = name_raw.split(",", 1)
        # A nickname paren inside the given part is kept; a code paren is not
        # part of the name (it was already cut above when a year exists, but
        # for no-year entries the cut above uses the same paren, so this is
        # only a safety net).
        given = clean_given(given_raw)
        name = f"{surname.strip()}, {given}" if given else surname.strip()
    else:
        name = name_raw

    # Body: everything after the diocese paren / year token / name.
    if dio_end is not None:
        body = text[dio_end:]
    elif year_m:
        body = text[year_m.end():]
    else:
        body = text[len(name_raw):]
    body = body.strip()
    # A bracket category code may follow the diocese, e.g. (NY)[CC].
    body = re.sub(r"^(\[[A-Za-z]+\]\s*)+", "", body)

    parish = city = state = None
    if body:
        segments = [s.strip().strip(".").strip() for s in body.split(";")]
        segments = [BRACKET_RE.sub("", s).strip() for s in segments]
        segments = [s for s in segments if s]
        located = None
        for seg in segments:
            for cm in CITY_STATE_RE.finditer(seg):
                # Skip all-caps "cities": they are region codes, not places
                # (e.g. "Kowloon, SAR, NE." must not yield city "SAR").
                city_letters = re.sub(r"[^A-Za-z]", "", cm.group("city"))
                if len(city_letters) >= 2 and city_letters.isupper():
                    continue
                rest = seg[cm.end():].strip(" .")
                located = (rest if rest else None, cm.group("city"), cm.group("state"))
                break
            if located:
                break
        if located:
            parish, city, state = located
        elif segments:
            parish = segments[0]

    return {
        "name": name or None,
        "parish": parish,
        "city": city,
        "state": state,
        "diocese_code": diocese,
        "ordination_year": ord_year,
    }


def main():
    doc = pymupdf.open(PDF)
    print(f"pages: {len(doc)}")
    stream = build_stream(doc)
    print(f"stream chars: {len(stream)}")
    blocks = split_entries(stream)
    print(f"raw entry blocks: {len(blocks)}")
    print(f"first block: {blocks[0][:160]}")
    print(f"last block: {blocks[-1][:160]}")

    records = [parse_entry(b) for b in blocks]

    # Diagnostics: line-start "Surname, Given" lines whose header did NOT
    # validate (potential missed entries, e.g. an unusual header layout).
    missed = []
    for m in ENTRY_HEAD_RE.finditer(stream):
        if is_entry_start(stream, m) and not _header_ok(stream, m):
            ln_end = stream.find("\n", m.start())
            missed.append(stream[m.start():ln_end if ln_end != -1 else len(stream)])
    print(f"line-start name lines failing header validation: {len(missed)}")
    for ln in missed[:25]:
        print("  REJECTED?", ln[:130])

    years = [r["ordination_year"] for r in records if r["ordination_year"]]
    print(f"ordination years: min={min(years)} max={max(years)} "
          f"missing={sum(1 for r in records if r['ordination_year'] is None)}")
    print(f"missing diocese: {sum(1 for r in records if not r['diocese_code'])}")
    print(f"missing parish: {sum(1 for r in records if not r['parish'])}")
    print(f"missing city/state: {sum(1 for r in records if not r['city'])}")
    print(f"distinct diocese codes: {len({r['diocese_code'] for r in records if r['diocese_code']})}")

    # Dedupe: only exactly identical rows.
    seen, deduped, dupes = set(), [], 0
    for r in records:
        key = tuple(r[k] for k in
                    ("name", "parish", "city", "state", "diocese_code", "ordination_year"))
        if key in seen:
            dupes += 1
        else:
            seen.add(key)
            deduped.append(r)
    print(f"exact duplicates removed: {dupes}")
    print(f"final record count: {len(deduped)}")

    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(deduped, fh, ensure_ascii=False, indent=1)
    print(f"wrote {OUT}")

    # Alphabetical sanity check on surnames.
    surnames = [r["name"].split(",")[0].lower() if r["name"] else "" for r in deduped]
    inversions = sum(1 for a, b in zip(surnames, surnames[1:]) if b < a)
    print(f"surname order inversions (same-person repeats inflate this): {inversions}")


if __name__ == "__main__":
    main()
