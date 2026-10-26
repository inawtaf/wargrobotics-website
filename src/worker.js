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
// Admin (Authorization: Bearer ADMIN_TOKEN)
//   GET /api/admin/orders[/:n];  POST /api/admin/orders/:n/ship|deliver|retry
//   GET /api/admin/service;  POST /api/admin/service/:sr

import { PRODUCTS, STATES, MAX_QUANTITY, GST_RATE_BP } from './config.js';
import { validateAddress, validateItems } from './validate.js';
import { json, safeEqual, orderToken, readJson, httpError } from './util.js';
import * as auth from './auth.js';
import * as razorpay from './razorpay.js';
import * as orders from './orders.js';
import * as account from './account.js';

function isAdmin(request, env) {
  const h = request.headers.get('authorization') || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  return Boolean(env.ADMIN_TOKEN) && env.ADMIN_TOKEN.length >= 24 && safeEqual(token, env.ADMIN_TOKEN);
}

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
    seller_state: env.SELLER_STATE || 'KA', razorpay_key_id: env.RAZORPAY_KEY_ID || null,
    google_enabled: Boolean(env.GOOGLE_CLIENT_ID),
    states: STATES.map(({ code, name }) => ({ code, name })),
  }, 200, { 'cache-control': 'public, max-age=60' });
}

async function quoteHandler(request, env) {
  const b = await readJson(request);
  const v = validateItems(b.items);
  if (!v.ok) return json({ error: v.errors.items }, 422);
  return json({ quote: await orders.quoteItems(env, v.value, String(b.state_code || '').toUpperCase()) });
}

// Order page opened from an email link: no full address or phone on this view.
async function orderByToken(env, n, token) {
  const order = await orders.getByNumber(env, n);
  if (!order || !token || !safeEqual(await orderToken(env, order.order_number), token)) return json({ error: 'not found' }, 404);
  const { phone, address_line1, address_line2, gstin, ...view } = orders.publicView(order, await orders.getItems(env, order.id));
  return json({ order: view });
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

  let addr;
  if (b.address_id) {
    addr = await env.DB.prepare('SELECT * FROM addresses WHERE id = ? AND user_id = ?').bind(Number(b.address_id), user.id).first();
    if (!addr) return json({ error: 'validation', fields: { address_id: 'Choose a delivery address.' } }, 422);
  } else {
    const v = validateAddress(b.address);
    if (!v.ok) return json({ error: 'validation', fields: v.errors }, 422);
    addr = v.value;
    if (b.save_address) {
      try { await account.saveAddress(env, user, addr); } catch (e) { /* address book full: still place the order */ }
    }
  }
  if (!(await auth.throttle(env, `checkout:${user.id}`, 20, 3600))) throw httpError(429, 'Too many checkout attempts. Try again later.');

  const created = await orders.createOrder(env, user, items.value, addr);
  return json({
    order_number: created.orderNumber,
    token: created.token,
    razorpay_order_id: created.razorpayOrderId,
    razorpay_key_id: env.RAZORPAY_KEY_ID,
    amount_paise: created.quote.totalPaise,
    quote: created.quote,
    prefill: { name: user.name, email: user.email, contact: addr.phone },
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

// --------------------------------------------------------------------- admin

async function admin(request, env, ctx, seg) {
  if (!isAdmin(request, env)) return json({ error: 'unauthorised' }, 401);
  const [kind, id, action] = seg;          // /api/admin/<kind>/<id>/<action>
  const m = request.method;

  if (kind === 'service') {
    if (m === 'GET' && !id) return account.adminListService(request, env);
    if (m === 'POST' && id) return account.adminUpdateService(request, env, ctx, id);
    return json({ error: 'not found' }, 404);
  }
  if (kind !== 'orders') return json({ error: 'not found' }, 404);

  if (m === 'GET' && !id) {
    const status = new URL(request.url).searchParams.get('status');
    const stmt = status
      ? env.DB.prepare('SELECT * FROM orders WHERE status = ? ORDER BY id DESC LIMIT 200').bind(status)
      : env.DB.prepare("SELECT * FROM orders WHERE status != 'created' OR created_at > datetime('now','-2 days') ORDER BY id DESC LIMIT 200");
    return json({ orders: (await stmt.all()).results });
  }
  const order = id && (await orders.getByNumber(env, id));
  if (!order) return json({ error: 'not found' }, 404);
  if (m === 'GET' && !action) {
    const ev = await env.DB.prepare('SELECT source, event, payment_id, amount_paise, received_at FROM payment_events WHERE order_id = ? ORDER BY id').bind(order.id).all();
    return json({ order: { ...order, items: await orders.getItems(env, order.id) }, payment_events: ev.results });
  }
  if (m !== 'POST') return json({ error: 'method not allowed' }, 405);

  if (action === 'ship') {
    if (!['paid', 'shipped'].includes(order.status)) return json({ error: `order is ${order.status}` }, 409);
    const b = await readJson(request);
    const courier = String(b.courier || '').trim().slice(0, 60);
    const tracking_number = String(b.tracking_number || '').trim().slice(0, 60);
    const tracking_url = String(b.tracking_url || '').trim().slice(0, 300);
    if (!courier || !tracking_number) return json({ error: 'courier and tracking_number are required' }, 422);
    if (tracking_url && !/^https:\/\//.test(tracking_url)) return json({ error: 'tracking_url must start with https://' }, 422);
    await orders.markShipped(env, order, { courier, tracking_number, tracking_url });
    return json({ ok: true, status: 'shipped' });
  }
  if (action === 'deliver') {
    if (order.status !== 'shipped') return json({ error: `order is ${order.status}` }, 409);
    await orders.markDelivered(env, order);
    return json({ ok: true, status: 'delivered' });
  }
  if (action === 'retry') {
    await env.DB.prepare('UPDATE orders SET fulfil_attempts = 0 WHERE id = ?').bind(order.id).run();
    return json({ ok: true, result: await orders.fulfil(env, order.id) });
  }
  return json({ error: 'unknown action' }, 404);
}

// --------------------------------------------------------------------- routing

const WRITE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

async function route(request, env, ctx) {
  const url = new URL(request.url);
  const seg = url.pathname.replace(/\/+$/, '').split('/').slice(2);   // after /api
  const m = request.method;
  const [a, b, c, d] = seg;

  // Machine-to-machine and admin first: they don't use cookies.
  if (a === 'webhooks' && b === 'razorpay' && m === 'POST') return webhookHandler(request, env, ctx);
  if (a === 'admin') return admin(request, env, ctx, seg.slice(1));

  // Anything that changes state must come from our own pages (CSRF guard).
  if (WRITE.has(m) && !auth.sameOrigin(request, env)) return json({ error: 'Cross-site request refused.' }, 403);

  if (a === 'products' && m === 'GET') return products(env);
  if (a === 'quote' && m === 'POST') return quoteHandler(request, env);
  if (a === 'orders' && b && !c && m === 'GET' && url.searchParams.has('t')) return orderByToken(env, b, url.searchParams.get('t'));

  const user = await auth.currentUser(env, request);

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
