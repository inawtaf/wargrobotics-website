// Run: npm test   (Node 20+, no dependencies)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, createHash, webcrypto } from 'node:crypto';

// Cloudflare Workers always have Web Crypto as a global. Node only does from
// v20 on, so provide it here for older Node (the site code itself is unchanged).
if (!globalThis.crypto) globalThis.crypto = webcrypto;

import { quoteCart, unitPrice } from '../src/pricing.js';
import { PRODUCTS } from '../src/config.js';
import { validateAddress, validateItems, validateRegistration, passwordProblem } from '../src/validate.js';
import { hashPassword, verifyPassword, burnPasswordCheck } from '../src/auth.js';
import { safeNext, _test as g } from '../src/google.js';
import { verifyCheckoutSignature, verifyWebhookSignature } from '../src/razorpay.js';
import { newOrderNumber, orderToken, safeEqual, inr } from '../src/util.js';
import { confirmationEmail, dispatchEmail } from '../src/email.js';

const good = {
  name: 'Asha Rao', phone: '98450 12345',
  address_line1: '12, 3rd Cross, Indiranagar', city: 'Bengaluru', state_code: 'KA', pincode: '560038',
};
const quote = ({ sku, quantity, unitsSoldAtOffer, buyerState, sellerState }) =>
  quoteCart({ items: [{ sku, quantity }], soldAtOffer: { [sku]: unitsSoldAtOffer }, buyerState, sellerState });

test('offer price while units remain, list price once they run out', () => {
  const g = PRODUCTS.ghost;
  assert.equal(unitPrice(g, 0, 1).unitPricePaise, 19_999_00);
  assert.equal(unitPrice(g, 99, 1).priceType, 'offer');
  assert.equal(unitPrice(g, 100, 1).priceType, 'list');
  assert.equal(unitPrice(g, 98, 3).unitPricePaise, 24_999_00, 'order that does not fit the offer pays list');
});

test('GST 18% on top; CGST+SGST in Karnataka, IGST elsewhere', () => {
  const ka = quote({ sku: 'ghost', quantity: 1, unitsSoldAtOffer: 0, buyerState: 'KA', sellerState: 'KA' });
  assert.equal(ka.summary, 'Warg Ghost × 1');
  assert.equal(ka.subtotalPaise, 1_999_900);
  assert.equal(ka.gstPaise, 359_982);
  assert.equal(ka.totalPaise, 2_359_882);           // ₹23,598.82
  assert.equal(ka.taxKind, 'intra');
  assert.deepEqual(ka.taxLines.map(l => l.paise), [179_991, 179_991]);

  const mh = quote({ sku: 'greywind', quantity: 2, unitsSoldAtOffer: 0, buyerState: 'MH', sellerState: 'KA' });
  assert.equal(mh.subtotalPaise, 4_999_800);
  assert.equal(mh.gstPaise, 899_964);
  assert.equal(mh.taxKind, 'inter');
  assert.equal(mh.taxLines.length, 1);
  assert.equal(mh.totalPaise, 5_899_764);
});

test('tax lines always add up to the GST total (odd paise)', () => {
  for (const sku of Object.keys(PRODUCTS)) for (let q = 1; q <= 9; q++) {
    const r = quote({ sku, quantity: q, unitsSoldAtOffer: 0, buyerState: 'KA', sellerState: 'KA' });
    assert.equal(r.taxLines.reduce((s, l) => s + l.paise, 0), r.gstPaise);
  }
});

test('cart: mixed products, per-line offer, totals add up', () => {
  const q = quoteCart({ items: [{ sku: 'ghost', quantity: 1 }, { sku: 'greywind', quantity: 2 }], soldAtOffer: { greywind: 99 }, buyerState: 'MH', sellerState: 'KA' });
  assert.equal(q.lines[0].priceType, 'offer');
  assert.equal(q.lines[1].priceType, 'list', 'only 1 Greywind offer unit left, line of 2 pays list');
  assert.equal(q.subtotalPaise, 1_999_900 + 2 * 2_999_900);
  assert.equal(q.gstPaise, q.lines.reduce((s, l) => s + l.gstPaise, 0));
  assert.equal(q.totalPaise, q.subtotalPaise + q.gstPaise);
  assert.equal(q.itemCount, 3);
  assert.equal(q.summary, 'Warg Ghost × 1, Warg Greywind × 2');
  assert.throws(() => quoteCart({ items: [] }));
});

test('cart items: merged, unknown products refused, 9-unit cap', () => {
  assert.deepEqual(validateItems([{ sku: 'ghost', quantity: 2 }, { sku: 'GHOST', quantity: 1 }]).value, [{ sku: 'ghost', quantity: 3 }]);
  assert.equal(validateItems([{ sku: 'raven', quantity: 1 }]).ok, false);
  assert.equal(validateItems([{ sku: 'ghost', quantity: 5 }, { sku: 'greywind', quantity: 5 }]).ok, false);
  assert.equal(validateItems([]).ok, false);
});

test('address validation accepts a normal address and normalises the phone', () => {
  const v = validateAddress(good);
  assert.ok(v.ok, JSON.stringify(v.errors));
  assert.equal(v.value.phone, '+919845012345');
  assert.equal(v.value.gstin, null);
});

test('address validation rejects bad input with a message per field', () => {
  const v = validateAddress({ phone: '12345', state_code: 'XX', pincode: '012345' });
  assert.equal(v.ok, false);
  for (const f of ['name', 'phone', 'address_line1', 'city', 'state_code', 'pincode']) assert.ok(v.errors[f], `expected an error for ${f}`);
});

test('registration and password rules', () => {
  assert.ok(validateRegistration({ name: 'Asha', email: 'A@B.co', password: 'correct horse battery' }).ok);
  const bad = validateRegistration({ name: '', email: 'x', password: 'short' });
  assert.ok(bad.errors.name && bad.errors.email && bad.errors.password);
  assert.match(passwordProblem('password123'), /easy/);
  assert.match(passwordProblem('aaaaaaaaaaaa'), /easy/);
  assert.match(passwordProblem('asha@example.com', 'asha@example.com'), /email/);
  assert.equal(passwordProblem('a long enough phrase'), null);
});

test('password hashing: verifies, rejects wrong password, salts, honours pepper', async () => {
  const env = { AUTH_PEPPER: 'pepper' };
  const h1 = await hashPassword(env, 'correct horse battery');
  const h2 = await hashPassword(env, 'correct horse battery');
  assert.match(h1, /^pbkdf2-sha256\$100000\$1\$/);
  assert.notEqual(h1, h2, 'random salt');
  assert.equal(await verifyPassword(env, 'correct horse battery', h1), true);
  assert.equal(await verifyPassword(env, 'correct horse batterY', h1), false);
  assert.equal(await verifyPassword({ AUTH_PEPPER: 'other' }, 'correct horse battery', h1), false, 'pepper is required');
  assert.equal(await burnPasswordCheck(env, 'anything'), false);
});

test('Google: redirects stay on our site; ID token payload decodes', async () => {
  assert.equal(safeNext('/checkout'), '/checkout');
  assert.equal(safeNext('//evil.com'), '/account');
  assert.equal(safeNext('https://evil.com'), '/account');
  assert.equal(safeNext('/\\evil.com'), '/account');
  const payload = Buffer.from(JSON.stringify({ sub: '1', name: 'Āsha' })).toString('base64url');
  assert.deepEqual(g.decodeJwtPayload(`x.${payload}.y`), { sub: '1', name: 'Āsha' });
  // PKCE S256 = base64url(SHA-256(verifier)), checked against Node's crypto
  const verifier = 'test-verifier-0123456789-abcdefghijklmnopqrstuvwxyz';
  assert.equal(await g.pkceChallenge(verifier), createHash('sha256').update(verifier).digest('base64url'));
});

test('GSTIN must be well-formed, match the state, and come with a business name', () => {
  assert.equal(validateAddress({ ...good, gstin: '29ABCDE1234F1Z5' }).errors.business_name !== undefined, true);
  assert.ok(validateAddress({ ...good, gstin: '29ABCDE1234F1Z5', business_name: 'Rao Drones' }).ok);
  assert.match(validateAddress({ ...good, gstin: '27ABCDE1234F1Z5', business_name: 'X' }).errors.gstin, /outside Karnataka/);
  assert.ok(validateAddress({ ...good, gstin: 'ABC', business_name: 'X' }).errors.gstin);
});

test('control characters and long strings are cleaned', () => {
  const v = validateAddress({ ...good, name: 'Asha\u0000\nRao' + 'x'.repeat(500) });
  assert.ok(v.ok);
  assert.ok(!/[\u0000\n]/.test(v.value.name));
  assert.ok(v.value.name.length <= 100);
});

test('Razorpay checkout signature: accepts the real one, rejects tampering', async () => {
  const env = { RAZORPAY_KEY_SECRET: 'test_secret' };
  const sig = createHmac('sha256', 'test_secret').update('order_ABC|pay_XYZ').digest('hex');
  assert.equal(await verifyCheckoutSignature(env, { orderId: 'order_ABC', paymentId: 'pay_XYZ', signature: sig }), true);
  assert.equal(await verifyCheckoutSignature(env, { orderId: 'order_ABC', paymentId: 'pay_OTHER', signature: sig }), false);
  assert.equal(await verifyCheckoutSignature(env, { orderId: 'order_ABC', paymentId: 'pay_XYZ', signature: '' }), false);
});

test('Razorpay webhook signature over the raw body', async () => {
  const env = { RAZORPAY_WEBHOOK_SECRET: 'whsec' };
  const body = '{"event":"payment.captured"}';
  const sig = createHmac('sha256', 'whsec').update(body).digest('hex');
  assert.equal(await verifyWebhookSignature(env, body, sig), true);
  assert.equal(await verifyWebhookSignature(env, body + ' ', sig), false);
  assert.equal(await verifyWebhookSignature({}, body, sig), false, 'no secret configured = reject');
});

test('order numbers look right and order links cannot be guessed', async () => {
  const n = newOrderNumber(new Date('2026-10-26T10:00:00Z'));
  assert.match(n, /^WR-261026-[A-HJ-NP-Z2-9]{4}$/);
  const env = { ORDER_LINK_SECRET: 's3cret' };
  const t1 = await orderToken(env, 'WR-261026-AAAA');
  assert.equal(t1.length, 32);
  assert.equal(t1, await orderToken(env, 'WR-261026-AAAA'), 'stable for the same order');
  assert.notEqual(t1, await orderToken(env, 'WR-261026-AAAB'));
  assert.notEqual(t1, await orderToken({ ORDER_LINK_SECRET: 'other' }, 'WR-261026-AAAA'));
  assert.equal(safeEqual('abc', 'abc'), true);
  assert.equal(safeEqual('abc', 'abd'), false);
});

test('emails render the order, escape buyer text and include the order link', () => {
  const o = {
    order_number: 'WR-261026-AAAA', link_token: 'tok', customer_name: 'Asha <b>Rao</b>', summary: 'Warg Ghost × 1',
    items: [{ product_name: 'Warg Ghost', quantity: 1, subtotal_paise: 1_999_900, price_type: 'offer' }], subtotal_paise: 1_999_900, gst_paise: 359_982, total_paise: 2_359_882, tax_kind: 'intra',
    address_line1: '12 Road', city: 'Bengaluru', state_code: 'KA', pincode: '560038', phone: '+919845012345',
    invoice_number: 'INV-000001', courier: 'Delhivery', tracking_number: 'DL123', tracking_url: 'https://track.example/DL123',
  };
  const c = confirmationEmail({ SITE_URL: 'https://wargrobotics.com' }, o, { hasInvoice: true });
  assert.match(c.subject, /WR-261026-AAAA/);
  assert.match(c.html, /₹23,598\.82/);
  assert.match(c.html, /CGST 9%/);
  assert.ok(!c.html.includes('<b>Rao</b>'), 'buyer-supplied HTML is escaped');
  assert.match(c.html, /order\?n=WR-261026-AAAA&amp;t=tok|order\?n=WR-261026-AAAA&t=tok/);
  const d = dispatchEmail({}, o);
  assert.match(d.html, /DL123/);
  assert.match(d.text, /48 hours/);
  assert.equal(inr(2_359_882), '₹23,598.82');
});
