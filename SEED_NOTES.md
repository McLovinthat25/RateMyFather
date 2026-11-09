# RateMyFather seed data notes

Source: Official Catholic Directory 2017 Priests Index,
`OCD17_PriestsIndex.pdf` (285 pages, downloaded from
https://www.officialcatholicdirectory.com/assets/OCD17_PriestsIndex.pdf,
13,263,074 bytes, HTTP 200). The PDF is kept in this directory as the raw
source; the parser (`parse-priests.py`, requires PyMuPDF) reads it directly.

## Counts

- Raw entry blocks parsed: **41,739**
- Exact duplicates removed: **3**
- Final records in `priests.json`: **41,736**
- Brief target was "near 41,653"; this parse lands 83 records (+0.2%)
  above it. The number was not forced. The gap is within the range
  explained by the caveats below (legitimately repeated entries for the
  same person, and a small number of ambiguous header lines).

## Dedupe rule

Only exactly identical rows were removed (all six fields equal).
Repeated entries for the same person in different dioceses or with
different assignments were KEPT, because they are distinct directory
entries (examples: two `Guzman, Baudilio` records, one with no year at
Maranatha House of Prayer and one ordained 1991 in San Juan, PR; two
`Zuk, Richard` records; several `Zientek, Rev. Msgr. Benedict` records).
No fuzzy, name-only, or near-duplicate merging was done.

## Parsing method

1. PyMuPDF word boxes grouped into lines, lines into the three columns
   (x0 < 212, 212–392, >= 392), read left to right, pages in order.
   The running head (page number / section title at the top of each
   page) and lone section letters ("A", "B", …) were dropped.
2. Line-end hyphens rejoined (split words and hyphenated compounds),
   including across column/page boundaries; entries never end with a
   hyphen, so this is safe.
3. Everything before the first directory entry (title + religious-order
   abbreviations table on page 1) was dropped.
4. Entries split on the `Surname, Given …` pattern at a line start (or
   after a sentence-ending period), validated by an ordination year
   (`'YY`) or a parenthesised diocese code on the same line. The
   validation also rejects wrapped assignment lines that mimic entries
   (see below).
5. One record per entry, using the FIRST assignment segment that
   carries a `City, ST` location for city/state/parish. If no segment
   carries a location, `parish` holds the first assignment/descriptor
   text (e.g. "Retired") and city/state are null.
6. Ordination years are two digits in the source: `'00`–`'17` mapped to
   2000–2017, `'18`–`'99` to 1918–1999. Observed range in the output is
   1929–2017.
7. Names keep surname + given names (plus a nickname in parentheses,
   e.g. `Abad, Jose Antonio P. (Lito)`). Honorifics (Rev., Msgr.,
   Rt. Rev., …) and religious-order suffixes (s.j., o.f.m.cap., …)
   were stripped from the given-name part. Diocese code is the
   parenthesised code after the ordination year (or after the name for
   entries with no year); nickname parentheses are not treated as codes.
8. Fields are exactly: `name`, `parish`, `city`, `state`,
   `diocese_code`, `ordination_year`. Missing values are null, never
   invented. No ratings, no ZIP codes (the source index gives none),
   no Pennsylvania sweep data, no diocese/parish contact was made.

## Field completeness (final 41,736)

- Missing `ordination_year`: 2,052 (entries printed without a year)
- Missing `diocese_code`: 0
- Missing `parish`: 6 — all cases where the assignment is just a place
  (e.g. `Maryknoll, NY`, `St. Albans, NY`, `Forest Hills, NY`)
- Missing `city`/`state`: 8,922 — mostly Retired / role-only /
  institution-only entries, plus foreign assignments printed without a
  US state or territory code (e.g. `Kowloon, SAR, NE` is kept verbatim
  as a parish descriptor with city/state null)
- Distinct `diocese_code` values: 212

## Caveats

- **Wrapped assignment lines that look like entries.** The index wraps
  assignments across lines, and a wrapped line such as
  `Cresson, PA St. Francis Xavier; (MO) Navy Reserve Chaplains.` or
  `Wausau, WI Newman Catholic High School (NCS).` mimics a
  `Surname, Given (CODE)` header. The splitter rejects these when the
  first given token is a state code, an all-caps token, or an
  organisation word (Inc.), or when a `;` or second comma appears
  before the year/code. 5,896 line-start name-like lines failed header
  validation and were rejected; a sample of them was inspected and all
  sampled lines were assignment continuations, not entries. A small
  residual risk remains for foreign-city continuations whose first
  token is a plausible name and which carry a parenthesised code on
  the same line.
- **Split surnames in the PDF text layer.** A few surnames are split
  into two tokens at a line start in the source PDF itself
  (`Guzm an,`, `Alay on,`, `S anchez,`). These were rejoined by a
  targeted repair (a lowercase fragment immediately before the comma
  is never a legitimate surname ending). Verified fixed: Guzman,
  Alayon, Sanchez (Fernando Benicio Felices). The same class of split
  elsewhere (given names, parish names) was not repaired, because it
  cannot be distinguished from legitimate multi-word names without a
  dictionary.
- **Lowercase surnames.** Three entries start with a lowercase
  surname (`d'Anjou, John R.`, `d'Auby, Phillip`,
  `d'Escoto, Miguel F.`); the splitter was extended to catch them
  instead of merging them into the preceding entry. Verified split.
- **Spelling variants preserved as printed.** No spelling
  normalisation was applied. Source oddities are kept verbatim, e.g.
  `Zwolenkiewicz, Rapael` [sic], `Aclan, Alejandro` with parish
  `Clergy, Vicar for` (the directory's own inverted role wording),
  and `Adame, Alejandro` whose assignment segment reads
  `Bogota 10, D.C., IL Viatorian Province Center-Clerics of St. Viator`
  (kept as a parish descriptor with city/state null rather than
  asserting a false city).
- **All-caps "cities" skipped.** A `City, ST` match whose city token
  is fully uppercase is treated as a region code, not a place
  (e.g. `SAR` in `Kowloon, SAR, NE`).
- **Alphabetical-order check.** 351 adjacent surname inversions
  remain; inspected samples are source ordering quirks (multi-word
  Spanish surnames such as `Acevedo Lugo` before `Acevedo`, and
  `Jr.`/`III` suffixed surnames), not split errors.
- **No ratings.** This file contains directory profiles only. No
  rating, review, or freshness information was added or inferred.

## What did not verify

- The brief's 41,653 figure could not be reconciled exactly; the
  83-record difference (+0.2%) is reported honestly above rather than
  adjusted to match. Possible contributors: repeated entries for the
  same person that the brief's count may have merged, and a handful of
  ambiguous wrapped-header lines in either direction.
- A small number of individual parish/city assignments may still be
  wrong where the source text itself is compressed or ambiguous
  (see the Adame example). Spot checks at the start, middle, and end
  of the file matched the source.
