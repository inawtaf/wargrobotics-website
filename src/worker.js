// wargrobotics.com backend: a Cloudflare Worker in front of the static site.
// Only /api/* reaches this code (see run_worker_first in wrangler.jsonc);
// every other path is served straight from the static files.
//
//   GET  /api/products                 prices, offer units left, states list
//   POST /api/quote                    price breakdown for the checkout form
//   POST /api/orders                   create order + Razorpay order
//   POST /api/orders/:n/confirm        checkout success callback (signature check)
//   GET  /api/orders/:n?t=token        buyer's order page
//   POST /api/webhooks/razorpay        Razorpay webhook (source of truth for payment)
//   GET  /api/admin/orders             list orders            } Authorization:
//   GET  /api/admin/orders/:n          one order, all fields  } Bearer ADMIN_TOKEN
//   POST /api/admin/orders/:n/ship     mark shipped + email   }
//   POST /api/admin/orders/:n/deliver  mark delivered         }
//   POST /api/admin/orders/:n/retry    re-run invoice/emails  }

import { PRODUCTS, STATES, MAX_QUANTITY } from './config.js';
import { validateOrder } from './validate.js';
import { json, safeEqual, orderToken } from './util.js';
import * as razorpay from './razorpay.js';
import * as orders from './orders.js';

const MAX_BODY = 16 * 1024;

async function readJson(request) {
  const text = await request.text();
  if (text.length > MAX_BODY) throw Object.assign(new Error('body too large'), { status: 413 });
  try { return JSON.parse(text || '{}'); } catch { throw Object.assign(new Error('invalid JSON'), { status: 400 }); }
}

function isAdmin(request, env) {
  const h = request.headers.get('authorization') || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  return Boolean(env.ADMIN_TOKEN) && env.ADMIN_TOKEN.length >= 24 && safeEqual(token, env.ADMIN_TOKEN);
}

async function buyerCanSee(env, order, token) {
  return Boolean(order && token) && safeEqual(await orderToken(env, order.order_number), token);
}

// --------------------------------------------------------------------- handlers

async function products(env) {
  const list = [];
  for (const p of Object.values(PRODUCTS)) {
    const sold = await orders.unitsSoldAtOffer(env, p.sku);
    list.push({
      sku: p.sku, name: p.name, line: p.line,
      list_price_paise: p.listPricePaise, offer_price_paise: p.offerPricePaise,
      offer_units_left: Math.max(0, p.offerUnits - sold),
    });
  }
  return json({
    products: list, gst_rate_bp: 1800, max_quantity: MAX_QUANTITY,
    seller_state: env.SELLER_STATE || 'KA', razorpay_key_id: env.RAZORPAY_KEY_ID || null,
    states: STATES.map(({ code, name }) => ({ code, name })),
  }, 200, { 'cache-control': 'public, max-age=60' });
}

async function quoteHandler(request, env) {
  const b = await readJson(request);
  const sku = String(b.sku || '').toLowerCase();
  const quantity = Number(b.quantity);
  if (!PRODUCTS[sku] || !Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) {
    return json({ error: 'invalid product or quantity' }, 400);
  }
  const q = await orders.quoteFor(env, sku, quantity, String(b.state_code || '').toUpperCase());
  return json({ quote: q });
}

async function createOrderHandler(request, env) {
  const b = await readJson(request);
  if (b.hp_trap) return json({ error: 'rejected' }, 400);         // spam honeypot
  const v = validateOrder(b);
  if (!v.ok) return json({ error: 'validation', fields: v.errors }, 422);
  const created = await orders.createOrder(env, v.value);
  return json({
    order_number: created.orderNumber,
    token: created.token,
    razorpay_order_id: created.razorpayOrderId,
    razorpay_key_id: env.RAZORPAY_KEY_ID,
    amount_paise: created.quote.totalPaise,
    quote: created.quote,
    prefill: { name: v.value.name, email: v.value.email, contact: v.value.phone },
  }, 201);
}

// Called by the checkout page right after Razorpay's success callback.
// A valid signature proves the payment belongs to this order; we still fetch
// the payment so the order is only marked paid once the money is captured.
async function confirmHandler(request, env, ctx, n) {
  const b = await readJson(request);
  const order = await orders.getByNumber(env, n);
  if (!order || !(await buyerCanSee(env, order, b.token))) return json({ error: 'not found' }, 404);
  if (order.status !== 'created') return json({ status: order.status });

  const ok = order.razorpay_order_id === b.razorpay_order_id &&
    (await razorpay.verifyCheckoutSignature(env, { orderId: b.razorpay_order_id, paymentId: b.razorpay_payment_id, signature: b.razorpay_signature }));
  if (!ok) {
    await orders.logPaymentEvent(env, { orderId: order.id, source: 'checkout', event: 'bad_signature', paymentId: b.razorpay_payment_id });
    return json({ error: 'signature check failed' }, 400);
  }

  const payment = await razorpay.fetchPayment(env, b.razorpay_payment_id);
  await orders.logPaymentEvent(env, { orderId: order.id, source: 'checkout', event: `payment.${payment.status}`, paymentId: payment.id, amountPaise: payment.amount });
  if (payment.status !== 'captured' || payment.order_id !== order.razorpay_order_id) {
    // Authorised but not yet captured: the payment.captured webhook will finish it.
    return json({ status: 'processing' });
  }
  if (await orders.markPaid(env, order, { paymentId: payment.id, amountPaise: payment.amount })) {
    ctx.waitUntil(orders.fulfil(env, order.id));
  }
  return json({ status: 'paid' });
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
  await orders.logPaymentEvent(env, {
    orderId: order?.id, source: 'webhook', event: evt.event,
    paymentId: payment?.id, amountPaise: payment?.amount, payload: raw,
  });
  // Always 200 for a verified event we can't match, or Razorpay retries for a day.
  if (!order) return json({ ok: true, matched: false });

  if ((evt.event === 'payment.captured' || evt.event === 'order.paid') && payment?.status === 'captured') {
    try {
      if (await orders.markPaid(env, order, { paymentId: payment.id, amountPaise: payment.amount })) {
        ctx.waitUntil(orders.fulfil(env, order.id));
      }
    } catch (e) {
      console.error('webhook markPaid:', e.message);   // amount mismatch: left for a human, logged above
    }
  }
  return json({ ok: true });
}

async function orderPage(env, n, token) {
  const order = await orders.getByNumber(env, n);
  if (!order || !(await buyerCanSee(env, order, token))) return json({ error: 'not found' }, 404);
  return json({ order: orders.publicView(order) });
}

async function admin(request, env, ctx, parts) {
  if (!isAdmin(request, env)) return json({ error: 'unauthorised' }, 401);
  const [, , , n, action] = parts;   // ['api', 'admin', 'orders', n?, action?]
  if (request.method === 'GET' && !n) {
    const url = new URL(request.url);
    const status = url.searchParams.get('status');
    const stmt = status
      ? env.DB.prepare('SELECT * FROM orders WHERE status = ? ORDER BY id DESC LIMIT 200').bind(status)
      : env.DB.prepare("SELECT * FROM orders WHERE status != 'created' OR created_at > datetime('now','-2 days') ORDER BY id DESC LIMIT 200");
    return json({ orders: (await stmt.all()).results });
  }
  const order = n && (await orders.getByNumber(env, n));
  if (!order) return json({ error: 'not found' }, 404);
  if (request.method === 'GET' && !action) {
    const ev = await env.DB.prepare('SELECT source, event, payment_id, amount_paise, received_at FROM payment_events WHERE order_id = ? ORDER BY id').bind(order.id).all();
    return json({ order, payment_events: ev.results });
  }
  if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405);

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
    // Clear the attempt counter so the cron picks it up again too.
    await env.DB.prepare('UPDATE orders SET fulfil_attempts = 0 WHERE id = ?').bind(order.id).run();
    return json({ ok: true, result: await orders.fulfil(env, order.id) });
  }
  return json({ error: 'unknown action' }, 404);
}

// ------------------------------------------------------------------------ entry

async function route(request, env, ctx) {
  const url = new URL(request.url);
  const parts = url.pathname.replace(/\/+$/, '').split('/');   // ['', 'api', ...]
  const m = request.method;
  const [, , a, b, c] = parts;

  if (a === 'products' && m === 'GET') return products(env);
  if (a === 'quote' && m === 'POST') return quoteHandler(request, env);
  if (a === 'orders' && !b && m === 'POST') return createOrderHandler(request, env);
  if (a === 'orders' && b && c === 'confirm' && m === 'POST') return confirmHandler(request, env, ctx, b);
  if (a === 'orders' && b && !c && m === 'GET') return orderPage(env, b, url.searchParams.get('t'));
  if (a === 'webhooks' && b === 'razorpay' && m === 'POST') return webhookHandler(request, env, ctx);
  if (a === 'admin' && b === 'orders') return admin(request, env, ctx, parts.slice(1));
  return json({ error: 'not found' }, 404);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    try {
      return await route(request, env, ctx);
    } catch (e) {
      console.error(`${request.method} ${url.pathname}:`, e.stack || e.message);
      return json({ error: e.status ? e.message : 'Something went wrong. Please try again.' }, e.status || 500);
    }
  },

  // Every 15 minutes: finish any paid order whose invoice or emails failed.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(orders.retryUnfinished(env).then(r => r.length && console.log('retried', JSON.stringify(r))));
  },
};
