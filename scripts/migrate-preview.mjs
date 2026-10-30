#!/usr/bin/env node
// Applies the database migrations to the PREVIEW database.
//
// `wrangler d1 migrations apply` only looks at the top-level d1_databases in
// wrangler.jsonc, not the "previews" block, so it can't find the preview
// database by name. This script reads the preview database from the
// "previews" block, writes a throwaway config for just that database, and runs
// the same wrangler command against it.
//
// Usage:  npm run db:migrate:preview          (remote, the real preview DB)
//         npm run db:migrate:preview -- --local

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Remove // and /* */ comments and trailing commas, leaving strings alone
// (so "https://..." survives).
function parseJsonc(text) {
  let out = '', inStr = false, i = 0;
  while (i < text.length) {
    const c = text[i], n = text[i + 1];
    if (inStr) {
      out += c;
      if (c === '\\') { out += n ?? ''; i += 2; continue; }
      if (c === '"') inStr = false;
      i++; continue;
    }
    if (c === '"') { inStr = true; out += c; i++; continue; }
    if (c === '/' && n === '/') { while (i < text.length && text[i] !== '\n') i++; continue; }
    if (c === '/' && n === '*') { i += 2; while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++; i += 2; continue; }
    out += c; i++;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

const cfg = parseJsonc(readFileSync(resolve(root, 'wrangler.jsonc'), 'utf8'));
const db = cfg.previews?.d1_databases?.[0];
if (!db?.database_id || /REPLACE/.test(db.database_id)) {
  console.error('Put the preview database ID in wrangler.jsonc, under "previews" -> "d1_databases" -> "database_id", first.');
  process.exit(1);
}

const tmpDir = resolve(root, '.wrangler');
mkdirSync(tmpDir, { recursive: true });
const tmp = resolve(tmpDir, 'preview-db.wrangler.json');
writeFileSync(tmp, JSON.stringify({
  name: `${cfg.name}-preview-db`,
  compatibility_date: cfg.compatibility_date,
  ...(cfg.account_id ? { account_id: cfg.account_id } : {}),
  d1_databases: [{ ...db, migrations_dir: resolve(root, db.migrations_dir || 'migrations') }],
}, null, 2));

const where = process.argv.includes('--local') ? '--local' : '--remote';
console.log(`Applying migrations to ${db.database_name} (${db.database_id}) ${where}`);
const r = spawnSync('npx', ['wrangler', 'd1', 'migrations', 'apply', db.database_name, where, '--config', tmp, ...process.argv.slice(2).filter(a => a !== '--local')],
  { stdio: 'inherit', cwd: root, shell: process.platform === 'win32' });
process.exit(r.status ?? 1);
