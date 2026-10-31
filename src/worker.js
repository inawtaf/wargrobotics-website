// wargrobotics.com backend: a Cloudflare Worker in front of the static site.
// Only /api/* reaches this code (see run_worker_first in wrangler.jsonc);
// every other path is served straight from the static files.
//
// Public
//   GET  /api/products                       prices, offer units left, states
//   POST /api/quote                          price a list of items for a state
//   GET  /api/orders/:n?t=token              order page from an email link
//   POST /api/webhooks/razorpay              Razorpay webhook
// Sign-in
//   POST /api/auth/register | login | logout | forgot | reset
//   GET  /api/auth/verify?token=             email confirmation link
//   GET  /api/auth/google[?next=&mode=link]  -> Google; /api/auth/google/callback
//   GET  /api/me                             who is signed in (+ cart count)
// Signed in
//   POST /api/auth/resend-verification | logout-all
//   PATCH /api/account/profile;  POST /api/account/password;  POST /api/account/google/unlink
//   GET/POST /api/account/addresses;  PUT/DELETE /api/account/addresses/:id;  POST .../:id/default
//   GET/PUT /api/cart;  POST /api/cart/add
//   POST /api/orders                         checkout (verified email required)
//   POST /api/orders/:n/confirm              checkout success callback
//   GET  /api/account/orders[/:n];  GET .../:n/invoice;  POST .../:n/reorder
//   GET/POST /api/account/service
// Order portal (staff account in ADMIN_EMAILS, or Authorization: Bearer ADMIN_TOKEN)
//   GET /api/admin/summary | orders[?status=&q=&from=&to=&page=] | orders.csv | orders/:n
//   POST /api/admin/orders/:n/process|ship|deliver|cancel|note|resend|retry
//   GET /api/admin/service;  POST /api/admin/service/:sr

import { PRODUCTS, STATES, MAX_QUANTITY, GST_RATE_BP } from './config.js';
import { validateAddress, validateItems, checkoutAddresses } from './validate.js';
import { json, safeEqual, orderToken, readJson, httpError } from './util.js';
import * as auth from './auth.js';
import * as razorpay from './razorpay.js';
import * as orders from './orders.js';
import * as account from './account.js';
import * as adminApi from './admin.js';
import * as google from './google.js';
import { events as orderEvents } from './fulfilment.js';
import { ensureSchema } from './schema.js';

// --------------------------------------------------------------------- public

async function products(env) {
  const sold = await orders.soldAtOffer(env);
  return json({
    products: Object.values(PRODUCTS).map(p => ({
      sku: p.sku, name: p.name, line: p.line,
      list_price_paise: p.listPricePaise, offer_price_paise: p.offerPricePaise,
      offer_units_left: Math.max(0, p.offerUnits - (sold[p.sku] || 0)),
    })),
    gst_rate_bp: GST_RATE_BP, max_quantity: MAX_QUANTITY,
    seller_state: env.SELLER_STATE || 'GA', razorpay_key_id: env.RAZORPAY_KEY_ID || null,
    google_enabled: google.configured(env),
    states: STATES.map(({ code, name }) => ({ code, name })),
  }, 200, { 'cache-control': 'public, max-age=60' });
}

async function quoteHandler(request, env) {
  const b = await readJson(request);
  const v = validateItems(b.items);
  if (!v.ok) return json({ error: v.errors.items }, 422);
  return json({ quote: await orders.quoteItems(env, v.value, String(b.state_code || '').toUpperCase()) });
}

// Order page opened from an email link. The link alone isn't enough: the
// buyer must be signed in to the account that placed the order.
async function orderByToken(env, n, token, user) {
  if (!user) return json({ error: 'Please sign in to see this order.', code: 'signin' }, 401);
  const order = await orders.getByNumber(env, n);
  if (!order || order.user_id !== user.id || !token || !safeEqual(await orderToken(env, order.order_number), token)) return json({ error: 'not found' }, 404);
  const { phone, address_line1, address_line2, gstin, billing, ...view } = orders.publicView(order, await orders.getItems(env, order.id));
  return json({ order: { ...view, timeline: await orderEvents(env, order.id, { visibleOnly: true }) } });
}

async function webhookHandler(request, env, ctx) {
  const raw = await request.text();
  if (!(await razorpay.verifyWebhookSignature(env, raw, request.headers.get('x-razorpay-signature')))) {
    return json({ error: 'bad signature' }, 401);
  }
  let evt;
  try { evt = JSON.parse(raw); } catch { return json({ error: 'invalid JSON' }, 400); }
  const payment = evt.payload?.payment?.entity;
  const rzpOrderId = payment?.order_id || evt.payload?.order?.entity?.id;
  const order = rzpOrderId ? await orders.getByRazorpayOrder(env, rzpOrderId) : null;
  await orders.logPaymentEvent(env, { orderId: order?.id, source: 'webhook', event: evt.event, paymentId: payment?.id, amountPaise: payment?.amount, payload: raw });
  if (!order) return json({ ok: true, matched: false });   // 200 so Razorpay stops retrying
  if ((evt.event === 'payment.captured' || evt.event === 'order.paid') && payment?.status === 'captured') {
    try {
      if (await orders.markPaid(env, order, { paymentId: payment.id, amountPaise: payment.amount })) ctx.waitUntil(orders.fulfil(env, order.id));
    } catch (e) { console.error('webhook markPaid:', e.message); }
  }
  return json({ ok: true });
}

// --------------------------------------------------------------------- checkout

async function createOrderHandler(request, env, ctx, user) {
  if (!user.email_verified_at) return json({ error: 'Confirm your email address before ordering. We sent you a link.', code: 'unverified' }, 403);
  const b = await readJson(request);
  if (b.hp_trap) return json({ error: 'rejected' }, 400);

  const { results } = await env.DB.prepare('SELECT sku, quantity FROM cart_items WHERE user_id = ?').bind(user.id).all();
  const items = validateItems(results);
  if (!items.ok) return json({ error: items.errors.items }, 422);

  // Delivery: a saved address or a new one. (address_id / address / save_address
  // are the older field names, still accepted.)
  const savedOrNew = async (id, raw, save, opts, field) => {
    if (id) {
      const row = await env.DB.prepare('SELECT * FROM addresses WHERE id = ? AND user_id = ?').bind(Number(id), user.id).first();
      if (!row) return { errors: { [field]: field === 'billing_address_id' ? 'Choose a billing address.' : 'Choose a delivery address.' } };
      return { value: row };
    }
    const v = validateAddress(raw, opts);
    if (!v.ok) return { errors: v.errors };
    return { value: v.value, save };
  };
  const del = await savedOrNew(b.delivery_address_id ?? b.address_id, b.delivery_address ?? b.address, b.save_delivery ?? b.save_address, {}, 'address_id');
  if (del.errors) return json({ error: 'validation', fields: del.errors }, 422);
  const billingSame = b.billing_same !== false;
  let bill = null;
  if (!billingSame) {
    bill = await savedOrNew(b.billing_address_id, b.billing_address, b.save_billing, { phoneRequired: false }, 'billing_address_id');
    if (bill.errors) return json({ error: 'validation', fields: Object.fromEntries(Object.entries(bill.errors).map(([k, v]) => [k.startsWith('billing_') ? k : `billing_${k}`, v])) }, 422);
  }
  // GSTIN: sent on its own by the checkout; older clients put it on the address.
  const gstSource = 'gstin' in b ? b : (bill?.value || del.value);
  const c = checkoutAddresses({ delivery: del.value, billing: bill?.value, billingSame, gstin: gstSource.gstin, businessName: gstSource.business_name });
  if (!c.ok) return json({ error: 'validation', fields: c.errors }, 422);

  // Review step: everything checked and priced, nothing saved or charged yet.
  if (b.dry_run) {
    const quote = await orders.quoteItems(env, items.value, c.value.place_of_supply);
    return json({ review: { ...c.value, quote, email: user.email } });
  }

  if (!(await auth.throttle(env, `checkout:${user.id}`, 20, 3600))) throw httpError(429, 'Too many checkout attempts. Try again later.');

  // Save new addresses to the address book (if asked), with the GSTIN on the billing one.
  try {
    if (del.save) await account.saveAddress(env, user, { ...del.value, ...(billingSame ? { gstin: c.value.gstin, business_name: c.value.business_name } : { gstin: null, business_name: null }) }, { billing: billingSame });
    // Saved addresses need a phone; a billing address given without one borrows the delivery phone.
    if (bill?.save) await account.saveAddress(env, user, { ...bill.value, phone: bill.value.phone || c.value.delivery.phone, gstin: c.value.gstin, business_name: c.value.business_name }, { makeDefaultBilling: true });
  } catch (e) { console.error('saving checkout address:', e.message); /* e.g. address book full: still place the order */ }

  const created = await orders.createOrder(env, user, items.value, c.value);
  return json({
    order_number: created.orderNumber,
    token: created.token,
    razorpay_order_id: created.razorpayOrderId,
    razorpay_key_id: env.RAZORPAY_KEY_ID,
    amount_paise: created.quote.totalPaise,
    quote: created.quote,
    prefill: { name: user.name, email: user.email, contact: c.value.delivery.phone },
  }, 201);
}

// Checkout success callback. A valid signature proves the payment belongs to
// this order; we still fetch the payment so it is only marked paid once captured.
async function confirmHandler(request, env, ctx, user, n) {
  const b = await readJson(request);
  const order = await orders.getByNumber(env, n);
  if (!order || order.user_id !== user.id) return json({ error: 'not found' }, 404);
  if (order.status !== 'created') return json({ status: order.status });

  const ok = order.razorpay_order_id === b.razorpay_order_id &&
    (await razorpay.verifyCheckoutSignature(env, { orderId: b.razorpay_order_id, paymentId: b.razorpay_payment_id, signature: b.razorpay_signature }));
  if (!ok) {
    await orders.logPaymentEvent(env, { orderId: order.id, source: 'checkout', event: 'bad_signature', paymentId: b.razorpay_payment_id });
    return json({ error: 'signature check failed' }, 400);
  }
  const payment = await razorpay.fetchPayment(env, b.razorpay_payment_id);
  await orders.logPaymentEvent(env, { orderId: order.id, source: 'checkout', event: `payment.${payment.status}`, paymentId: payment.id, amountPaise: payment.amount });
  if (payment.status !== 'captured' || payment.order_id !== order.razorpay_order_id) return json({ status: 'processing' });
  if (await orders.markPaid(env, order, { paymentId: payment.id, amountPaise: payment.amount })) ctx.waitUntil(orders.fulfil(env, order.id));
  return json({ status: 'paid' });
}

// --------------------------------------------------------------------- routing

const WRITE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

async function route(request, env, ctx) {
  const url = new URL(request.url);
  const seg = url.pathname.replace(/\/+$/, '').split('/').slice(2);   // after /api
  const m = request.method;
  const [a, b, c, d] = seg;

  // Machine-to-machine first: it doesn't use cookies.
  if (a === 'webhooks' && b === 'razorpay' && m === 'POST') return webhookHandler(request, env, ctx);
  // Order portal: staff session (with its own Origin check) or ADMIN_TOKEN.
  if (a === 'admin') return adminApi.route(request, env, ctx, seg.slice(1), await auth.currentUser(env, request));

  // Anything that changes state must come from our own pages (CSRF guard).
  if (WRITE.has(m) && !auth.sameOrigin(request, env)) return json({ error: 'Cross-site request refused.' }, 403);

  if (a === 'products' && m === 'GET') return products(env);
  if (a === 'quote' && m === 'POST') return quoteHandler(request, env);
  const user = await auth.currentUser(env, request);
  if (a === 'orders' && b && !c && m === 'GET' && url.searchParams.has('t')) return orderByToken(env, b, url.searchParams.get('t'), user);

  if (a === 'auth') {
    if (b === 'register' && m === 'POST') return account.register(request, env);
    if (b === 'login' && m === 'POST') return account.login(request, env);
    if (b === 'logout' && m === 'POST') return account.logout(request, env);
    if (b === 'forgot' && m === 'POST') return account.forgot(request, env);
    if (b === 'reset' && m === 'POST') return account.reset(request, env);
    if (b === 'verify' && m === 'GET') return account.verify(request, env);
    if (b === 'google' && !c && m === 'GET') return account.googleStart(request, env, ctx, user);
    if (b === 'google' && c === 'callback' && m === 'GET') return account.googleCallback(request, env, ctx, user);
  }
  if (a === 'me' && m === 'GET') return account.me(request, env, ctx, user);

  // ---- everything below needs a signed-in user
  if (!user) return json({ error: 'Please sign in.', code: 'signin' }, 401);

  if (a === 'auth' && b === 'resend-verification' && m === 'POST') return account.resendVerification(request, env, ctx, user);
  if (a === 'auth' && b === 'logout-all' && m === 'POST') return account.logoutAll(request, env, ctx, user);

  if (a === 'cart') {
    if (!b && m === 'GET') return account.getCart(request, env, ctx, user);
    if (!b && m === 'PUT') return account.putCart(request, env, ctx, user);
    if (b === 'add' && m === 'POST') return account.postCartAdd(request, env, ctx, user);
  }

  if (a === 'orders' && !b && m === 'POST') return createOrderHandler(request, env, ctx, user);
  if (a === 'orders' && b && c === 'confirm' && m === 'POST') return confirmHandler(request, env, ctx, user, b);

  if (a === 'account') {
    if (b === 'profile' && m === 'PATCH') return account.updateProfile(request, env, ctx, user);
    if (b === 'password' && m === 'POST') return account.changePassword(request, env, ctx, user);
    if (b === 'google' && c === 'unlink' && m === 'POST') return account.unlinkGoogle(request, env, ctx, user);

    if (b === 'addresses') {
      if (!c && m === 'GET') return account.listAddresses(request, env, ctx, user);
      if (!c && m === 'POST') return account.createAddress(request, env, ctx, user);
      const id = Number(c);
      if (Number.isInteger(id)) {
        if (!d && m === 'PUT') return account.updateAddress(request, env, ctx, user, id);
        if (!d && m === 'DELETE') return account.deleteAddress(request, env, ctx, user, id);
        if (d === 'default' && m === 'POST') return account.makeDefaultAddress(request, env, ctx, user, id);
      }
    }
    if (b === 'orders') {
      if (!c && m === 'GET') return account.listOrders(request, env, ctx, user);
      if (c && !d && m === 'GET') return account.getOrder(request, env, ctx, user, c);
      if (c && d === 'invoice' && m === 'GET') return account.invoicePdf(request, env, ctx, user, c);
      if (c && d === 'reorder' && m === 'POST') return account.reorder(request, env, ctx, user, c);
    }
    if (b === 'service') {
      if (!c && m === 'GET') return account.listService(request, env, ctx, user);
      if (!c && m === 'POST') return account.createService(request, env, ctx, user);
    }
  }
  return json({ error: 'not found' }, 404);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    try {
      await ensureSchema(env);   // creates any missing tables (first request after a deploy)
      return await route(request, env, ctx);
    } catch (e) {
      if (!e.status) console.error(`${request.method} ${url.pathname}:`, e.stack || e.message);
      return json({ error: e.status ? e.message : 'Something went wrong. Please try again.' }, e.status || 500);
    }
  },

  // Every 15 minutes: finish any paid order whose invoice or emails failed,
  // and tidy expired sessions and links.
  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => {
      await ensureSchema(env);
      const r = await orders.retryUnfinished(env);
      if (r.length) console.log('retried', JSON.stringify(r));
      const now = Math.floor(Date.now() / 1000);
      await env.DB.batch([
        env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now),
        env.DB.prepare('DELETE FROM auth_tokens WHERE expires_at < ?').bind(now - 86400),
        env.DB.prepare('DELETE FROM throttle WHERE window_start < ?').bind(now - 86400),
      ]);
    })());
  },
};
