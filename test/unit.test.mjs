// Run: npm test   (Node 20+, no dependencies)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, createHash, webcrypto } from 'node:crypto';

// Cloudflare Workers always have Web Crypto as a global. Node only does from
// v20 on, so provide it here for older Node (the site code itself is unchanged).
if (!globalThis.crypto) globalThis.crypto = webcrypto;

import { quoteCart } from '../src/pricing.js';
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
const quote = ({ sku, quantity, buyerState, sellerState, coupon }) =>
  quoteCart({ items: [{ sku, quantity }], buyerState, sellerState, coupon });
// A fixed 'now' inside the coupon's validity, so these tests keep passing after it ends.
const C = (code = 'WARG20', usesLeft = 50) => ({ code, usesLeft, now: Date.parse('2026-11-01T12:00:00+05:30') });

test('list prices: Ghost ₹29,999, Greywind ₹35,999, GST 18% on top', () => {
  const ka = quote({ sku: 'ghost', quantity: 1, buyerState: 'KA', sellerState: 'KA' });
  assert.equal(ka.summary, 'Warg Ghost × 1');
  assert.equal(ka.subtotalPaise, 2_999_900);
  assert.equal(ka.gstPaise, 539_982);
  assert.equal(ka.totalPaise, 3_539_882);           // ₹35,398.82
  assert.equal(ka.taxKind, 'intra');
  assert.deepEqual(ka.taxLines.map(l => l.paise), [269_991, 269_991]);
  assert.equal(ka.discountPaise, 0);
  assert.deepEqual(ka.discounts, []);

  const mh = quote({ sku: 'greywind', quantity: 2, buyerState: 'MH', sellerState: 'KA' });
  assert.equal(mh.subtotalPaise, 7_199_800);
  assert.equal(mh.gstPaise, 1_295_964);
  assert.equal(mh.taxKind, 'inter');
  assert.equal(mh.taxLines.length, 1);
  assert.equal(mh.totalPaise, 8_495_764);
});

test('tax lines always add up to the GST total (odd paise), with and without discounts', () => {
  for (const sku of Object.keys(PRODUCTS)) for (let q = 1; q <= 9; q++) for (const coupon of [undefined, C()]) {
    const r = quote({ sku, quantity: q, buyerState: 'KA', sellerState: 'KA', coupon });
    assert.equal(r.taxLines.reduce((s, l) => s + l.paise, 0), r.gstPaise);
    assert.equal(r.subtotalPaise, r.listSubtotalPaise - r.discountPaise);
    assert.equal(r.totalPaise, r.subtotalPaise + r.gstPaise);
  }
});

test('combo: one Ghost + one Greywind = ₹49,999 before GST, for every pair', () => {
  const one = quoteCart({ items: [{ sku: 'ghost', quantity: 1 }, { sku: 'greywind', quantity: 1 }], buyerState: 'GA', sellerState: 'GA' });
  assert.equal(one.comboPairs, 1);
  assert.equal(one.subtotalPaise, 4_999_900);
  assert.equal(one.comboDiscountPaise, 1_599_900);
  assert.deepEqual(one.discounts.map(d => [d.kind, d.paise]), [['combo', 1_599_900]]);
  // each line carries its own share, in proportion to its price
  assert.equal(one.lines[0].discountPaise + one.lines[1].discountPaise, 1_599_900);
  assert.ok(one.lines[0].discountPaise < one.lines[1].discountPaise);
  const two = quoteCart({ items: [{ sku: 'ghost', quantity: 2 }, { sku: 'greywind', quantity: 3 }], buyerState: 'GA', sellerState: 'GA' });
  assert.equal(two.comboPairs, 2);
  assert.equal(two.subtotalPaise, 2 * 4_999_900 + 3_599_900, 'two combos + one Greywind at list');
  assert.match(two.lines[1].discountLabel, /2 in combo/);
});

test('coupon WARG20: 20% off items outside a combo; never stacked on the combo', () => {
  const g = quote({ sku: 'ghost', quantity: 1, buyerState: 'GA', sellerState: 'GA', coupon: C('warg20') });
  assert.equal(g.coupon.status, 'applied');
  assert.equal(g.couponDiscountPaise, 600_000);
  assert.equal(g.subtotalPaise, 2_399_900);         // ₹23,999: whole rupees
  assert.deepEqual(g.discounts.map(d => d.label), ['Coupon WARG20 (20% off)']);
  const mix = quoteCart({ items: [{ sku: 'ghost', quantity: 2 }, { sku: 'greywind', quantity: 1 }], buyerState: 'GA', sellerState: 'GA', coupon: C() });
  assert.equal(mix.subtotalPaise, 4_999_900 + 2_399_900, 'one combo + the spare Ghost at 20% off');
  assert.equal(mix.lines.find(l => l.sku === 'ghost').discountLabel, '1 in combo, 1 with WARG20 (20% off)');
  const pair = quoteCart({ items: [{ sku: 'ghost', quantity: 1 }, { sku: 'greywind', quantity: 1 }], buyerState: 'GA', sellerState: 'GA', coupon: C() });
  assert.equal(pair.subtotalPaise, 4_999_900, 'combo only');
  assert.equal(pair.coupon.status, 'no_items');
  assert.equal(pair.couponDiscountPaise, 0);
});

test('coupon refused when wrong or used up', () => {
  assert.equal(quote({ sku: 'ghost', quantity: 1, coupon: C('WARG50') }).coupon.status, 'invalid');
  assert.equal(quote({ sku: 'ghost', quantity: 1, coupon: C('WARG50') }).discountPaise, 0);
  const done = quote({ sku: 'ghost', quantity: 1, coupon: C('WARG20', 0) });
  assert.equal(done.coupon.status, 'used_up');
  assert.match(done.coupon.message, /first 100 orders/);
  const late = quote({ sku: 'ghost', quantity: 1, coupon: { code: 'WARG20', usesLeft: 50, now: Date.parse('2026-11-21T00:00:01+05:30') } });
  assert.equal(late.coupon.status, 'used_up');
  assert.match(late.coupon.message, /valid until 20 November 2026/);
  assert.equal(late.discountPaise, 0);
  const lastDay = quote({ sku: 'ghost', quantity: 1, coupon: { code: 'WARG20', usesLeft: 50, now: Date.parse('2026-11-20T23:30:00+05:30') } });
  assert.equal(lastDay.coupon.status, 'applied', 'still valid on the evening of 20 November');
  assert.equal(done.subtotalPaise, 2_999_900);
});

test('cart: mixed products, totals add up', () => {
  const q = quoteCart({ items: [{ sku: 'ghost', quantity: 1 }, { sku: 'greywind', quantity: 2 }], buyerState: 'MH', sellerState: 'KA' });
  assert.equal(q.listSubtotalPaise, 2_999_900 + 2 * 3_599_900);
  assert.equal(q.subtotalPaise, 4_999_900 + 3_599_900);
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
  assert.match(validateAddress({ ...good, gstin: '27ABCDE1234F1Z5', business_name: 'X' }).errors.gstin, /registered in Maharashtra, but the billing address is in Karnataka/);
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

// ------------------------------------------------------------------ 31 Oct: billing, Goa seller, setup fixes
import { checkoutAddresses, validateGst } from '../src/validate.js';
import { billingOf, placeOfSupply } from '../src/billing.js';
import { configured as googleConfigured, redirectUri, clientId } from '../src/google.js';
import { readFileSync, readdirSync } from 'node:fs';

const goa = { name: 'Asha Rao', phone: '+919845012345', address_line1: '4, Rua de Ourem', city: 'Panaji', state_code: 'GA', pincode: '403001' };
const pune = { name: 'Rao Drones', phone: null, address_line1: 'Plot 7, MIDC Bhosari', city: 'Pune', state_code: 'MH', pincode: '411026' };

test('Goa seller: Goa buyer pays CGST+SGST, a Karnataka buyer pays IGST', () => {
  assert.equal(quote({ sku: 'ghost', quantity: 1, buyerState: 'GA', sellerState: 'GA' }).taxKind, 'intra');
  assert.equal(quote({ sku: 'ghost', quantity: 1, buyerState: 'KA', sellerState: 'GA' }).taxKind, 'inter');
});

test('billing same as delivery: copies the delivery address; place of supply is the delivery state', () => {
  const r = checkoutAddresses({ delivery: goa, billingSame: true });
  assert.equal(r.ok, true);
  assert.equal(r.value.billing.city, 'Panaji');
  assert.equal(r.value.billingSame, true);
  assert.equal(r.value.gstin, null);
  assert.equal(r.value.place_of_supply, 'GA');
});

test('separate billing without a GSTIN: tax still follows the delivery state', () => {
  const r = checkoutAddresses({ delivery: goa, billing: pune, billingSame: false });
  assert.equal(r.value.billing.city, 'Pune');
  assert.equal(r.value.place_of_supply, 'GA');
});

test('separate billing with a GSTIN: place of supply is the GSTIN (billing) state', () => {
  const r = checkoutAddresses({ delivery: goa, billing: pune, billingSame: false, gstin: '27abcde1234f1z5', businessName: 'Rao Drones LLP' });
  assert.equal(r.ok, true);
  assert.equal(r.value.gstin, '27ABCDE1234F1Z5', 'upper-cased');
  assert.equal(r.value.place_of_supply, 'MH');
  assert.equal(r.value.delivery.gstin, null, 'GSTIN never sits on the delivery address');
});

test('GSTIN from another state than the billing address is refused, naming both states', () => {
  const r = checkoutAddresses({ delivery: goa, billingSame: true, gstin: '27ABCDE1234F1Z5', businessName: 'X' });
  assert.equal(r.ok, false);
  assert.match(r.errors.gstin, /registered in Maharashtra, but the billing address is in Goa/);
  assert.match(validateGst('30ABCDE1234F1Z5', '', 'GA').errors.business_name, /business name/);
  assert.deepEqual(validateGst('', 'Fontainhas Labs', 'GA'), { errors: {}, gstin: null, business_name: 'Fontainhas Labs' }, 'company without GSTIN keeps its name');
  assert.equal(validateGst('30 ABCDE 1234F1Z5', 'Goa Co', 'GA').gstin, '30ABCDE1234F1Z5', 'spaces removed');
});

test('billing address may leave out the phone; delivery may not', () => {
  const { phone, ...noPhone } = { ...good };
  assert.equal(validateAddress(noPhone).ok, false);
  assert.equal(validateAddress(noPhone, { phoneRequired: false }).ok, true);
  assert.ok(validateAddress({ ...noPhone, phone: '12' }, { phoneRequired: false }).errors.phone, 'a wrong phone is still refused');
});

test('orders from before billing addresses bill the delivery address', () => {
  const old = { customer_name: 'Asha', phone: '+91', address_line1: 'a', address_line2: null, city: 'Panaji', state_code: 'GA', pincode: '403001' };
  assert.deepEqual(billingOf(old), { name: 'Asha', phone: '+91', address_line1: 'a', address_line2: null, city: 'Panaji', state_code: 'GA', pincode: '403001', same: true });
  assert.equal(placeOfSupply(old), 'GA');
  const split = { ...old, billing_name: 'Rao Drones', billing_line1: 'Plot 7', billing_city: 'Pune', billing_state_code: 'MH', billing_pincode: '411026', place_of_supply: 'MH' };
  assert.equal(billingOf(split).same, false);
  assert.equal(placeOfSupply(split), 'MH');
});

test('Google settings: stray spaces trimmed, placeholder means "not set up"', () => {
  assert.equal(clientId({ GOOGLE_CLIENT_ID: ' abc.apps.googleusercontent.com\n' }), 'abc.apps.googleusercontent.com');
  assert.equal(googleConfigured({ GOOGLE_CLIENT_ID: 'REPLACE.apps.googleusercontent.com' }), false);
  assert.equal(googleConfigured({ GOOGLE_CLIENT_ID: '' }), false);
  assert.equal(googleConfigured({ GOOGLE_CLIENT_ID: 'abc.apps.googleusercontent.com' }), true);
  assert.equal(redirectUri({ SITE_URL: 'https://wargrobotics.com/ ' }), 'https://wargrobotics.com/api/auth/google/callback');
});

test('confirmation email: Panaji address in the footer; "Billed to" only when it differs or has a GSTIN', () => {
  const base = { order_number: 'WR-311026-ABCD', customer_name: 'Asha Rao', email: 'a@b.co', phone: '+919845012345', address_line1: '4, Rua de Ourem', city: 'Panaji', state_code: 'GA', pincode: '403001',
    items: [{ product_name: 'Warg Ghost', quantity: 1, price_type: 'offer', unit_price_paise: 1999900, subtotal_paise: 1999900 }],
    subtotal_paise: 1999900, gst_paise: 359982, total_paise: 2359882, tax_kind: 'intra', link_token: 't' };
  const plain = confirmationEmail({}, base, { hasInvoice: false }).html;
  assert.match(plain, /Panaji, Goa/);
  assert.doesNotMatch(plain, /Bengaluru|Indiranagar/);
  assert.doesNotMatch(plain, /Billed to/);
  const billed = confirmationEmail({}, { ...base, billing_name: 'Rao Drones', billing_line1: 'Plot 7', billing_city: 'Pune', billing_state_code: 'MH', billing_pincode: '411026', gstin: '27ABCDE1234F1Z5', business_name: 'Rao Drones LLP' }, { hasInvoice: false }).html;
  assert.match(billed, /Billed to/);
  assert.match(billed, /Pune, Maharashtra 411026/);
  assert.match(billed, /GSTIN 27ABCDE1234F1Z5/);
});

test('no page, script or email still shows the old Bengaluru address', () => {
  const root = new URL('..', import.meta.url);
  const files = readdirSync(root).filter(f => /\.(html|js)$/.test(f)).map(f => new URL(f, root))
    .concat(readdirSync(new URL('src/', root)).map(f => new URL('src/' + f, root)));
  for (const f of files) assert.doesNotMatch(readFileSync(f, 'utf8'), /Indiranagar|Bengaluru/, f.pathname);
});

// ------------------------------------------------------------------ 31 Oct evening: pincode ↔ state
import { pincodeFitsState, statesForPincode } from '../src/config.js';

test('pincodes must belong to the chosen state', () => {
  for (const [pin, st] of [['403001', 'GA'], ['560038', 'KA'], ['411026', 'MH'], ['110001', 'DL'], ['600001', 'TN'], ['500001', 'TS'], ['700001', 'WB'], ['160017', 'CH'], ['781001', 'AS'], ['682001', 'KL']]) {
    assert.ok(pincodeFitsState(pin, st), `${pin} ${st}`);
  }
  assert.equal(pincodeFitsState('560038', 'GA'), false);
  assert.equal(pincodeFitsState('403001', 'MH'), false);
  assert.deepEqual(statesForPincode('560038'), ['KA']);
  const v = validateAddress({ ...good, state_code: 'GA', pincode: '560038' });
  assert.match(v.errors.pincode, /not a Goa pincode \(it looks like Karnataka\)/);
  assert.match(validateAddress({ ...good, pincode: '056003' }).errors.pincode, /valid 6-digit/);
  assert.match(validateAddress({ ...good, pincode: '912345' }).errors.pincode, /valid 6-digit/, 'army postal pincodes are not delivery addresses');
  assert.equal(validateAddress({ ...good, pincode: '560 038' }).value.pincode, '560038', 'spaces removed');
});

test('sign-up checks the confirmation password', () => {
  assert.match(validateRegistration({ name: 'Asha', email: 'a@b.co', password: 'correct horse battery', password_confirm: 'nope nope nope' }).errors.password_confirm, /do not match/);
  assert.equal(validateRegistration({ name: 'Asha', email: 'a@b.co', password: 'correct horse battery', password_confirm: 'correct horse battery' }).ok, true);
});

// ------------------------------------------------------------------ 31 Oct night
import { gstTreatment } from '../src/zoho.js';
import { RESENDABLE } from '../src/fulfilment.js';

test('company name without a GSTIN: kept, invoiced as an unregistered business', () => {
  const r = checkoutAddresses({ delivery: goa, billingSame: true, gstin: '', businessName: 'Fontainhas Labs' });
  assert.equal(r.ok, true);
  assert.equal(r.value.business_name, 'Fontainhas Labs');
  assert.equal(r.value.gstin, null);
  assert.equal(r.value.place_of_supply, 'GA', 'no GSTIN: tax follows delivery');
  assert.equal(gstTreatment({ gstin: null, business_name: 'Fontainhas Labs' }), 'business_none');
  assert.equal(gstTreatment({ gstin: '30ABCDE1234F1Z5', business_name: 'X' }), 'business_gst');
  assert.equal(gstTreatment({ gstin: null, business_name: null }), 'consumer');
});

test('resend: each email only when it makes sense for the order', () => {
  assert.match(RESENDABLE.invoice.needs({ zoho_invoice_id: null }), /not been created/);
  assert.equal(RESENDABLE.invoice.needs({ zoho_invoice_id: 'inv_1' }), null);
  assert.match(RESENDABLE.dispatch.needs({}), /no tracking/);
  assert.match(RESENDABLE.cancelled.needs({ status: 'paid' }), /not cancelled/);
});

test('confirmation email shows full prices, the combo and coupon savings, and the discounted subtotal', () => {
  const o = { order_number: 'WR-311026-COMB', customer_name: 'Asha Rao', email: 'a@b.co', phone: '+919845012345', address_line1: '4, Rua de Ourem', city: 'Panaji', state_code: 'GA', pincode: '403001',
    items: [{ product_name: 'Warg Ghost', quantity: 2, unit_price_paise: 2999900, discount_paise: 1327225, subtotal_paise: 4672575, discount_label: '1 in combo, 1 with WARG20 (20% off)' },
            { product_name: 'Warg Greywind', quantity: 1, unit_price_paise: 3599900, discount_paise: 872675, subtotal_paise: 2727225, discount_label: '1 in combo' }],
    list_subtotal_paise: 9599700, combo_discount_paise: 1599900, coupon_code: 'WARG20', coupon_discount_paise: 600000,
    subtotal_paise: 7399800, gst_paise: 1331964, total_paise: 8731764, tax_kind: 'intra', link_token: 't' };
  const html = confirmationEmail({}, o, { hasInvoice: true }).html;
  assert.match(html, /Warg Ghost × 2<\/td><td[^>]*>₹59,998\.00/);
  assert.match(html, /Ghost \+ Greywind combo<\/td><td[^>]*>− ₹15,999\.00/);
  assert.match(html, /Coupon WARG20<\/td><td[^>]*>− ₹6,000\.00/);
  assert.match(html, /Subtotal after discounts<\/td><td[^>]*>₹73,998\.00/);
});

test('every customer page links the four policy pages in its footer', () => {
  const root = new URL('..', import.meta.url);
  for (const f of readdirSync(root).filter(n => n.endsWith('.html') && n !== 'admin.html')) {
    const html = readFileSync(new URL(f, root), 'utf8');
    const foot = html.slice(html.indexOf('<footer'));
    for (const p of ['terms', 'refunds', 'shipping', 'privacy']) assert.match(foot, new RegExp(`href="/?${p}(\\.html)?"`), `${f} → ${p}`);
  }
});

test('grievance officer and account deletion are published', () => {
  const root = new URL('..', import.meta.url);
  const read = f => readFileSync(new URL(f, root), 'utf8');
  for (const f of ['terms.html', 'privacy.html', 'contact.html', 'index.html']) {
    assert.match(read(f), /Sam Singh/, f);
    assert.match(read(f), /\+91 86689 23286/, f);
  }
  assert.match(read('privacy.html'), /id="delete"[\s\S]*Delete my Warg account/);
  assert.match(read('account.html'), /href="\/privacy#delete"/);
});

test('coupon prices are whole rupees, and the site never shows how many coupons are left', () => {
  const root = new URL('..', import.meta.url);
  for (const sku of Object.keys(PRODUCTS)) assert.equal(quote({ sku, quantity: 1, coupon: { code: 'WARG20', usesLeft: 1, now: Date.parse('2026-11-01T12:00:00+05:30') } }).subtotalPaise % 100, 0, sku);
  for (const f of ['index.html', 'ghost.html', 'greywind.html']) {
    const html = readFileSync(new URL(f, root), 'utf8');
    assert.doesNotMatch(html, /\.20<|data-coupon-left|left\)/, f);
    assert.match(html, /valid till 20 Nov/, f);
  }
  assert.doesNotMatch(readFileSync(new URL('site.js', root), 'utf8'), /coupon-left|\.left\b/);
});
