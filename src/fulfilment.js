// After payment: the steps staff take in the order portal, each one recorded
// on the order's timeline and (unless switched off) emailed to the customer.
//
//   paid ──process──► processing ──ship──► shipped ──deliver──► delivered
//     │                   │                  ▲  (ship again = update tracking)
//     └──────cancel───────┴──► cancelled     │
//
// Every transition is a guarded UPDATE (… WHERE status IN (allowed)), so two
// people clicking at once can't both move the same order.

import { nowIso, orderToken, httpError } from './util.js';
import * as email from './email.js';

export const COURIERS = ['Delhivery', 'Blue Dart', 'DTDC', 'Ekart', 'Xpressbees', 'Shadowfax', 'India Post', 'Shiprocket', 'Other'];

export async function addEvent(env, orderId, { kind = 'status', status = null, message = null, actor = 'system', visible = false }) {
  await env.DB.prepare('INSERT INTO order_events (order_id, kind, status, message, actor, visible) VALUES (?,?,?,?,?,?)')
    .bind(orderId, kind, status, message, actor, visible ? 1 : 0).run();
}

export async function events(env, orderId, { visibleOnly = false } = {}) {
  const { results } = await env.DB.prepare(
    `SELECT kind, status, message, actor, visible, created_at FROM order_events WHERE order_id = ? ${visibleOnly ? 'AND visible = 1' : ''} ORDER BY id`
  ).bind(orderId).all();
  return visibleOnly ? results.map(({ kind, status, message, created_at }) => ({ kind, status, message, created_at })) : results;
}

async function load(env, orderId) {
  const o = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(orderId).first();
  o.items = (await env.DB.prepare('SELECT sku, product_name, quantity, price_type, unit_price_paise, subtotal_paise FROM order_items WHERE order_id = ? ORDER BY id').bind(orderId).all()).results;
  o.link_token = await orderToken(env, o.order_number);
  return o;
}

async function transition(env, order, from, to, fields) {
  const keys = Object.keys(fields);
  const r = await env.DB.prepare(
    `UPDATE orders SET status = ?, ${keys.map(k => `${k} = ?`).join(', ')}${keys.length ? ',' : ''} updated_at = ?
     WHERE id = ? AND status IN (${from.map(() => '?').join(',')})`
  ).bind(to, ...keys.map(k => fields[k]), nowIso(), order.id, ...from).run();
  if (r.meta.changes !== 1) {
    const now = await env.DB.prepare('SELECT status FROM orders WHERE id = ?').bind(order.id).first();
    throw httpError(409, `Order is ${now?.status}; it can't be moved to ${to} from there.`);
  }
}

// Sends the status email and records it on the timeline. A failed email never
// undoes the status change; it is recorded so staff can press "Resend".
async function notify(env, o, template, { actor, message, key }) {
  try {
    const m = template(env, o, { message });
    await email.sendEmail(env, { to: o.email, ...m, idempotencyKey: key });
    await addEvent(env, o.id, { kind: 'email', message: `Emailed: ${m.subject}`, actor });
    return true;
  } catch (e) {
    console.error(`email failed for ${o.order_number}:`, e.message);
    await addEvent(env, o.id, { kind: 'email', message: `Email FAILED (${e.message.slice(0, 120)})`, actor });
    return false;
  }
}

const cleanMessage = m => (typeof m === 'string' ? m.replace(/\r/g, '').trim().slice(0, 1000) : '') || null;

// ---------------------------------------------------------------- actions

export async function startProcessing(env, order, { actor, message, notify: send = true }) {
  message = cleanMessage(message);
  await transition(env, order, ['paid'], 'processing', { processing_at: nowIso() });
  await addEvent(env, order.id, { status: 'processing', message: message || 'We are testing and packing your order.', actor, visible: true });
  const o = await load(env, order.id);
  const emailed = send ? await notify(env, o, email.processingEmail, { actor, message, key: `${o.order_number}-processing` }) : null;
  return { status: 'processing', emailed };
}

export async function ship(env, order, { actor, courier, tracking_number, tracking_url, expected_delivery, message, notify: send = true }) {
  courier = String(courier || '').trim().slice(0, 60);
  tracking_number = String(tracking_number || '').trim().slice(0, 60);
  tracking_url = String(tracking_url || '').trim().slice(0, 300) || null;
  expected_delivery = String(expected_delivery || '').trim() || null;
  message = cleanMessage(message);
  if (!courier || !tracking_number) throw httpError(422, 'Courier and tracking number are required.');
  if (tracking_url && !/^https:\/\/[^\s]+$/.test(tracking_url)) throw httpError(422, 'The tracking link must start with https://');
  if (expected_delivery && !/^\d{4}-\d{2}-\d{2}$/.test(expected_delivery)) throw httpError(422, 'Expected delivery must be a date.');

  const updating = order.status === 'shipped';
  await transition(env, order, ['paid', 'processing', 'shipped'], 'shipped', {
    courier, tracking_number, tracking_url, expected_delivery, shipped_at: order.shipped_at || nowIso(),
  });
  await addEvent(env, order.id, {
    status: 'shipped', actor, visible: true,
    message: `${updating ? 'Tracking updated' : 'Shipped'} with ${courier}, tracking ${tracking_number}${expected_delivery ? `, expected ${expected_delivery}` : ''}.${message ? ' ' + message : ''}`,
  });
  const o = await load(env, order.id);
  const emailed = send ? await notify(env, o, email.dispatchEmail, { actor, message, key: `${o.order_number}-dispatch-${tracking_number}` }) : null;
  if (emailed) await env.DB.prepare('UPDATE orders SET dispatch_sent_at = ? WHERE id = ?').bind(nowIso(), o.id).run();
  return { status: 'shipped', emailed };
}

export async function deliver(env, order, { actor, message, notify: send = true }) {
  message = cleanMessage(message);
  await transition(env, order, ['shipped'], 'delivered', { delivered_at: nowIso() });
  await addEvent(env, order.id, { status: 'delivered', message: message || 'Delivered.', actor, visible: true });
  const o = await load(env, order.id);
  const emailed = send ? await notify(env, o, email.deliveredEmail, { actor, message, key: `${o.order_number}-delivered` }) : null;
  return { status: 'delivered', emailed };
}

// Cancelling a paid order does NOT move money: issue the refund in the
// Razorpay dashboard and a credit note in Zoho Books. The email tells the
// customer a refund is on its way, so do both straight after.
export async function cancel(env, order, { actor, reason, notify: send = true }) {
  reason = cleanMessage(reason);
  if (!reason) throw httpError(422, 'Give a reason; the customer sees it.');
  const wasPaid = ['paid', 'processing'].includes(order.status);
  await transition(env, order, ['created', 'paid', 'processing'], 'cancelled', { cancelled_at: nowIso(), cancel_reason: reason });
  await addEvent(env, order.id, { status: 'cancelled', message: reason, actor, visible: true });
  if (wasPaid) await addEvent(env, order.id, { kind: 'note', message: 'Refund still to do: issue it in Razorpay, and a credit note in Zoho Books.', actor: 'system' });
  const o = await load(env, order.id);
  const emailed = send && wasPaid ? await notify(env, o, email.cancelledEmail, { actor, message: reason, key: `${o.order_number}-cancelled` }) : null;
  return { status: 'cancelled', emailed, refund_needed: wasPaid };
}

export async function note(env, order, { actor, message }) {
  message = cleanMessage(message);
  if (!message) throw httpError(422, 'Write a note first.');
  await addEvent(env, order.id, { kind: 'note', message, actor });
  return { ok: true };
}

// Re-sends the email for a stage (for "I never got it" or after an email failure).
const RESEND = {
  confirmation: (o, env) => email.confirmationEmail(env, o, { hasInvoice: false }),
  processing: (o, env) => email.processingEmail(env, o, {}),
  dispatch: (o, env) => email.dispatchEmail(env, o, {}),
  delivered: (o, env) => email.deliveredEmail(env, o, {}),
};
export async function resend(env, order, { actor, which }) {
  if (!RESEND[which]) throw httpError(422, 'Choose which email to resend.');
  if (which === 'dispatch' && !order.tracking_number) throw httpError(409, 'This order has no tracking details yet.');
  const o = await load(env, order.id);
  const ok = await notify(env, o, (e, ord) => RESEND[which](ord, e), { actor, key: `${o.order_number}-${which}-resend-${Date.now()}` });
  if (!ok) throw httpError(502, 'The email could not be sent. Check the timeline for the reason.');
  return { ok: true };
}
