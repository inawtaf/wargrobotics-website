#!/usr/bin/env node
// Zoho Books setup helper. Two jobs:
//
// 1) Turn a Self Client "grant code" into a refresh token:
//      node scripts/zoho-setup.mjs token <client_id> <client_secret> <grant_code>
//
// 2) List your organisation id, GST tax ids and item ids for wrangler.jsonc:
//      node scripts/zoho-setup.mjs ids <client_id> <client_secret> <refresh_token>
//
// India data centre (zoho.in). Nothing is stored; output goes to your terminal.

const ACCOUNTS = 'https://accounts.zoho.in';
const API = 'https://www.zohoapis.in/books/v3';
const [cmd, clientId, clientSecret, third] = process.argv.slice(2);

const die = msg => { console.error(msg); process.exit(1); };
if (!['token', 'ids'].includes(cmd) || !clientId || !clientSecret || !third) {
  die('Usage:\n  node scripts/zoho-setup.mjs token <client_id> <client_secret> <grant_code>\n  node scripts/zoho-setup.mjs ids   <client_id> <client_secret> <refresh_token>');
}

async function token(params) {
  const res = await fetch(`${ACCOUNTS}/oauth/v2/token?${new URLSearchParams({ client_id: clientId, client_secret: clientSecret, ...params })}`, { method: 'POST' });
  const data = await res.json();
  if (data.error) die(`Zoho said: ${data.error}`);
  return data;
}

if (cmd === 'token') {
  const t = await token({ code: third, grant_type: 'authorization_code' });
  if (!t.refresh_token) die('No refresh token returned. Generate a fresh grant code (they expire in minutes) and try again.');
  console.log('\nZOHO_REFRESH_TOKEN =', t.refresh_token, '\n\nSave it as a secret (see BACKEND.md). It does not expire unless revoked.');
  process.exit(0);
}

const { access_token } = await token({ refresh_token: third, grant_type: 'refresh_token' });
const get = async (path, org) => {
  const res = await fetch(`${API}${path}${org ? `${path.includes('?') ? '&' : '?'}organization_id=${org}` : ''}`, { headers: { authorization: `Zoho-oauthtoken ${access_token}` } });
  const data = await res.json();
  if (data.code !== 0) die(`Zoho ${path}: ${data.message}`);
  return data;
};

const { organizations } = await get('/organizations');
for (const o of organizations) {
  console.log(`\nOrganisation: ${o.name}\n  ZOHO_ORG_ID = ${o.organization_id}`);
  const { taxes } = await get('/settings/taxes', o.organization_id);
  console.log('\n  Taxes (use the 18% ones):');
  for (const t of taxes) console.log(`    ${t.tax_id}  ${t.tax_name}  ${t.tax_percentage}%  ${t.tax_type || ''}${t.tax_specification ? '  (' + t.tax_specification + ')' : ''}`);
  console.log('    -> ZOHO_TAX_ID_INTRA = the GST18 tax group (CGST 9% + SGST 9%)');
  console.log('    -> ZOHO_TAX_ID_INTER = IGST18');
  const { items } = await get('/items', o.organization_id);
  console.log('\n  Items:');
  for (const i of items) console.log(`    ${i.item_id}  ${i.name}  rate ${i.rate}  HSN ${i.hsn_or_sac || '(none)'}`);
  console.log('    -> ZOHO_ITEM_ID_GHOST / ZOHO_ITEM_ID_GREYWIND');
}
