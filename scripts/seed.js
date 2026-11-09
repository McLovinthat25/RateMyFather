// Seeds directory profiles from seed/priests.json ONLY.
// Reads <repo>/seed/priests.json: an array of objects with keys
//   name, parish, city, state, diocese_code, ordination_year (nulls tolerated).
// Inserts them with source 'directory_2017' and user_added false.
// Seeds ZERO reviews. If seed/priests.json is missing, exits with a clear message
// saying the parser output is not present yet. sample-priests.json is NEVER loaded
// by default; it exists only for local testing (see README).

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

async function main() {
  const seedPath = path.join(__dirname, '..', 'seed', 'priests.json');
  if (!fs.existsSync(seedPath)) {
    console.error('Seed data not present: seed/priests.json is missing.');
    console.error('The parser output is not present yet. Place the parser output at seed/priests.json and re-run.');
    process.exit(1);
  }
  let rows;
  try {
    rows = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
  } catch (e) {
    console.error('seed/priests.json could not be parsed as JSON:', e.message);
    process.exit(1);
  }
  if (!Array.isArray(rows)) {
    console.error('seed/priests.json must contain a JSON array of priest objects.');
    process.exit(1);
  }
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS priests (
      id SERIAL PRIMARY KEY, name TEXT NOT NULL, parish TEXT, city TEXT, state TEXT,
      diocese_code TEXT, ordination_year INTEGER, source TEXT NOT NULL DEFAULT 'directory_2017',
      user_added BOOLEAN NOT NULL DEFAULT FALSE, zip TEXT,
      status TEXT NOT NULL DEFAULT 'approved', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    let inserted = 0;
    for (const r of rows) {
      if (!r || !r.name) continue;
      await client.query(
        `INSERT INTO priests (name, parish, city, state, diocese_code, ordination_year, source, user_added, status)
         VALUES ($1,$2,$3,$4,$5,$6,'directory_2017',false,'approved')`,
        [r.name, r.parish || null, r.city || null, r.state || null, r.diocese_code || null,
         r.ordination_year == null ? null : Number(r.ordination_year) || null]);
      inserted += 1;
    }
    console.log(`Seeded ${inserted} directory profiles (source directory_2017, 0 reviews).`);
  } finally {
    await client.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
