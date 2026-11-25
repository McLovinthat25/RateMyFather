# RateMyFather

Anonymous, opinion-based ratings of Catholic priests: pace of play (speed only),
homily performance, and likability. Built fresh for deployment. No ratings are
invented and no reviews are seeded.

## Stack

- Node.js + Express (no build step), `pg` for PostgreSQL.
- Plain HTML/CSS/JS served by Express (server-rendered pages plus a JSON chatbot API).
- Entry point: `server.js` at the repo root. `npm start` runs `node server.js`.
  `npm run seed` runs `node scripts/seed.js`.

## Environment variables

- `DATABASE_URL` (required): Postgres connection string.
- `OWNER_SECRET` (required for moderation; no default, never hardcoded): the owner
  moderation secret. If unset, owner sign-in is disabled and every moderation
  route refuses access.
- `PORT` (default 3000).

## Local development

```sh
npm install
# create the database and apply the schema (also applied automatically on boot)
psql "$DATABASE_URL" -f migrations/001_init.sql
npm start
```

Owner sign-in: visit `/owner/login` and enter `OWNER_SECRET`. The secret is stored
in a signed httpOnly session cookie (HMAC-SHA256 over an expiry payload) and
compared with a timing-safe comparison.

## Seeding

```sh
npm run seed
```

`scripts/seed.js` reads `seed/priests.json` only (an array of objects with keys
`name, parish, city, state, diocese_code, ordination_year`; nulls tolerated) and
inserts them as directory profiles with source `directory_2017` and
`user_added` false. It seeds **zero reviews**. If `seed/priests.json` is missing,
it exits with a clear message saying the parser output is not present yet.
`seed/sample-priests.json` holds clearly synthetic test-only entries and is
**never** loaded by the seed script by default.

## How screening works (server side, `lib/screening.js`)

- Reviews containing phone numbers or email addresses (regex) are refused outright.
- Text matching the documented allegation keyword list (misconduct, crimes,
  improper behavior) is force-held with an abuse flag and never auto-approved.
- Star-only and clearly clean, short written reviews may auto-approve; anything
  borderline (long text or borderline wording) waits in the moderation queue.
- A repeat review of the same priest from the same source is refused outright.
  Source identity is a SHA-256 hash of IP plus user agent; only the hash is stored.
- After 5 reviews in an hour from one source, further reviews are refused.
- At 10+ reviews of one priest in 24 hours, further reviews of that priest are
  force-held and flagged as a spike.
- Confirmation copy is honest per path: a held review is not public and counts
  toward nothing; an auto-approved review passed screening and can still be removed.

## How moderation is enforced (server side, `server.js`)

- Every `/owner/*` route (queue, audit list, approve/reject/delete, resolve)
  passes `requireOwner` before touching data. Non-owners get 403.
- The owner session cookie is signed with `OWNER_SECRET`; the login comparison
  is timing-safe.
- Delete controls render only on the owner queue page. There is no public delete
  button. Public report/correction/legal forms only flag the queue.
- The owner can remove user-added profiles but **never** directory profiles:
  the delete route refuses any priest with `user_added` false (403).

## Search notes

- Region-first browsing: Northeast / Midwest / South / West plus "Other listings"
  for territories and non-state entries, with live profile counts.
- ZIP search is area-level only: a 5-digit ZIP resolves via its 3-digit prefix
  (`lib/regions.js` prefix table) to a city/state area, labelled as area-level.
  Exact-ZIP matching applies only to user-added profiles carrying that ZIP.
- Category filters (Quick Mass, Great homily, Lovable priest) show rated priests
  only, sorted by that category average highest first, tie-broken by review count,
  with counts always shown. Single-review listings carry a caveat.
- Unrated profiles say "Not rated yet" with no stars, no zeros, no score boxes.
- Every average carries its review count everywhere (cards, profiles, filters,
  chatbot). The chatbot uses site data only, reports aggregated approved scores
  with counts, never quotes individual reviews or repeats allegations, and says
  plainly when a priest has no reviews. Assignments are phrased as historical
  listings ("Listed at ...").
