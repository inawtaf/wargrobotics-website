// The Worker sets up its own database tables.
//
// On the first request after each deploy it checks which migrations in
// migrations/ have run, and applies any missing ones. Each migration runs
// as one transaction together with its record, so a half-applied migration
// can't happen, and two requests racing each other can't both apply it.
//
// Migrations are recorded in the same `d1_migrations` table, in the same
// format, as `wrangler d1 migrations apply`, so the two are interchangeable:
// you can still run `npm run db:migrate` and it will see what's done.
//
// To change the database later: add migrations/0003_….sql AND list it below.

import m0001 from '../migrations/0001_orders.sql';
import m0002 from '../migrations/0002_accounts.sql';
import m0003 from '../migrations/0003_billing.sql';
import m0004 from '../migrations/0004_address_dedupe.sql';

export const MIGRATIONS = [
  { name: '0001_orders.sql', sql: m0001 },
  { name: '0002_accounts.sql', sql: m0002 },
  { name: '0003_billing.sql', sql: m0003 },
  { name: '0004_address_dedupe.sql', sql: m0004 },
];

// Same table definition wrangler uses.
const TRACKING = `CREATE TABLE IF NOT EXISTS d1_migrations(
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT UNIQUE,
  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
)`;

// Strip "-- comments" (outside quotes), then split on ";" into statements.
export function splitSql(sql) {
  let out = '', inStr = false;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    if (inStr) { out += c; if (c === "'") inStr = false; continue; }
    if (c === "'") { inStr = true; out += c; continue; }
    if (c === '-' && sql[i + 1] === '-') { while (i < sql.length && sql[i] !== '\n') i++; out += '\n'; continue; }
    out += c;
  }
  return out.split(';').map(s => s.trim()).filter(Boolean);
}

async function apply(env) {
  await env.DB.prepare(TRACKING).run();
  const { results } = await env.DB.prepare('SELECT name FROM d1_migrations').all();
  const done = new Set(results.map(r => r.name));
  const applied = [];
  for (const m of MIGRATIONS) {
    if (done.has(m.name)) continue;
    const statements = splitSql(m.sql).map(s => env.DB.prepare(s));
    statements.push(env.DB.prepare('INSERT INTO d1_migrations (name) VALUES (?)').bind(m.name));
    try {
      await env.DB.batch(statements);          // all-or-nothing
      applied.push(m.name);
    } catch (e) {
      // Another request may have just applied it; if so, that's fine.
      const now = await env.DB.prepare('SELECT 1 FROM d1_migrations WHERE name = ?').bind(m.name).first();
      if (!now) throw new Error(`Database setup failed on ${m.name}: ${e.message}`);
    }
  }
  if (applied.length) console.log('Database migrations applied:', applied.join(', '));
}

// Once per Worker instance; retried on the next request if it failed.
let ready = null;
export function ensureSchema(env) {
  if (!ready) ready = apply(env).catch(e => { ready = null; throw e; });
  return ready;
}
