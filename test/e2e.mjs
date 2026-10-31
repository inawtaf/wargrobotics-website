// End-to-end test against `wrangler dev` + test/mock-services.mjs.
// See BACKEND.md "Testing locally". Usage: node test/e2e.mjs [site] [mock]
import { createHmac } from 'node:crypto';
import assert from 'node:assert/strict';

const SITE = process.argv[2] || 'http://127.0.0.1:8787';
const MOCK = process.argv[3] || 'http://127.0.0.1:8899';
const KEY_SECRET = 'rzp_test_secret', WEBHOOK_SECRET = 'whsec_test', ADMIN = 'admin-token-for-local-testing-only';
const GOOGLE_CLIENT = 'google-client.apps.googleusercontent.com';

// A "browser": keeps cookies, sends our Origin on writes like a real page would.
class Browser {
  constructor() { this.jar = {}; }
  cookieHeader() { return Object.entries(this.jar).map(([k, v]) => `${k}=${v}`).join('; '); }
  keep(res) {
    for (const c of res.headers.getSetCookie?.() || []) {
      const [pair, ...attrs] = c.split(';');
      const i = pair.indexOf('='); const k = pair.slice(0, i).trim(); const v = pair.slice(i + 1).trim();
      if (attrs.some(a => /max-age=0/i.test(a)) || v === '') delete this.jar[k]; else this.jar[k] = v;
    }
  }
  async raw(method, path, body, headers = {}) {
    const h = { cookie: this.cookieHeader(), ...headers };
    if (body !== undefined) h['content-type'] = 'application/json';
    if (method !== 'GET' && !('origin' in headers)) h.origin = SITE;
    const res = await fetch(SITE + path, { method, headers: h, body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)), redirect: 'manual' });
    this.keep(res);
    return res;
  }
  async call(method, path, body, headers) {
    const res = await this.raw(method, path, body, headers);
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data, headers: res.headers };
  }
}

const anon = new Browser();
const admin = (m, p, b) => anon.call(m, '/api/admin' + p, b, { authorization: 'Bearer ' + ADMIN });
const mockCalls = async () => (await fetch(MOCK + '/__calls')).json();
const emailsTo = async to => (await mockCalls()).filter(c => c.path === '/resend/emails' && c.body.to.includes(to));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const hmac = (secret, msg) => createHmac('sha256', secret).update(msg).digest('hex');
const linkToken = (html, re) => decodeURIComponent(html.match(re)[1].replace(/&amp;/g, '&'));
let passed = 0;
const step = async (name, fn) => { await fn(); passed++; console.log('ok', passed, '-', name); };

// Google sign-in, driven the way a browser would: start -> (Google) -> callback.
async function googleSignIn(b, claims, next = '/account', mode) {
  const start = await b.raw('GET', `/api/auth/google?next=${encodeURIComponent(next)}${mode ? '&mode=' + mode : ''}`);
  assert.equal(start.status, 302);
  const loc = new URL(start.headers.get('location'));
  assert.equal(loc.searchParams.get('code_challenge_method'), 'S256');
  const nonce = loc.searchParams.get('nonce'), state = loc.searchParams.get('state');
  const code = Buffer.from(JSON.stringify({ iss: 'https://accounts.google.com', aud: GOOGLE_CLIENT, exp: Math.floor(Date.now() / 1000) + 300, nonce, email_verified: true, ...claims })).toString('base64url');
  return b.raw('GET', `/api/auth/google/callback?code=${code}&state=${state}`);
}

const asha = new Browser();
// The seller is in Goa (SELLER_STATE=GA): a Goa address is CGST+SGST, anywhere else IGST.
const ADDR = { name: 'Asha Rao', phone: '9845012345', address_line1: '4, Rua de Ourem, Fontainhas', city: 'Panaji', state_code: 'GA', pincode: '403001' };
const KA_ADDR = { name: 'Asha Rao', phone: '9845012345', address_line1: '12, 3rd Cross, Indiranagar', city: 'Bengaluru', state_code: 'KA', pincode: '560038' };
let order1;

// ------------------------------------------------------------------ public
await step('products and cart quotes are public', async () => {
  const p = await anon.call('GET', '/api/products');
  assert.equal(p.data.products.length, 2);
  assert.equal(p.data.google_enabled, true);
  const q = await anon.call('POST', '/api/quote', { items: [{ sku: 'ghost', quantity: 1 }, { sku: 'greywind', quantity: 2 }], state_code: 'MH' });
  assert.equal(q.data.quote.taxKind, 'inter');
  assert.equal(q.data.quote.totalPaise, Math.round((1_999_900 + 4_999_800) * 1.18));
});

await step('writes from another site are refused (CSRF)', async () => {
  const r = await anon.call('POST', '/api/auth/login', { email: 'a@b.co', password: 'x' }, { origin: 'https://evil.example' });
  assert.equal(r.status, 403);
  const r2 = await anon.call('POST', '/api/auth/login', { email: 'a@b.co', password: 'x' }, { origin: '' });
  assert.equal(r2.status, 403, 'no Origin header');
});

await step('account pages need sign-in', async () => {
  assert.equal((await anon.call('GET', '/api/cart')).status, 401);
  assert.equal((await anon.call('GET', '/api/account/orders')).status, 401);
  assert.equal((await anon.call('POST', '/api/orders', {})).status, 401);
  assert.deepEqual((await anon.call('GET', '/api/me')).data, { user: null });
});

// ------------------------------------------------------------------ register + verify
await step('register: field errors, weak password refused', async () => {
  const r = await asha.call('POST', '/api/auth/register', { name: '', email: 'nope', password: 'password123' });
  assert.equal(r.status, 422);
  assert.ok(r.data.fields.name && r.data.fields.email && r.data.fields.password);
});

await step('register signs in, unverified, and sends a confirmation link', async () => {
  const r = await asha.call('POST', '/api/auth/register', { name: 'Asha Rao', email: 'Asha@Example.com', password: 'correct horse battery' });
  assert.equal(r.status, 200);
  assert.ok(asha.jar.wr_session, 'session cookie set');
  const setCookie = r.headers.get('set-cookie');
  assert.match(setCookie, /HttpOnly/); assert.match(setCookie, /Secure/); assert.match(setCookie, /SameSite=Lax/);
  const me = (await asha.call('GET', '/api/me')).data.user;
  assert.equal(me.email, 'asha@example.com');
  assert.equal(me.email_verified, false);
  assert.ok((await emailsTo('asha@example.com')).find(m => /Confirm your email/.test(m.body.subject)));
});

await step('same email cannot register twice', async () => {
  const r = await new Browser().call('POST', '/api/auth/register', { name: 'Xavier', email: 'asha@example.com', password: 'another long one' });
  assert.equal(r.status, 409);
});

await step('cart: add, merge, cap at 9 units, replace', async () => {
  await asha.call('POST', '/api/cart/add', { sku: 'ghost', quantity: 1 });
  let c = await asha.call('POST', '/api/cart/add', { items: [{ sku: 'greywind', quantity: 2 }] });
  assert.deepEqual(c.data.items, [{ sku: 'ghost', quantity: 1 }, { sku: 'greywind', quantity: 2 }]);
  c = await asha.call('POST', '/api/cart/add', { sku: 'ghost', quantity: 9 });
  assert.equal(c.data.trimmed, true);
  assert.equal(c.data.items.reduce((s, i) => s + i.quantity, 0), 9);
  c = await asha.call('PUT', '/api/cart', { items: [{ sku: 'ghost', quantity: 1 }, { sku: 'greywind', quantity: 2 }] });
  assert.equal(c.data.quote.itemCount, 3);
  assert.equal((await asha.call('GET', '/api/me')).data.cart_count, 3);
});

await step('checkout refused until the email is confirmed', async () => {
  const r = await asha.call('POST', '/api/orders', { address: ADDR });
  assert.equal(r.status, 403);
  assert.equal(r.data.code, 'unverified');
});

await step('confirmation link verifies the email (once)', async () => {
  const mail = (await emailsTo('asha@example.com')).find(m => /Confirm your email/.test(m.body.subject));
  const token = linkToken(mail.body.html, /verify\?token=([^"&]+)/);
  const r = await anon.raw('GET', `/api/auth/verify?token=${encodeURIComponent(token)}`);
  assert.equal(r.status, 302);
  assert.match(r.headers.get('location'), /verify=done/);
  assert.equal((await asha.call('GET', '/api/me')).data.user.email_verified, true);
  const again = await anon.raw('GET', `/api/auth/verify?token=${encodeURIComponent(token)}`);
  assert.match(again.headers.get('location'), /verify=expired/);
});

// ------------------------------------------------------------------ sign in / out
await step('sign out, wrong password refused, sign back in', async () => {
  await asha.call('POST', '/api/auth/logout');
  assert.equal(asha.jar.wr_session, undefined);
  assert.equal((await asha.call('GET', '/api/me')).data.user, null);
  const bad = await asha.call('POST', '/api/auth/login', { email: 'asha@example.com', password: 'wrong password here' });
  assert.equal(bad.status, 401);
  assert.equal(bad.data.error, 'Email or password is incorrect.');
  const unknown = await anon.call('POST', '/api/auth/login', { email: 'nobody@example.com', password: 'wrong password here' });
  assert.equal(unknown.data.error, bad.data.error, 'same message for unknown email');
  const ok = await asha.call('POST', '/api/auth/login', { email: 'ASHA@example.com', password: 'correct horse battery' });
  assert.equal(ok.status, 200);
  assert.equal((await asha.call('GET', '/api/me')).data.cart_count, 3, 'cart kept in the account');
});

await step('repeated wrong passwords are throttled', async () => {
  const b = new Browser();
  await b.call('POST', '/api/auth/register', { name: 'Throttle Test', email: 'throttle@example.com', password: 'correct horse battery' });
  let last;
  for (let i = 0; i < 11; i++) last = await anon.call('POST', '/api/auth/login', { email: 'throttle@example.com', password: 'nope nope nope' });
  assert.equal(last.status, 429);
});

// ------------------------------------------------------------------ checkout
await step('checkout: bad address refused with field errors', async () => {
  const r = await asha.call('POST', '/api/orders', { address: { ...ADDR, pincode: 'abc', phone: '1' } });
  assert.equal(r.status, 422);
  assert.ok(r.data.fields.pincode && r.data.fields.phone);
});

await step('checkout: order from the cart, price set by the server, address saved', async () => {
  const r = await asha.call('POST', '/api/orders', { address: ADDR, save_address: true, amount_paise: 100 });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.amount_paise, Math.round((1_999_900 + 4_999_800) * 1.18));
  assert.equal(r.data.quote.taxKind, 'intra');
  order1 = r.data;
  const a = await asha.call('GET', '/api/account/addresses');
  assert.equal(a.data.addresses.length, 1);
  assert.equal(a.data.addresses[0].is_default, 1);
});

await step('payment confirmed: paid, cart emptied, one invoice with two lines', async () => {
  const pid = 'pay_A__' + order1.razorpay_order_id;
  const forged = await asha.call('POST', `/api/orders/${order1.order_number}/confirm`, { razorpay_order_id: order1.razorpay_order_id, razorpay_payment_id: pid, razorpay_signature: 'beef' });
  assert.equal(forged.status, 400);
  const r = await asha.call('POST', `/api/orders/${order1.order_number}/confirm`, {
    razorpay_order_id: order1.razorpay_order_id, razorpay_payment_id: pid, razorpay_signature: hmac(KEY_SECRET, `${order1.razorpay_order_id}|${pid}`),
  });
  assert.equal(r.data.status, 'paid');
  let o;
  for (let i = 0; i < 20; i++) { o = (await admin('GET', `/orders/${order1.order_number}`)).data.order; if (o.confirmation_sent_at && o.team_notified_at) break; await sleep(300); }
  assert.equal(o.invoice_number, 'INV-000001');
  assert.equal(o.items.length, 2);
  assert.equal((await asha.call('GET', '/api/cart')).data.items.length, 0);
  const calls = await mockCalls();
  const inv = calls.find(c => c.path === '/zoho/invoices' && c.method === 'POST');
  assert.deepEqual(inv.body.line_items.map(l => [l.item_id, l.quantity, l.rate, l.tax_id]), [['item_ghost', 1, 19999, 'tax_intra'], ['item_greywind', 2, 24999, 'tax_intra']]);
  const conf = calls.find(c => c.headers.idem === `${order1.order_number}-confirmation`);
  assert.match(conf.body.html, /Warg Ghost × 1/);
  assert.match(conf.body.html, /Warg Greywind × 2/);
  assert.equal(conf.body.attachments[0].filename, 'INV-000001.pdf');
});

await step('account: order list, detail, invoice download, reorder', async () => {
  const list = await asha.call('GET', '/api/account/orders');
  assert.equal(list.data.orders.length, 1);
  assert.equal(list.data.orders[0].summary, 'Warg Ghost × 1, Warg Greywind × 2');
  const d = await asha.call('GET', `/api/account/orders/${order1.order_number}`);
  assert.equal(d.data.order.items.length, 2);
  assert.equal(d.data.order.invoice_available, true);
  const pdf = await asha.raw('GET', `/api/account/orders/${order1.order_number}/invoice`);
  assert.equal(pdf.headers.get('content-type'), 'application/pdf');
  assert.match(pdf.headers.get('content-disposition'), /INV-000001\.pdf/);
  const re = await asha.call('POST', `/api/account/orders/${order1.order_number}/reorder`);
  assert.equal(re.data.ok, true);
  assert.equal((await asha.call('GET', '/api/cart')).data.items.length, 2);
});

await step('order link from email works without sign-in but hides the address', async () => {
  const r = await anon.call('GET', `/api/orders/${order1.order_number}?t=${order1.token}`);
  assert.equal(r.status, 200);
  assert.equal(r.data.order.items.length, 2);
  assert.equal(r.data.order.address_line1, undefined);
  assert.equal(r.data.order.phone, undefined);
  assert.equal((await anon.call('GET', `/api/orders/${order1.order_number}?t=wrong`)).status, 404);
});

// ------------------------------------------------------------------ Google
const ravi = new Browser();
await step('Google sign-in creates a verified account and returns to the page', async () => {
  const r = await googleSignIn(ravi, { sub: 'g-ravi', email: 'Ravi@Example.com', name: 'Ravi Kumar' }, '/checkout');
  assert.equal(r.status, 302);
  assert.equal(new URL(r.headers.get('location')).pathname, '/checkout');
  const me = (await ravi.call('GET', '/api/me')).data.user;
  assert.equal(me.email, 'ravi@example.com');
  assert.equal(me.email_verified, true);
  assert.equal(me.google_linked, true);
  assert.equal(me.has_password, false);
});

await step('Google sign-in rejects a tampered state or wrong audience', async () => {
  const b = new Browser();
  const start = await b.raw('GET', '/api/auth/google');
  const nonce = new URL(start.headers.get('location')).searchParams.get('nonce');
  const code = Buffer.from(JSON.stringify({ iss: 'https://accounts.google.com', aud: GOOGLE_CLIENT, exp: 9e9, nonce, email: 'x@y.co', email_verified: true, sub: 'z' })).toString('base64url');
  const bad = await b.raw('GET', `/api/auth/google/callback?code=${code}&state=forged`);
  assert.match(bad.headers.get('location'), /\/login\?error=/);
  const r = await googleSignIn(new Browser(), { sub: 'evil', email: 'e@e.co', aud: 'someone-else' });
  assert.match(r.headers.get('location'), /\/login\?error=.*audience/);
});

await step('other people cannot see or pay your order', async () => {
  assert.equal((await ravi.call('GET', `/api/account/orders/${order1.order_number}`)).status, 404);
  assert.equal((await ravi.raw('GET', `/api/account/orders/${order1.order_number}/invoice`)).status, 404);
  assert.equal((await ravi.call('POST', `/api/account/orders/${order1.order_number}/reorder`)).status, 404);
  assert.equal((await ravi.call('POST', `/api/orders/${order1.order_number}/confirm`, {})).status, 404);
  assert.equal((await ravi.call('GET', '/api/account/addresses')).data.addresses.length, 0);
});

await step('Google takes over an unverified look-alike account safely', async () => {
  // Someone registers meera@example.com without owning it…
  const squatter = new Browser();
  await squatter.call('POST', '/api/auth/register', { name: 'Squatter', email: 'meera@example.com', password: 'squatter password 1' });
  // …then the real Meera signs in with Google.
  const meera = new Browser();
  await googleSignIn(meera, { sub: 'g-meera', email: 'meera@example.com', name: 'Meera' });
  const me = (await meera.call('GET', '/api/me')).data.user;
  assert.equal(me.email_verified, true);
  assert.equal(me.has_password, false, "squatter's password removed");
  assert.equal((await squatter.call('GET', '/api/me')).data.user, null, "squatter's session ended");
  const login = await anon.call('POST', '/api/auth/login', { email: 'meera@example.com', password: 'squatter password 1' });
  assert.equal(login.status, 401);
});

await step('Google-only account: set a password, then unlink Google', async () => {
  assert.equal((await ravi.call('POST', '/api/account/google/unlink')).status, 409, 'not without a password');
  assert.equal((await ravi.call('POST', '/api/account/password', { new_password: 'ravi long password' })).status, 200);
  assert.equal((await ravi.call('POST', '/api/account/google/unlink')).status, 200);
  assert.equal((await ravi.call('GET', '/api/me')).data.user.google_linked, false);
  // Link it back from the profile page.
  const r = await googleSignIn(ravi, { sub: 'g-ravi', email: 'ravi@example.com', name: 'Ravi Kumar' }, '/account', 'link');
  assert.match(r.headers.get('location'), /google=linked/);
});

// ------------------------------------------------------------------ password reset / change
await step('forgot password: same answer for unknown emails', async () => {
  const a = await anon.call('POST', '/api/auth/forgot', { email: 'asha@example.com' });
  const b = await anon.call('POST', '/api/auth/forgot', { email: 'nobody@example.com' });
  assert.equal(a.data.message, b.data.message);
});

await step('reset: weak password refused (link still valid), good one signs in and ends other sessions', async () => {
  const mail = (await emailsTo('asha@example.com')).filter(m => /Reset your password/.test(m.body.subject)).pop();
  const token = linkToken(mail.body.html, /reset\?token=([^"&]+)/);
  const other = new Browser();
  const weak = await other.call('POST', '/api/auth/reset', { token, password: 'short' });
  assert.equal(weak.status, 422);
  const ok = await other.call('POST', '/api/auth/reset', { token, password: 'brand new passphrase' });
  assert.equal(ok.status, 200);
  assert.ok(other.jar.wr_session);
  assert.equal((await asha.call('GET', '/api/me')).data.user, null, 'old session ended');
  assert.equal((await other.call('POST', '/api/auth/reset', { token, password: 'another passphrase' })).status, 400, 'link is single-use');
  await asha.call('POST', '/api/auth/login', { email: 'asha@example.com', password: 'brand new passphrase' });
  assert.ok((await asha.call('GET', '/api/me')).data.user);
});

await step('change password needs the current one', async () => {
  const bad = await asha.call('POST', '/api/account/password', { current_password: 'nope', new_password: 'yet another passphrase' });
  assert.equal(bad.status, 422);
  assert.ok(bad.data.fields.current_password);
  const ok = await asha.call('POST', '/api/account/password', { current_password: 'brand new passphrase', new_password: 'yet another passphrase' });
  assert.equal(ok.status, 200);
  assert.ok((await asha.call('GET', '/api/me')).data.user, 'this session stays signed in');
});

// ------------------------------------------------------------------ profile, addresses
await step('profile and address book', async () => {
  const p = await asha.call('PATCH', '/api/account/profile', { name: 'Asha R', phone: '98450 12345' });
  assert.equal(p.data.user.phone, '+919845012345');
  const add = await asha.call('POST', '/api/account/addresses', { ...ADDR, label: 'Office', city: 'Pune', state_code: 'MH', pincode: '411001', gstin: '27ABCDE1234F1Z5', business_name: 'Rao Drones LLP', is_default: true });
  assert.equal(add.status, 201);
  let list = (await asha.call('GET', '/api/account/addresses')).data.addresses;
  assert.equal(list.length, 2);
  assert.equal(list[0].label, 'Office');
  assert.equal(list.filter(a => a.is_default).length, 1);
  const home = list.find(a => a.label !== 'Office');
  assert.equal((await asha.call('PUT', `/api/account/addresses/${home.id}`, { ...ADDR, label: 'Home', pincode: '560008' })).data.address.pincode, '560008');
  assert.equal((await ravi.call('DELETE', `/api/account/addresses/${home.id}`)).status, 404, "can't delete someone else's");
});

// ------------------------------------------------------------------ second order: saved business address, Zoho down
let order2;
await step('order to a saved business address; Zoho down -> still confirmed; cron fixes it', async () => {
  await fetch(MOCK + '/__fail-zoho?on=1');
  const office = (await asha.call('GET', '/api/account/addresses')).data.addresses.find(a => a.label === 'Office');
  order2 = (await asha.call('POST', '/api/orders', { address_id: office.id })).data;
  assert.equal(order2.quote.taxKind, 'inter');
  const pid = 'pay_B__' + order2.razorpay_order_id;
  const evt = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: pid, order_id: order2.razorpay_order_id, amount: order2.amount_paise, status: 'captured' } } } });
  for (let i = 0; i < 2; i++) await anon.call('POST', '/api/webhooks/razorpay', evt, { 'x-razorpay-signature': hmac(WEBHOOK_SECRET, evt) });
  let o;
  for (let i = 0; i < 20; i++) { o = (await admin('GET', `/orders/${order2.order_number}`)).data.order; if (o.confirmation_sent_at) break; await sleep(300); }
  assert.equal(o.status, 'paid');
  assert.match(o.invoice_error, /Simulated Zoho outage/);
  await fetch(MOCK + '/__fail-zoho?on=0');
  await fetch(SITE + '/__scheduled?cron=*/15+*+*+*+*');
  for (let i = 0; i < 20; i++) { o = (await admin('GET', `/orders/${order2.order_number}`)).data.order; if (o.invoice_sent_at) break; await sleep(300); }
  assert.equal(o.invoice_number, 'INV-000002');
  const inv = (await mockCalls()).filter(c => c.path === '/zoho/invoices' && c.method === 'POST').pop();
  assert.equal(inv.body.gst_no, '27ABCDE1234F1Z5');
  assert.equal(inv.body.line_items[0].tax_id, 'tax_inter');
  assert.equal((await mockCalls()).filter(c => c.path === '/zoho/invoices' && c.method === 'POST' && c.body.reference_number === order2.order_number).length, 2, 'one failed + one created, not more');
});

// ------------------------------------------------------------------ shipping and service
// ------------------------------------------------------------------ order portal
const staff = new Browser();
const portal = (m, p, b, h) => staff.call(m, '/api/admin' + p, b, h);

await step('portal: only staff accounts (ADMIN_EMAILS, confirmed) get in', async () => {
  assert.equal((await anon.call('GET', '/api/admin/summary')).status, 401);
  assert.equal((await asha.call('GET', '/api/admin/summary')).status, 403, 'a customer is refused');
  await googleSignIn(staff, { sub: 'g-staff', email: 'staff@example.com', name: 'Warg Staff' }, '/admin');
  assert.equal((await staff.call('GET', '/api/me')).data.user.is_staff, true);
  const s = await portal('GET', '/summary');
  assert.equal(s.status, 200);
  assert.equal(s.data.to_process, 2);
  assert.ok(s.data.couriers.includes('Delhivery'));
  const x = await portal('POST', `/orders/${order1.order_number}/note`, { message: 'x' }, { origin: 'https://evil.example' });
  assert.equal(x.status, 403, 'cross-site write refused even for staff');
});

await step('portal: queue filters and search', async () => {
  assert.equal((await portal('GET', '/orders?status=paid')).data.orders.length, 2);
  const found = (await portal('GET', `/orders?status=&q=${encodeURIComponent('Rao Drones')}`)).data.orders;
  assert.deepEqual(found.map(o => o.order_number), [order2.order_number], 'business name is searchable');
  const byEmail = (await portal('GET', '/orders?status=&q=asha%40example')).data.orders;
  assert.equal(byEmail.length, 2);
  assert.equal((await portal('GET', '/orders?status=unpaid')).status, 200);
});

await step('process -> ship -> deliver, each emailed and on the timeline', async () => {
  const n = order1.order_number;
  const bad = await portal('POST', `/orders/${n}/deliver`, {});
  assert.equal(bad.status, 409, 'cannot deliver a paid order');
  let r = await portal('POST', `/orders/${n}/process`, { message: 'Your Greywind is on the test bench.' });
  assert.equal(r.data.status, 'processing'); assert.equal(r.data.emailed, true);
  assert.equal((await portal('POST', `/orders/${n}/process`, {})).status, 409, 'double click is harmless');
  r = await portal('POST', `/orders/${n}/ship`, { courier: 'Delhivery', tracking_number: 'DL123', tracking_url: 'https://www.delhivery.com/track/package/DL123', expected_delivery: '2026-11-03' });
  assert.equal(r.data.status, 'shipped'); assert.equal(r.data.emailed, true);
  assert.equal((await portal('POST', `/orders/${n}/ship`, { courier: 'Delhivery', tracking_number: 'DL1', tracking_url: 'javascript:alert(1)' })).status, 422);
  await portal('POST', `/orders/${n}/note`, { message: 'Packed by Kartik, box B2' });

  const calls = await mockCalls();
  const proc = calls.find(c => c.headers.idem === `${n}-processing`);
  assert.match(proc.body.subject, /preparing/);
  assert.match(proc.body.html, /test bench/);
  const disp = calls.find(c => c.headers.idem === `${n}-dispatch-DL123`);
  assert.match(disp.body.html, /Expected delivery:<\/b> Tue, 3 Nov/);
  assert.match(disp.body.html, /48 hours/);

  const mine = (await asha.call('GET', `/api/account/orders/${n}`)).data.order;
  assert.equal(mine.status, 'shipped');
  assert.equal(mine.expected_delivery, '2026-11-03');
  const msgs = mine.timeline.map(e => e.message).join(' | ');
  assert.match(msgs, /Payment received/);
  assert.match(msgs, /test bench/);
  assert.match(msgs, /Shipped with Delhivery/);
  assert.ok(!/Packed by Kartik/.test(msgs), 'internal notes stay internal');
  assert.ok(!mine.timeline.some(e => 'actor' in e), 'customer view has no staff names');

  const full = (await portal('GET', `/orders/${n}`)).data;
  assert.ok(full.timeline.find(e => e.message === 'Packed by Kartik, box B2' && e.actor === 'staff@example.com'));
  assert.ok(full.timeline.find(e => e.kind === 'email' && /preparing/.test(e.message)));

  r = await portal('POST', `/orders/${n}/deliver`, { notify: true });
  assert.equal(r.data.status, 'delivered');
  assert.ok((await mockCalls()).find(c => c.headers.idem === `${n}-delivered`));
  assert.equal((await asha.call('GET', '/api/account/orders')).data.orders.find(o => o.order_number === n).status, 'delivered');
});

await step('resend an email on request', async () => {
  const before = (await emailsTo('asha@example.com')).length;
  assert.equal((await portal('POST', `/orders/${order1.order_number}/resend`, { which: 'dispatch' })).status, 200);
  assert.equal((await emailsTo('asha@example.com')).length, before + 1);
});

let order3;
await step('cancel a paid order: customer told, refund reminder for staff', async () => {
  await asha.call('POST', '/api/cart/add', { sku: 'ghost', quantity: 1 });
  const home = (await asha.call('GET', '/api/account/addresses')).data.addresses.find(a => a.label === 'Home');
  order3 = (await asha.call('POST', '/api/orders', { address_id: home.id })).data;
  const pid = 'pay_C__' + order3.razorpay_order_id;
  await asha.call('POST', `/api/orders/${order3.order_number}/confirm`, { razorpay_order_id: order3.razorpay_order_id, razorpay_payment_id: pid, razorpay_signature: hmac(KEY_SECRET, `${order3.razorpay_order_id}|${pid}`) });
  assert.equal((await portal('POST', `/orders/${order3.order_number}/cancel`, {})).status, 422, 'reason required');
  const r = await portal('POST', `/orders/${order3.order_number}/cancel`, { reason: 'Out of stock this week, sorry.' });
  assert.equal(r.data.status, 'cancelled'); assert.equal(r.data.refund_needed, true); assert.equal(r.data.emailed, true);
  const mail = (await mockCalls()).find(c => c.headers.idem === `${order3.order_number}-cancelled`);
  assert.match(mail.body.html, /Out of stock/); assert.match(mail.body.html, /refund/);
  const t = (await portal('GET', `/orders/${order3.order_number}`)).data.timeline;
  assert.ok(t.find(e => /Refund still to do/.test(e.message)));
  assert.equal((await portal('POST', `/orders/${order3.order_number}/process`, {})).status, 409);
});

await step('CSV export: one row per order, spreadsheet formulas neutralised', async () => {
  const res = await staff.raw('GET', '/api/admin/orders.csv?status=');
  assert.equal(res.headers.get('content-type'), 'text/csv; charset=utf-8');
  const text = await res.text();
  const lines = text.replace(/^﻿/, '').trim().split('\r\n');
  assert.match(lines[0], /^Order,Status,Paid at,Items/);
  assert.equal(lines.length, 1 + 3);
  assert.ok(lines.some(l => l.includes('Warg Ghost x1; Warg Greywind x2')));
  assert.ok(!lines.some(l => /,=/.test(l)));
  assert.equal((await anon.raw('GET', '/api/admin/orders.csv')).status, 401);
});

await step('service request: created, team and customer emailed, admin update shown in account', async () => {
  const bad = await asha.call('POST', '/api/account/service', { kind: 'repair', subject: 'x', message: 'short', order_number: 'WR-000000-XXXX' });
  assert.equal(bad.status, 422);
  assert.ok(bad.data.fields.subject && bad.data.fields.message && bad.data.fields.order_number);
  const r = await asha.call('POST', '/api/account/service', { kind: 'repair', subject: 'No video after crash', message: 'The feed went black after a crash at the field.', order_number: order1.order_number });
  assert.equal(r.status, 201);
  const sr = r.data.service_request.request_number;
  assert.match(sr, /^SR-\d{6}-/);
  await sleep(500);
  const calls = await mockCalls();
  assert.ok(calls.find(c => c.path === '/resend/emails' && c.body.subject.startsWith(`Service ${sr}`) && c.body.to.includes('team@example.com')));
  assert.ok(calls.find(c => c.path === '/resend/emails' && c.body.subject.includes(`${sr} received`)));
  assert.equal((await ravi.call('GET', '/api/account/service')).data.service_requests.length, 0, 'private to Asha');
  const list = (await admin('GET', '/service')).data.service_requests;
  assert.ok(list.find(s => s.request_number === sr));
  await admin('POST', `/service/${sr}`, { status: 'in_progress', team_note: 'Please send the unit to our Bengaluru address.' });
  const mine = (await asha.call('GET', '/api/account/service')).data.service_requests[0];
  assert.equal(mine.status, 'in_progress');
  assert.match(mine.team_note, /Bengaluru/);
  const detail = await asha.call('GET', `/api/account/orders/${order1.order_number}`);
  assert.equal(detail.data.service_requests[0].request_number, sr);
});

await step('offer counter counts paid units across carts', async () => {
  const p = (await anon.call('GET', '/api/products')).data.products;
  const ghost = p.find(x => x.sku === 'ghost'), grey = p.find(x => x.sku === 'greywind');
  // order 1 and order 2 (the reorder) each had Ghost x1 + Greywind x2
  assert.equal(ghost.offer_units_left, 98);
  assert.equal(grey.offer_units_left, 96);
});

// ------------------------------------------------------------------ billing addresses (31 Oct)
const payByWebhook = async (o, tag) => {
  const pid = `pay_${tag}__` + o.razorpay_order_id;
  const evt = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: pid, order_id: o.razorpay_order_id, amount: o.amount_paise, status: 'captured' } } } });
  await anon.call('POST', '/api/webhooks/razorpay', evt, { 'x-razorpay-signature': hmac(WEBHOOK_SECRET, evt) });
  let row;
  for (let i = 0; i < 20; i++) { row = (await admin('GET', `/orders/${o.order_number}`)).data.order; if (row.confirmation_sent_at && row.zoho_invoice_id) break; await sleep(300); }
  return row;
};
const BILL_MH = { name: 'Accounts, Rao Drones', address_line1: 'Plot 7, MIDC Bhosari', city: 'Pune', state_code: 'MH', pincode: '411026' };

await step('checkout: separate billing address; the GSTIN state is the place of supply', async () => {
  await asha.call('PUT', '/api/cart', { items: [{ sku: 'ghost', quantity: 1 }] });
  const r = await asha.call('POST', '/api/orders', {
    delivery_address: KA_ADDR, save_delivery: false,
    billing_same: false, billing_address: BILL_MH, save_billing: true,
    gstin: '27ABCDE1234F1Z5', business_name: 'Rao Drones LLP',
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.quote.taxKind, 'inter');
  const o = await payByWebhook(r.data, 'BILL');
  assert.equal(o.state_code, 'KA');
  assert.equal(o.billing_state_code, 'MH');
  assert.equal(o.billing_city, 'Pune');
  assert.equal(o.place_of_supply, 'MH');
  assert.equal(o.gstin, '27ABCDE1234F1Z5');
  // Saved: the billing address (with its GSTIN) became the default billing address; delivery wasn't saved.
  const book = (await asha.call('GET', '/api/account/addresses')).data.addresses;
  const pune = book.find(a => a.address_line1 === BILL_MH.address_line1);
  assert.equal(pune.gstin, '27ABCDE1234F1Z5');
  assert.equal(pune.is_default_billing, 1);
  assert.equal(book.filter(a => a.city === 'Bengaluru').length, 0);
  // Zoho: the existing business contact is reused, its bill-to and ship-to updated before the invoice.
  const contacts = await (await fetch(MOCK + '/__contacts')).json();
  const biz = contacts.filter(c => c.gst_no === '27ABCDE1234F1Z5');
  assert.equal(biz.length, 1, 'no duplicate business contact');
  assert.equal(biz[0].billing_address.city, 'Pune');
  assert.equal(biz[0].shipping_address.state, 'Karnataka');
  const inv = (await mockCalls()).filter(c => c.path === '/zoho/invoices' && c.method === 'POST').pop();
  assert.equal(inv.body.place_of_supply, 'MH');
  assert.equal(inv.body.line_items[0].tax_id, 'tax_inter');
  const conf = (await mockCalls()).find(c => c.headers.idem === `${o.order_number}-confirmation`);
  assert.match(conf.body.html, /Billed to/);
  assert.match(conf.body.html, /GSTIN 27ABCDE1234F1Z5/);
  const view = (await asha.call('GET', `/api/account/orders/${o.order_number}`)).data.order;
  assert.equal(view.billing.city, 'Pune');
  assert.equal(view.billing.same, false);
  const link = await anon.call('GET', `/api/orders/${o.order_number}?t=${r.data.token}`);
  assert.equal(link.data.order.billing, undefined, 'emailed link hides the billing address');
  const csv = await (await fetch(SITE + '/api/admin/orders.csv', { headers: { authorization: 'Bearer ' + ADMIN } })).text();
  assert.match(csv.split('\r\n')[0], /Billing address,Billing state,Place of supply/);
});

await step('checkout: GSTIN must belong to the billing state; billing errors are labelled', async () => {
  await asha.call('PUT', '/api/cart', { items: [{ sku: 'ghost', quantity: 1 }] });
  const wrongState = await asha.call('POST', '/api/orders', { delivery_address: ADDR, billing_same: false, billing_address: { ...BILL_MH, city: 'Margao', state_code: 'GA', pincode: '403601' }, gstin: '27ABCDE1234F1Z5', business_name: 'Rao Drones LLP' });
  assert.equal(wrongState.status, 422);
  assert.match(wrongState.data.fields.gstin, /registered in Maharashtra, but the billing address is in Goa/);
  const badBill = await asha.call('POST', '/api/orders', { delivery_address: ADDR, billing_same: false, billing_address: { ...BILL_MH, pincode: 'x' } });
  assert.equal(badBill.status, 422);
  assert.ok(badBill.data.fields.billing_pincode, JSON.stringify(badBill.data));
  // No GSTIN: tax follows the delivery address, wherever the bill goes.
  const consumer = await asha.call('POST', '/api/orders', { delivery_address: ADDR, billing_same: false, billing_address: BILL_MH, gstin: '' });
  assert.equal(consumer.status, 201, JSON.stringify(consumer.data));
  assert.equal(consumer.data.quote.taxKind, 'intra');
  // Same as delivery + GSTIN of the delivery state works as before.
  const same = await asha.call('POST', '/api/orders', { delivery_address: KA_ADDR, billing_same: true, gstin: '29ABCDE1234F1Z5', business_name: 'Rao Drones LLP' });
  assert.equal(same.status, 201, JSON.stringify(same.data));
  assert.equal(same.data.quote.taxKind, 'inter');
  const sameRow = (await admin('GET', `/orders/${same.data.order_number}`)).data.order;
  assert.equal(sameRow.billing_city, 'Bengaluru');
  assert.equal(sameRow.place_of_supply, 'KA');
});

await step('address book: default delivery and default billing are separate', async () => {
  let book = (await asha.call('GET', '/api/account/addresses')).data.addresses;
  const home = book.find(a => a.label === 'Home');
  const deliveryDefault = book.find(a => a.is_default).id;
  assert.equal((await asha.call('POST', `/api/account/addresses/${home.id}/default?for=billing`)).status, 200);
  book = (await asha.call('GET', '/api/account/addresses')).data.addresses;
  assert.deepEqual(book.filter(a => a.is_default_billing).map(a => a.id), [home.id]);
  assert.equal(book.find(a => a.is_default).id, deliveryDefault, 'delivery default untouched');
  const eve = new Browser();
  await eve.call('POST', '/api/auth/register', { name: 'Eve Example', email: 'eve@example.com', password: 'correct horse battery' });
  assert.equal((await eve.call('POST', `/api/account/addresses/${home.id}/default`)).status, 404, "can't touch someone else's address");
  book = (await asha.call('GET', '/api/account/addresses')).data.addresses;
  assert.equal(book.find(a => a.is_default).id, deliveryDefault, "someone else's request didn't clear Asha's default");
});

await step('Zoho: a second customer with the same name gets their own contact', async () => {
  const twin = new Browser();
  await googleSignIn(twin, { sub: 'g-twin', email: 'asha.r@example.org', name: 'Asha Rao' });
  await twin.call('POST', '/api/cart/add', { sku: 'ghost', quantity: 1 });
  const r = await twin.call('POST', '/api/orders', { delivery_address: ADDR });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const o = await payByWebhook(r.data, 'TWIN');
  assert.ok(o.zoho_invoice_id, o.invoice_error);
  const names = (await (await fetch(MOCK + '/__contacts')).json()).map(c => c.contact_name);
  assert.ok(names.includes('Asha Rao'));
  assert.ok(names.includes('Asha Rao (asha.r@example.org)'), names.join(' | '));
});

// ------------------------------------------------------------------ email failures and the setup check (31 Oct)
await step('email failures are reported to the customer, not hidden', async () => {
  await fetch(MOCK + '/__fail-resend?msg=' + encodeURIComponent('The wargrobotics.com domain is not verified.'));
  const b = new Browser();
  const r = await b.call('POST', '/api/auth/register', { name: 'Mail Fail', email: 'mailfail@example.com', password: 'correct horse battery' });
  assert.equal(r.status, 200);
  assert.equal(r.data.verification_sent, false);
  assert.match(r.data.verification_error, /could not send/);
  const again = await b.call('POST', '/api/auth/resend-verification');
  assert.equal(again.status, 502);
  assert.match(again.data.error, /could not send/);
  const t = await admin('POST', '/test-email', { to: 'staff@example.com' });
  assert.equal(t.status, 502);
  assert.match(t.data.error, /domain is not verified/);
  const h = (await admin('GET', '/health')).data;
  assert.equal(h.ok, false);
  const fail = h.sections.email.find(x => x.name === 'Last email failure');
  assert.match(fail.detail, /domain is not verified/);
  await fetch(MOCK + '/__fail-resend');
  const ok = await admin('POST', '/test-email', { to: 'staff@example.com' });
  assert.equal(ok.status, 200);
  assert.ok((await emailsTo('staff@example.com')).find(m => m.body.subject === 'Warg Robotics test email'));
  const sent = await b.call('POST', '/api/auth/resend-verification');
  assert.equal(sent.status, 200);
  assert.equal(sent.data.sent_to, 'mailfail@example.com');
});

await step('setup check: staff only, every service answers, no secret values shown', async () => {
  assert.equal((await asha.call('GET', '/api/admin/health')).status, 403);
  const r = await admin('GET', '/health');
  assert.equal(r.status, 200);
  const h = r.data;
  const bad = Object.values(h.sections).flat().filter(x => x.ok === false);
  assert.equal(h.ok, true, JSON.stringify(bad));
  assert.equal(h.sections.database.length, 3);
  assert.ok(h.sections.google.find(x => x.name === 'Client ID and secret').ok);
  assert.match(h.sections.google.find(x => x.name === 'Redirect URI').detail, /\/api\/auth\/google\/callback/);
  assert.match(h.sections.razorpay[0].detail, /TEST mode/);
  assert.ok(h.sections.zoho.every(x => x.ok));
  assert.equal(h.sections.email[0].ok, true);
  const text = JSON.stringify(h);
  for (const secret of ['rzp_test_secret', 'google-secret', 'local-pepper', 'whsec_test', 'local-order-link-secret', 're_test']) assert.ok(!text.includes(secret), secret);
  // Staff signed in with Google can run it too.
  assert.equal((await portal('GET', '/health')).status, 200);
});

await step('sign out everywhere', async () => {
  const second = new Browser();
  await second.call('POST', '/api/auth/login', { email: 'asha@example.com', password: 'yet another passphrase' });
  await asha.call('POST', '/api/auth/logout-all');
  assert.equal((await second.call('GET', '/api/me')).data.user, null);
});

await step('pages served; backend source and secrets are not', async () => {
  for (const p of ['/login', '/account', '/cart', '/checkout', '/order', '/reset']) assert.equal((await fetch(SITE + p)).status, 200, p);
  for (const p of ['/src/worker.js', '/src/auth.js', '/migrations/0002_accounts.sql', '/wrangler.jsonc', '/.dev.vars', '/.dev.vars.example', '/package.json', '/test/e2e.mjs']) {
    assert.equal((await fetch(SITE + p)).status, 404, p);
  }
});

console.log(`\nall ${passed} end-to-end checks passed`);
