// Order portal API (/admin page). Staff sign in with their normal Warg account;
// access is for confirmed emails listed in ADMIN_EMAILS. An ADMIN_TOKEN bearer
// header also works, for scripts.

import { json, readJson, safeEqual } from './util.js';
import { STATE_BY_CODE, PRODUCTS } from './config.js';
import { quoteCart } from './pricing.js';
import * as orders from './orders.js';
import * as fulfil from './fulfilment.js';
import * as account from './account.js';
import { sameOrigin, isStaff } from './auth.js';
import * as health from './health.js';

function bearerOk(request, env) {
  const h = request.headers.get('authorization') || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  return Boolean(env.ADMIN_TOKEN) && env.ADMIN_TOKEN.length >= 24 && safeEqual(token, env.ADMIN_TOKEN);
}

// Returns the actor name (staff email or 'api-token'), or a Response to send back.
export function authorise(request, env, user) {
  if (bearerOk(request, env)) return 'api-token';
  if (!user) return json({ error: 'Please sign in.', code: 'signin' }, 401);
  if (!isStaff(env, user)) return json({ error: 'This account does not have portal access.', code: 'forbidden' }, 403);
  if (request.method !== 'GET' && !sameOrigin(request, env)) return json({ error: 'Cross-site request refused.' }, 403);
  return user.email;
}

// ---------------------------------------------------------------- queries

const SEARCHABLE = ['o.order_number', 'o.email', 'o.customer_name', 'o.business_name', 'o.gstin', 'o.phone', 'o.invoice_number', 'o.tracking_number', 'o.pincode', 'o.city'];

function whereFor(url) {
  const where = [], args = [];
  const status = url.searchParams.get('status');
  if (status === 'open') where.push("o.status IN ('paid','processing')");
  else if (status === 'unpaid') where.push("o.status = 'created'");
  else if (status === 'attention') where.push("o.status NOT IN ('created','cancelled') AND ((o.invoice_error IS NOT NULL AND o.zoho_invoice_id IS NULL) OR (o.email_error IS NOT NULL AND o.confirmation_sent_at IS NULL))");
  else if (status) { where.push('o.status = ?'); args.push(status); }
  else where.push("o.status != 'created'");                 // default: everything that was paid
  const q = (url.searchParams.get('q') || '').trim().slice(0, 80);
  if (q) { where.push(`(${SEARCHABLE.map(c => `${c} LIKE ?`).join(' OR ')})`); args.push(...SEARCHABLE.map(() => `%${q}%`)); }
  const from = url.searchParams.get('from'), to = url.searchParams.get('to');
  if (/^\d{4}-\d{2}-\d{2}$/.test(from || '')) { where.push('COALESCE(o.paid_at, o.created_at) >= ?'); args.push(from); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(to || '')) { where.push('COALESCE(o.paid_at, o.created_at) < date(?, \'+1 day\')'); args.push(to); }
  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', args };
}

// Headline numbers for the top of the portal.
export async function summary(env) {
  const counts = await env.DB.prepare('SELECT status, COUNT(*) AS n FROM orders GROUP BY status').all();
  const by = Object.fromEntries(counts.results.map(r => [r.status, r.n]));
  const month = await env.DB.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(total_paise),0) AS paise FROM orders
    WHERE status IN ('paid','processing','shipped','delivered') AND paid_at >= strftime('%Y-%m-01T00:00:00Z','now')`).first();
  const late = await env.DB.prepare(`SELECT COUNT(*) AS n FROM orders WHERE status = 'paid' AND paid_at < strftime('%Y-%m-%dT%H:%M:%SZ','now','-2 days')`).first();
  const overdue = await env.DB.prepare(`SELECT COUNT(*) AS n FROM orders WHERE status = 'shipped' AND expected_delivery IS NOT NULL AND expected_delivery < date('now')`).first();
  const problems = await env.DB.prepare(`SELECT COUNT(*) AS n FROM orders WHERE status != 'created' AND status != 'cancelled' AND (invoice_error IS NOT NULL AND zoho_invoice_id IS NULL OR email_error IS NOT NULL AND confirmation_sent_at IS NULL)`).first();
  const service = await env.DB.prepare("SELECT COUNT(*) AS n FROM service_requests WHERE status IN ('open','in_progress')").first();
  const openCarts = await env.DB.prepare('SELECT COUNT(DISTINCT user_id) AS n FROM cart_items').first();
  return json({
    to_process: by.paid || 0, processing: by.processing || 0, shipped: by.shipped || 0, delivered: by.delivered || 0,
    cancelled: by.cancelled || 0, unpaid: by.created || 0,
    waiting_over_2_days: late.n, past_expected_delivery: overdue.n, needs_attention: problems.n, open_service: service.n, open_carts: openCarts.n,
    this_month: { orders: month.n, revenue_paise: month.paise },
    couriers: fulfil.COURIERS,
  });
}

export async function list(request, env) {
  const url = new URL(request.url);
  const { sql, args } = whereFor(url);
  const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
  const rows = await env.DB.prepare(`SELECT o.order_number, o.status, o.summary, o.item_count, o.total_paise, o.customer_name, o.email, o.phone,
      o.city, o.state_code, o.invoice_number, o.invoice_error, o.email_error, o.courier, o.tracking_number, o.expected_delivery,
      o.created_at, o.paid_at, o.processing_at, o.shipped_at, o.delivered_at
    FROM orders o ${sql} ORDER BY o.id DESC LIMIT 51 OFFSET ?`).bind(...args, (page - 1) * 50).all();
  const results = rows.results;
  return json({ orders: results.slice(0, 50), page, more: results.length > 50 });
}

const csvCell = v => {
  const s = v === null || v === undefined ? '' : String(v);
  // Leading = + - @ would run as a formula in Excel / Sheets: neutralise.
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export async function csv(request, env) {
  const url = new URL(request.url);
  const { sql, args } = whereFor(url);
  const { results } = await env.DB.prepare(`SELECT o.*, (SELECT group_concat(i.product_name || ' x' || i.quantity, '; ') FROM order_items i WHERE i.order_id = o.id) AS items
    FROM orders o ${sql} ORDER BY o.id DESC LIMIT 5000`).bind(...args).all();
  const cols = [
    ['Order', 'order_number'], ['Status', 'status'], ['Paid at', 'paid_at'], ['Items', 'items'], ['Units', 'item_count'],
    ['List price total (INR)', r => ((r.list_subtotal_paise ?? r.subtotal_paise) / 100).toFixed(2)],
    ['Combo discount (INR)', r => ((r.combo_discount_paise || 0) / 100).toFixed(2)],
    ['Coupon', 'coupon_code'], ['Coupon discount (INR)', r => ((r.coupon_discount_paise || 0) / 100).toFixed(2)],
    ['Subtotal after discounts (INR)', r => (r.subtotal_paise / 100).toFixed(2)], ['GST (INR)', r => (r.gst_paise / 100).toFixed(2)],
    ['Total (INR)', r => (r.total_paise / 100).toFixed(2)], ['Tax', r => (r.tax_kind === 'intra' ? 'CGST+SGST' : 'IGST')],
    ['Invoice', 'invoice_number'], ['Customer', 'customer_name'], ['Business', 'business_name'], ['GSTIN', 'gstin'],
    ['Email', 'email'], ['Phone', 'phone'], ['Address', r => [r.address_line1, r.address_line2].filter(Boolean).join(', ')],
    ['City', 'city'], ['State', r => STATE_BY_CODE[r.state_code]?.name || r.state_code], ['Pincode', 'pincode'],
    ['Billing name', r => r.billing_name || r.customer_name],
    ['Billing address', r => (r.billing_line1 ? [r.billing_line1, r.billing_line2, r.billing_city, r.billing_pincode].filter(Boolean).join(', ') : 'same as delivery')],
    ['Billing state', r => (r.billing_state_code ? STATE_BY_CODE[r.billing_state_code]?.name || r.billing_state_code : '')],
    ['Place of supply', r => STATE_BY_CODE[r.place_of_supply || r.state_code]?.name || r.place_of_supply || r.state_code],
    ['Courier', 'courier'], ['Tracking', 'tracking_number'], ['Expected delivery', 'expected_delivery'],
    ['Processing at', 'processing_at'], ['Shipped at', 'shipped_at'], ['Delivered at', 'delivered_at'],
    ['Cancelled at', 'cancelled_at'], ['Cancel reason', 'cancel_reason'], ['Razorpay payment', 'razorpay_payment_id'],
  ];
  const lines = [cols.map(c => c[0]).join(',')];
  for (const r of results) lines.push(cols.map(([, k]) => csvCell(typeof k === 'function' ? k(r) : r[k])).join(','));
  const name = `warg-orders-${new Date().toISOString().slice(0, 10)}.csv`;
  return new Response('﻿' + lines.join('\r\n'), {
    headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${name}"`, 'cache-control': 'no-store' },
  });
}

export async function detail(env, order) {
  const [items, timeline, payments, service] = await Promise.all([
    orders.getItems(env, order.id),
    fulfil.events(env, order.id),
    env.DB.prepare('SELECT source, event, payment_id, amount_paise, received_at FROM payment_events WHERE order_id = ? ORDER BY id').bind(order.id).all(),
    env.DB.prepare('SELECT request_number, kind, subject, status, updated_at FROM service_requests WHERE order_id = ? ORDER BY id DESC').bind(order.id).all(),
  ]);
  const acct = order.user_id ? await env.DB.prepare('SELECT id, email, email_verified_at, created_at FROM users WHERE id = ?').bind(order.user_id).first() : null;
  const others = order.user_id
    ? (await env.DB.prepare("SELECT COUNT(*) AS n FROM orders WHERE user_id = ? AND id != ? AND status != 'created'").bind(order.user_id, order.id).first()).n
    : 0;
  return json({ order: { ...order, items }, timeline, payment_events: payments.results, service_requests: service.results, customer_other_orders: others,
    account: acct && { id: acct.id, email: acct.email, email_verified: Boolean(acct.email_verified_at), signed_up_at: acct.created_at } });
}

// ---------------------------------------------------------------- carts
// Signed-in customers with something in their cart: who is close to buying and
// what stops them. (Signed-out carts live only in the visitor's browser.)
// Stage: email not confirmed (can't pay yet) / started checkout (unpaid order
// after the last cart change) / in cart.
export async function carts(request, env) {
  const url = new URL(request.url);
  const days = Math.min(365, Math.max(0, Number(url.searchParams.get('days')) || 0));
  const { results } = await env.DB.prepare(`SELECT u.id, u.name, u.email, u.phone, u.email_verified_at, u.created_at AS signed_up_at,
      MAX(c.added_at) AS last_activity, SUM(c.quantity) AS units, group_concat(c.sku || ':' || c.quantity) AS lines,
      (SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id AND o.status IN ('paid','processing','shipped','delivered')) AS paid_orders,
      (SELECT MAX(o.created_at) FROM orders o WHERE o.user_id = u.id AND o.status = 'created') AS last_unpaid_checkout
    FROM cart_items c JOIN users u ON u.id = c.user_id
    ${days ? "WHERE c.added_at >= strftime('%Y-%m-%dT%H:%M:%SZ','now', ?)" : ''}
    GROUP BY u.id ORDER BY last_activity DESC LIMIT 500`).bind(...(days ? [`-${days} days`] : [])).all();
  const rows = results.map(r => {
    const items = String(r.lines || '').split(',').map(x => x.split(':')).filter(([sku]) => PRODUCTS[sku]).map(([sku, q]) => ({ sku, quantity: Number(q) }));
    const q = items.length ? quoteCart({ items, buyerState: null, sellerState: env.SELLER_STATE || 'GA' }) : null;
    const stage = !r.email_verified_at ? 'unverified'
      : r.last_unpaid_checkout && r.last_unpaid_checkout >= r.last_activity ? 'checkout' : 'cart';
    return {
      name: r.name, email: r.email, phone: r.phone, signed_up_at: r.signed_up_at, last_activity: r.last_activity,
      units: r.units, summary: q ? q.summary : '', subtotal_paise: q ? q.subtotalPaise : 0, total_paise: q ? q.totalPaise : 0,
      paid_orders: r.paid_orders, stage,
    };
  });
  const sum = (k, f = () => true) => rows.filter(f).reduce((s, r) => s + (k ? r[k] : 1), 0);
  return json({
    totals: {
      carts: rows.length, units: sum('units'), subtotal_paise: sum('subtotal_paise'),
      unverified: sum(null, r => r.stage === 'unverified'), checkout: sum(null, r => r.stage === 'checkout'), cart: sum(null, r => r.stage === 'cart'),
    },
    carts: rows,
  });
}

// ---------------------------------------------------------------- customers
// Every account: confirmed email or not, how they sign in, what they bought.
export async function customers(request, env) {
  const url = new URL(request.url);
  const where = [], args = [];
  const f = url.searchParams.get('filter');
  if (f === 'unverified') where.push('u.email_verified_at IS NULL');
  if (f === 'verified') where.push('u.email_verified_at IS NOT NULL');
  const q = (url.searchParams.get('q') || '').trim().slice(0, 80);
  if (q) { where.push('(u.email LIKE ? OR u.name LIKE ? OR u.phone LIKE ?)'); args.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  const { results } = await env.DB.prepare(`SELECT u.id, u.name, u.email, u.phone, u.email_verified_at, u.created_at,
      (u.password_hash IS NOT NULL) AS has_password, (u.google_sub IS NOT NULL) AS has_google,
      (SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id AND o.status IN ('paid','processing','shipped','delivered')) AS paid_orders,
      (SELECT COALESCE(SUM(o.total_paise),0) FROM orders o WHERE o.user_id = u.id AND o.status IN ('paid','processing','shipped','delivered')) AS spent_paise,
      (SELECT COALESCE(SUM(c.quantity),0) FROM cart_items c WHERE c.user_id = u.id) AS cart_units
    FROM users u ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY u.id DESC LIMIT 500`).bind(...args).all();
  const totals = await env.DB.prepare('SELECT COUNT(*) AS n, SUM(email_verified_at IS NOT NULL) AS verified FROM users').first();
  return json({
    totals: { accounts: totals.n, verified: totals.verified || 0, unverified: totals.n - (totals.verified || 0) },
    customers: results.map(r => ({ ...r, email_verified: Boolean(r.email_verified_at), has_password: Boolean(r.has_password), has_google: Boolean(r.has_google) })),
  });
}

// ---------------------------------------------------------------- routing

export async function route(request, env, ctx, seg, user) {
  const actor = authorise(request, env, user);
  if (actor instanceof Response) return actor;
  const [kind, id, action] = seg;          // /api/admin/<kind>/<id>/<action>
  const m = request.method;

  if (kind === 'me' && m === 'GET') return json({ actor });
  if (kind === 'health' && m === 'GET') return health.health(env);
  if (kind === 'carts' && m === 'GET') return carts(request, env);
  if (kind === 'customers' && m === 'GET' && !id) return customers(request, env);
  if (kind === 'customers' && m === 'POST' && id && action === 'send-verification') return account.adminSendVerification(env, Number(id));
  if (kind === 'test-email' && m === 'POST') return health.testEmail(request, env, actor);
  if (kind === 'summary' && m === 'GET') return summary(env);
  if (kind === 'orders.csv' && m === 'GET') return csv(request, env);
  if (kind === 'service') {
    if (m === 'GET' && !id) return account.adminListService(request, env);
    if (m === 'POST' && id) return account.adminUpdateService(request, env, ctx, id);
    return json({ error: 'not found' }, 404);
  }
  if (kind !== 'orders') return json({ error: 'not found' }, 404);
  if (m === 'GET' && !id) return list(request, env);

  const order = id && (await orders.getByNumber(env, id));
  if (!order) return json({ error: 'not found' }, 404);
  if (m === 'GET' && !action) return detail(env, order);
  if (m !== 'POST') return json({ error: 'method not allowed' }, 405);

  const b = await readJson(request);
  const opts = { ...b, actor, notify: b.notify !== false };
  switch (action) {
    case 'process': return json(await fulfil.startProcessing(env, order, opts));
    case 'ship':    return json(await fulfil.ship(env, order, opts));
    case 'deliver': return json(await fulfil.deliver(env, order, opts));
    case 'cancel':  return json(await fulfil.cancel(env, order, opts));
    case 'note':    return json(await fulfil.note(env, order, opts));
    case 'resend':  return json(await fulfil.resend(env, order, { actor, which: b.which, to: b.to }));
    case 'retry': {
      await env.DB.prepare('UPDATE orders SET fulfil_attempts = 0 WHERE id = ?').bind(order.id).run();
      return json({ ok: true, result: await orders.fulfil(env, order.id) });
    }
  }
  return json({ error: 'unknown action' }, 404);
}

