// End-to-end test against `wrangler dev` + test/mock-services.mjs.
// See BACKEND.md "Testing locally". Usage: node test/e2e.mjs http://127.0.0.1:8787 http://127.0.0.1:8899
import { createHmac } from 'node:crypto';
import assert from 'node:assert/strict';

const SITE = process.argv[2] || 'http://127.0.0.1:8787';
const MOCK = process.argv[3] || 'http://127.0.0.1:8899';
const KEY_SECRET = 'rzp_test_secret', WEBHOOK_SECRET = 'whsec_test', ADMIN = 'admin-token-for-local-testing-only';

const call = async (method, path, body, headers = {}) => {
  const r = await fetch(SITE + path, { method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)) });
  const text = await r.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: r.status, data };
};
const admin = (m, p, b) => call(m, '/api/admin' + p, b, { authorization: 'Bearer ' + ADMIN });
const mockCalls = async () => (await fetch(MOCK + '/__calls')).json();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const hmac = (secret, msg) => createHmac('sha256', secret).update(msg).digest('hex');
let passed = 0;
const step = async (name, fn) => { await fn(); passed++; console.log('ok', passed, '-', name); };

const buyer = {
  sku: 'ghost', quantity: 1, name: 'Asha Rao', email: 'asha@example.com', phone: '9845012345',
  address_line1: '12, 3rd Cross, Indiranagar', city: 'Bengaluru', state_code: 'KA', pincode: '560038',
};

let o1;
await step('products list prices, offer units and states', async () => {
  const r = await call('GET', '/api/products');
  assert.equal(r.status, 200);
  assert.equal(r.data.products.length, 2);
  assert.equal(r.data.products[0].offer_units_left, 100);
  assert.equal(r.data.razorpay_key_id, 'rzp_test_local');
  assert.ok(r.data.states.find(s => s.code === 'KA'));
});

await step('quote: Greywind x2 to Maharashtra is IGST', async () => {
  const r = await call('POST', '/api/quote', { sku: 'greywind', quantity: 2, state_code: 'MH' });
  assert.equal(r.data.quote.taxKind, 'inter');
  assert.equal(r.data.quote.totalPaise, 5_899_764);
});

await step('bad order is rejected field by field, nothing saved', async () => {
  const r = await call('POST', '/api/orders', { ...buyer, phone: '123', pincode: 'abc' });
  assert.equal(r.status, 422);
  assert.ok(r.data.fields.phone && r.data.fields.pincode);
});

await step('price cannot be set by the browser', async () => {
  const r = await call('POST', '/api/orders', { ...buyer, amount_paise: 100, unit_price_paise: 1 });
  assert.equal(r.status, 201);
  assert.equal(r.data.amount_paise, 2_359_882);
  o1 = r.data;
});

await step('order page needs the right token', async () => {
  assert.equal((await call('GET', `/api/orders/${o1.order_number}?t=wrong`)).status, 404);
  const r = await call('GET', `/api/orders/${o1.order_number}?t=${o1.token}`);
  assert.equal(r.status, 200);
  assert.equal(r.data.order.status, 'created');
  assert.equal(r.data.order.email, undefined, 'no email on the public view');
});

await step('forged checkout signature is refused', async () => {
  const r = await call('POST', `/api/orders/${o1.order_number}/confirm`, {
    token: o1.token, razorpay_order_id: o1.razorpay_order_id, razorpay_payment_id: 'pay_x__' + o1.razorpay_order_id, razorpay_signature: 'deadbeef',
  });
  assert.equal(r.status, 400);
});

const payId1 = 'pay_A__' + o1.razorpay_order_id;
await step('valid checkout confirm marks the order paid', async () => {
  const r = await call('POST', `/api/orders/${o1.order_number}/confirm`, {
    token: o1.token, razorpay_order_id: o1.razorpay_order_id, razorpay_payment_id: payId1,
    razorpay_signature: hmac(KEY_SECRET, `${o1.razorpay_order_id}|${payId1}`),
  });
  assert.equal(r.data.status, 'paid');
});

await step('invoice created in Zoho, confirmation with PDF + team email sent', async () => {
  let o;
  for (let i = 0; i < 20; i++) { o = (await admin('GET', `/orders/${o1.order_number}`)).data.order; if (o.confirmation_sent_at && o.team_notified_at) break; await sleep(300); }
  assert.equal(o.status, 'paid');
  assert.equal(o.invoice_number, 'INV-000001');
  assert.ok(o.invoice_sent_at, 'invoice went with the confirmation');
  const calls = await mockCalls();
  const inv = calls.find(c => c.path === '/zoho/invoices' && c.method === 'POST');
  assert.equal(inv.body.place_of_supply, 'KA');
  assert.equal(inv.body.line_items[0].tax_id, 'tax_intra');
  assert.equal(inv.body.line_items[0].item_id, 'item_ghost');
  assert.equal(inv.body.line_items[0].rate, 19999);
  assert.equal(inv.query.organization_id, 'org_1');
  const pay = calls.find(c => c.path === '/zoho/customerpayments');
  assert.equal(pay.body.amount, 23598.82);
  assert.equal(pay.body.reference_number, payId1);
  const mails = calls.filter(c => c.path === '/resend/emails');
  const conf = mails.find(m => m.headers.idem === `${o1.order_number}-confirmation`);
  assert.deepEqual(conf.body.to, ['asha@example.com']);
  assert.equal(conf.body.attachments[0].filename, 'INV-000001.pdf');
  assert.match(conf.body.html, new RegExp(`t=${o1.token}`));
  assert.ok(mails.find(m => m.headers.idem === `${o1.order_number}-team`));
});

await step('repeat webhooks do not create a second invoice or email', async () => {
  const evt = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: payId1, order_id: o1.razorpay_order_id, amount: 2_359_882, status: 'captured' } } } });
  for (let i = 0; i < 2; i++) {
    const r = await call('POST', '/api/webhooks/razorpay', evt, { 'x-razorpay-signature': hmac(WEBHOOK_SECRET, evt) });
    assert.equal(r.status, 200);
  }
  await sleep(500);
  const calls = await mockCalls();
  assert.equal(calls.filter(c => c.path === '/zoho/invoices' && c.method === 'POST').length, 1);
  assert.equal(calls.filter(c => c.path === '/resend/emails').length, 2);
});

await step('webhook with a bad signature is rejected', async () => {
  const r = await call('POST', '/api/webhooks/razorpay', '{"event":"payment.captured"}', { 'x-razorpay-signature': 'nope' });
  assert.equal(r.status, 401);
});

await step('admin endpoints need the token', async () => {
  assert.equal((await call('GET', '/api/admin/orders')).status, 401);
  assert.equal((await call('GET', '/api/admin/orders', undefined, { authorization: 'Bearer wrong' })).status, 401);
  const r = await admin('GET', '/orders');
  assert.equal(r.status, 200);
  assert.ok(r.data.orders.length >= 1);
});

await step('ship: status changes and the buyer gets tracking + delivery instructions', async () => {
  const r = await admin('POST', `/orders/${o1.order_number}/ship`, { courier: 'Delhivery', tracking_number: 'DL123456', tracking_url: 'https://www.delhivery.com/track/package/DL123456' });
  assert.equal(r.data.status, 'shipped');
  const mail = (await mockCalls()).find(c => c.headers.idem === `${o1.order_number}-dispatch-DL123456`);
  assert.match(mail.body.html, /DL123456/);
  assert.match(mail.body.html, /48 hours/);
  const pub = await call('GET', `/api/orders/${o1.order_number}?t=${o1.token}`);
  assert.equal(pub.data.order.tracking_number, 'DL123456');
});

let o2;
await step('Zoho down: buyer still gets a confirmation, invoice error recorded', async () => {
  await fetch(MOCK + '/__fail-zoho?on=1');
  o2 = (await call('POST', '/api/orders', { ...buyer, sku: 'greywind', state_code: 'MH', city: 'Pune', pincode: '411001', gstin: '27ABCDE1234F1Z5', business_name: 'Rao Drones LLP' })).data;
  const pid = 'pay_B__' + o2.razorpay_order_id;
  const evt = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: pid, order_id: o2.razorpay_order_id, amount: o2.amount_paise, status: 'captured' } } } });
  await call('POST', '/api/webhooks/razorpay', evt, { 'x-razorpay-signature': hmac(WEBHOOK_SECRET, evt) });
  let o;
  for (let i = 0; i < 20; i++) { o = (await admin('GET', `/orders/${o2.order_number}`)).data.order; if (o.confirmation_sent_at) break; await sleep(300); }
  assert.equal(o.status, 'paid');
  assert.equal(o.invoice_number, null);
  assert.match(o.invoice_error, /Simulated Zoho outage/);
  assert.ok(o.confirmation_sent_at);
  assert.equal(o.invoice_sent_at, null);
});

await step('cron retry creates the invoice later and emails it on its own', async () => {
  await fetch(MOCK + '/__fail-zoho?on=0');
  const r = await fetch(SITE + '/__scheduled?cron=*/15+*+*+*+*');
  assert.equal(r.status, 200);
  let o;
  for (let i = 0; i < 20; i++) { o = (await admin('GET', `/orders/${o2.order_number}`)).data.order; if (o.invoice_sent_at) break; await sleep(300); }
  assert.equal(o.invoice_number, 'INV-000002');
  assert.ok(o.invoice_sent_at);
  const calls = await mockCalls();
  const inv = calls.filter(c => c.path === '/zoho/invoices' && c.method === 'POST').pop();
  assert.equal(inv.body.gst_treatment, 'business_gst');
  assert.equal(inv.body.gst_no, '27ABCDE1234F1Z5');
  assert.equal(inv.body.line_items[0].tax_id, 'tax_inter');
  const contact = calls.filter(c => c.path === '/zoho/contacts' && c.method === 'POST').pop();
  assert.equal(contact.body.contact_name, 'Rao Drones LLP');
  assert.ok(calls.find(c => c.headers.idem === `${o2.order_number}-invoice`), 'separate invoice email');
});

await step('offer counter counts paid units only', async () => {
  const r = await call('GET', '/api/products');
  assert.equal(r.data.products.find(p => p.sku === 'ghost').offer_units_left, 99);
  assert.equal(r.data.products.find(p => p.sku === 'greywind').offer_units_left, 99);
});

await step('static site still served; backend source is not', async () => {
  assert.equal((await fetch(SITE + '/checkout')).status, 200);
  assert.equal((await fetch(SITE + '/order')).status, 200);
  for (const p of ['/src/worker.js', '/migrations/0001_orders.sql', '/wrangler.jsonc', '/.dev.vars', '/package.json']) {
    assert.equal((await fetch(SITE + p)).status, 404, p);
  }
});

console.log(`\nall ${passed} end-to-end checks passed`);
