// Setup check for the order portal: is every service connected, and if not,
// what exactly to fix. Shows names and verdicts only, never secret values.

import { json, readJson } from './util.js';
import { validateEmail } from './validate.js';
import * as google from './google.js';
import * as email from './email.js';
import * as razorpay from './razorpay.js';
import * as zoho from './zoho.js';
import { MIGRATIONS } from './schema.js';

const SECRETS = ['RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET', 'ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN',
  'RESEND_API_KEY', 'GOOGLE_CLIENT_SECRET', 'ORDER_LINK_SECRET', 'AUTH_PEPPER'];
const SETTINGS = ['SITE_URL', 'SELLER_STATE', 'RAZORPAY_KEY_ID', 'EMAIL_FROM', 'GOOGLE_CLIENT_ID', 'ADMIN_EMAILS',
  'ZOHO_ORG_ID', 'ZOHO_TAX_ID_INTRA', 'ZOHO_TAX_ID_INTER', 'ZOHO_ITEM_ID_GHOST', 'ZOHO_ITEM_ID_GREYWIND'];

const present = v => typeof v === 'string' && v.trim() !== '' && !/REPLACE/.test(v);
const row = (name, ok, detail) => ({ name, ok, detail });

async function guarded(name, fn) {
  try { return await fn(); } catch (e) { return [row(name, false, e.message)]; }
}

async function readKv(env, key) {
  const r = await env.DB.prepare('SELECT value FROM kv WHERE key = ?').bind(key).first();
  try { return r ? JSON.parse(r.value) : null; } catch { return null; }
}

export async function health(env) {
  const sections = {};

  sections.settings = [
    ...SETTINGS.map(k => row(k, present(env[k]), present(env[k]) ? 'set' : 'missing in wrangler.jsonc (or still REPLACE)')),
    ...SECRETS.map(k => row(k, present(env[k]), present(env[k]) ? 'set' : 'missing: add it as a Secret in the Worker settings')),
  ];
  for (const k of [...SETTINGS, ...SECRETS]) {
    if (present(env[k]) && env[k] !== env[k].trim()) sections.settings.push(row(k, null, 'has a leading or trailing space or line break; the site trims it, but re-paste it to be safe'));
  }

  sections.database = await guarded('Database', async () => {
    const { results } = await env.DB.prepare('SELECT name FROM d1_migrations').all();
    const done = new Set(results.map(r => r.name));
    return MIGRATIONS.map(m => row(m.name, done.has(m.name), done.has(m.name) ? 'applied' : 'not applied yet'));
  });

  sections.google = await guarded('Google', async () => [
    row('Redirect URI', null, `${google.redirectUri(env)} must be listed exactly under "Authorised redirect URIs" on the Google OAuth client.`),
    row('Client ID and secret', ...Object.values(await google.checkCredentials(env))),
  ]);

  sections.email = await guarded('Email', async () => {
    const d = await email.checkDomain(env);
    const lastErr = await readKv(env, 'last_email_error');
    const lastOk = await readKv(env, 'last_email_ok');
    const out = [row('Sending domain', d.ok, d.detail)];
    if (lastOk) out.push(row('Last email sent', true, `${lastOk.at}: ${lastOk.subject}`));
    if (lastErr && (!lastOk || lastErr.at > lastOk.at)) out.push(row('Last email failure', false, `${lastErr.at}: ${lastErr.message}`));
    return out;
  });

  sections.razorpay = await guarded('Razorpay', async () => {
    const mode = /^rzp_live_/.test(env.RAZORPAY_KEY_ID || '') ? 'LIVE' : /^rzp_test_/.test(env.RAZORPAY_KEY_ID || '') ? 'TEST' : 'unknown';
    await razorpay.ping(env);
    return [row('API keys', true, `Key ID and secret accepted (${mode} mode).`),
      row('Webhook secret', present(env.RAZORPAY_WEBHOOK_SECRET), present(env.RAZORPAY_WEBHOOK_SECRET) ? 'set (must match the secret on the Razorpay webhook)' : 'missing')];
  });

  sections.zoho = await guarded('Zoho Books', async () => [row('Connection', true, 'Token refresh and organisation OK.'), ...(await zoho.check(env))]);

  const all = Object.values(sections).flat();
  return json({ ok: all.every(r => r.ok !== false), checked_at: new Date().toISOString(), sections });
}

// POST {to}: sends a test email and reports Resend's exact answer.
export async function testEmail(request, env, actor) {
  const b = await readJson(request);
  const to = validateEmail(b.to) || (actor.includes('@') ? actor : null);
  if (!to) return json({ error: 'Enter an email address to send the test to.' }, 422);
  try {
    const id = await email.sendEmail(env, { to, ...email.testEmail(env) });
    return json({ ok: true, to, id, message: `Sent to ${to}. Resend accepted it (id ${id}). If it doesn't arrive in a minute, check spam, then Resend → Emails.` });
  } catch (e) {
    return json({ ok: false, to, error: e.message }, 502);
  }
}
