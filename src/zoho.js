// Zoho Books (India data centre): GST invoices for paid orders.
//
// Setup is in BACKEND.md. In short: a Self Client in the Zoho API console gives
// a client id, secret and refresh token; items "Warg Ghost" and "Warg Greywind"
// are created in Zoho Books with their HSN code, so the HSN lives in Zoho where
// your CA can maintain it.

import { nowSec } from './util.js';
import { STATE_BY_CODE } from './config.js';
import { billingOf, placeOfSupply } from './billing.js';

const apiBase = env => env.ZOHO_API_BASE || 'https://www.zohoapis.in/books/v3';
const accountsBase = env => env.ZOHO_ACCOUNTS_BASE || 'https://accounts.zoho.in';

// Access tokens last an hour and Zoho allows only 10 per 10 minutes, so cache
// the token in D1 rather than minting one per request.
async function accessToken(env) {
  const row = await env.DB.prepare('SELECT value, expires_at FROM kv WHERE key = ?').bind('zoho_token').first();
  if (row && row.expires_at > nowSec() + 120) return row.value;

  const params = new URLSearchParams({
    refresh_token: env.ZOHO_REFRESH_TOKEN,
    client_id: env.ZOHO_CLIENT_ID,
    client_secret: env.ZOHO_CLIENT_SECRET,
    grant_type: 'refresh_token',
  });
  const res = await fetch(`${accountsBase(env)}/oauth/v2/token?${params}`, { method: 'POST' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) throw new Error(`Zoho token refresh failed: ${data.error || res.status}`);

  const expires = nowSec() + (Number(data.expires_in) || 3600);
  await env.DB.prepare(
    'INSERT INTO kv (key, value, expires_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at'
  ).bind('zoho_token', data.access_token, expires).run();
  return data.access_token;
}

async function call(env, method, path, { body, query = {}, raw = false } = {}) {
  const q = new URLSearchParams({ organization_id: env.ZOHO_ORG_ID, ...query });
  const res = await fetch(`${apiBase(env)}${path}?${q}`, {
    method,
    headers: {
      authorization: `Zoho-oauthtoken ${await accessToken(env)}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (raw) {
    if (!res.ok) throw new Error(`Zoho ${method} ${path}: HTTP ${res.status}`);
    return res;
  }
  const data = await res.json().catch(() => ({}));
  // Zoho returns code 0 on success, even inside a 200/201.
  if (!res.ok || (data.code !== undefined && data.code !== 0)) {
    throw new Error(`Zoho ${method} ${path}: ${data.message || `HTTP ${res.status}`}`);
  }
  return data;
}

const zohoAddress = (a, attention) => ({
  attention: attention || a.name,
  address: a.address_line1,
  street2: a.address_line2 || '',
  city: a.city,
  state: STATE_BY_CODE[a.state_code]?.name || a.state_code,
  zip: a.pincode,
  country: 'India',
  phone: a.phone || '',
});

// Reuse a customer by email (and GSTIN, for business invoices) so repeat buyers
// don't get duplicate contacts. The contact's billing and shipping addresses are
// set to this order's before the invoice is made, because Zoho copies them from
// the contact onto the invoice.
async function findOrCreateContact(env, order) {
  const bill = billingOf(order);
  const isBusiness = Boolean(order.gstin);
  const billing_address = zohoAddress(bill, isBusiness ? order.business_name : bill.name);
  const shipping_address = zohoAddress({ ...order, name: order.customer_name });

  const found = await call(env, 'GET', '/contacts', { query: { email: order.email, contact_type: 'customer' } });
  const sameEmail = (found.contacts || []).filter(c => (c.email || '').toLowerCase() === order.email);
  const existing = sameEmail.find(c => (c.gst_no || '').toUpperCase() === (order.gstin || '')) || (!isBusiness && sameEmail.find(c => !c.gst_no));
  if (existing) {
    await call(env, 'PUT', `/contacts/${existing.contact_id}`, { body: { contact_name: existing.contact_name, billing_address, shipping_address } });
    return existing.contact_id;
  }

  const [first, ...rest] = bill.name.split(' ');
  const body = {
    contact_name: isBusiness ? order.business_name : bill.name,
    company_name: isBusiness ? order.business_name : '',
    contact_type: 'customer',
    gst_treatment: isBusiness ? 'business_gst' : 'consumer',
    ...(isBusiness ? { gst_no: order.gstin } : {}),
    place_of_contact: placeOfSupply(order),
    billing_address,
    shipping_address,
    contact_persons: [{ first_name: first, last_name: rest.join(' '), email: order.email, phone: order.phone, is_primary_contact: true }],
  };
  try {
    return (await call(env, 'POST', '/contacts', { body })).contact.contact_id;
  } catch (e) {
    // Contact names are unique in Zoho: a second "Rahul Sharma" needs telling apart.
    if (!/already exists/i.test(e.message)) throw e;
    return (await call(env, 'POST', '/contacts', { body: { ...body, contact_name: `${body.contact_name} (${order.email})` } })).contact.contact_id;
  }
}

// Creates the invoice, marks it sent and records the Razorpay payment against it.
// Returns { contactId, invoiceId, invoiceNumber }.
export async function createPaidInvoice(env, order) {
  for (const it of order.items) if (!env[it.zohoItemVar]) throw new Error(`${it.zohoItemVar} is not set`);
  const taxId = order.tax_kind === 'intra' ? env.ZOHO_TAX_ID_INTRA : env.ZOHO_TAX_ID_INTER;
  if (!taxId) throw new Error(`ZOHO_TAX_ID_${order.tax_kind.toUpperCase()} is not set`);

  const contactId = order.zoho_contact_id || (await findOrCreateContact(env, order));
  const today = (order.paid_at || new Date().toISOString()).slice(0, 10);

  let invoiceId = order.zoho_invoice_id;
  let invoiceNumber = order.invoice_number;
  let invoiceTotal = order.total_paise / 100;

  if (!invoiceId) {
    // Guard against a duplicate if an earlier run created the invoice but
    // failed before saving its id: look it up by our order number first.
    const prior = await call(env, 'GET', '/invoices', { query: { reference_number: order.order_number } });
    const match = prior.invoices?.find(i => i.reference_number === order.order_number);
    if (match) {
      invoiceId = match.invoice_id;
      invoiceNumber = match.invoice_number;
      invoiceTotal = Number(match.total);
      if (match.status !== 'paid') await settleInvoice(env, order, contactId, invoiceId, invoiceTotal, today, match.status);
    } else {
      const inv = await call(env, 'POST', '/invoices', {
        body: {
          customer_id: contactId,
          reference_number: order.order_number,
          date: today,
          place_of_supply: placeOfSupply(order),
          gst_treatment: order.gstin ? 'business_gst' : 'consumer',
          ...(order.gstin ? { gst_no: order.gstin } : {}),
          is_inclusive_tax: false,
          line_items: order.items.map(it => ({
            item_id: env[it.zohoItemVar],
            quantity: it.quantity,
            rate: it.unit_price_paise / 100,
            tax_id: taxId,
            ...(it.price_type === 'offer' ? { description: 'Offer price' } : {}),
          })),
          notes: `Paid online via Razorpay (payment ${order.razorpay_payment_id}).`,
        },
      });
      invoiceId = inv.invoice.invoice_id;
      invoiceNumber = inv.invoice.invoice_number;
      invoiceTotal = Number(inv.invoice.total);
      await settleInvoice(env, order, contactId, invoiceId, invoiceTotal, today, 'draft');
    }
  }
  return { contactId, invoiceId, invoiceNumber, invoiceTotal };
}

// Draft -> sent, then record the Razorpay payment so the invoice shows as paid.
async function settleInvoice(env, order, contactId, invoiceId, invoiceTotal, date, status) {
  if (status === 'draft') await call(env, 'POST', `/invoices/${invoiceId}/status/sent`);
  const paid = order.total_paise / 100;
  if (Math.abs(invoiceTotal - paid) > 1) {
    // Prices or tax set up differently in Zoho than here. Record what was paid
    // (any excess sits as customer credit) and flag it for a human.
    console.warn(`Zoho total ${invoiceTotal} differs from paid ${paid} on ${order.order_number}`);
  }
  await call(env, 'POST', '/customerpayments', {
    body: {
      customer_id: contactId,
      // Razorpay settles to your bank, so 'Bank Transfer' is accurate. Use any
      // payment mode that exists in your Zoho Books (Settings > Payment modes).
      payment_mode: env.ZOHO_PAYMENT_MODE || 'Bank Transfer',
      amount: paid,
      date,
      reference_number: order.razorpay_payment_id,
      description: `Order ${order.order_number}`,
      invoices: [{ invoice_id: invoiceId, amount_applied: Math.min(invoiceTotal, paid) }],
      ...(env.ZOHO_DEPOSIT_ACCOUNT_ID ? { account_id: env.ZOHO_DEPOSIT_ACCOUNT_ID } : {}),
    },
  });
}

export async function invoicePdf(env, invoiceId) {
  const res = await call(env, 'GET', `/invoices/${invoiceId}`, { query: { accept: 'pdf' }, raw: true });
  return new Uint8Array(await res.arrayBuffer());
}

// Setup check: token refresh, organisation, and the configured tax and item ids.
export async function check(env) {
  const out = [];
  const taxes = (await call(env, 'GET', '/settings/taxes')).taxes || [];
  const taxIds = new Set(taxes.map(t => String(t.tax_id)));
  for (const k of ['ZOHO_TAX_ID_INTRA', 'ZOHO_TAX_ID_INTER']) {
    out.push({ name: k, ok: taxIds.has(String(env[k] || '').trim()), detail: taxIds.has(String(env[k] || '').trim()) ? 'found in Zoho' : 'not found among this organisation\'s taxes (run scripts/zoho-setup.mjs ids)' });
  }
  const items = (await call(env, 'GET', '/items')).items || [];
  const itemIds = new Set(items.map(i => String(i.item_id)));
  for (const k of ['ZOHO_ITEM_ID_GHOST', 'ZOHO_ITEM_ID_GREYWIND']) {
    out.push({ name: k, ok: itemIds.has(String(env[k] || '').trim()), detail: itemIds.has(String(env[k] || '').trim()) ? 'found in Zoho' : 'not found among this organisation\'s items' });
  }
  return out;
}
