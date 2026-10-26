import { PRODUCTS } from './config.js';
import { quote } from './pricing.js';
import { nowIso, nowSec, newOrderNumber, orderToken } from './util.js';
import * as razorpay from './razorpay.js';
import * as zoho from './zoho.js';
import * as email from './email.js';

const sellerState = env => env.SELLER_STATE || 'KA';

// Units already sold at the offer price. Orders still awaiting payment don't count.
export async function unitsSoldAtOffer(env, sku) {
  const row = await env.DB.prepare(
    "SELECT COALESCE(SUM(quantity),0) AS n FROM orders WHERE product_sku = ? AND price_type = 'offer' AND status IN ('paid','shipped','delivered')"
  ).bind(sku).first();
  return row?.n || 0;
}

export async function quoteFor(env, sku, quantity, buyerState) {
  return quote({ sku, quantity, unitsSoldAtOffer: await unitsSoldAtOffer(env, sku), buyerState, sellerState: sellerState(env) });
}

export const getByNumber = (env, n) => env.DB.prepare('SELECT * FROM orders WHERE order_number = ?').bind(n).first();
export const getByRazorpayOrder = (env, id) => env.DB.prepare('SELECT * FROM orders WHERE razorpay_order_id = ?').bind(id).first();

// Saves the order, then asks Razorpay for an order to pay against.
export async function createOrder(env, input) {
  const q = await quoteFor(env, input.sku, input.quantity, input.state_code);
  let orderNumber;
  for (let i = 0; i < 5; i++) {
    orderNumber = newOrderNumber();
    try {
      await env.DB.prepare(`INSERT INTO orders (
          order_number, product_sku, product_name, quantity, price_type, unit_price_paise, subtotal_paise,
          gst_rate_bp, gst_paise, total_paise, tax_kind,
          customer_name, email, phone, address_line1, address_line2, city, state_code, pincode, gstin, business_name)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
        orderNumber, q.sku, q.productName, q.quantity, q.priceType, q.unitPricePaise, q.subtotalPaise,
        q.gstRateBp, q.gstPaise, q.totalPaise, q.taxKind,
        input.name, input.email, input.phone, input.address_line1, input.address_line2, input.city,
        input.state_code, input.pincode, input.gstin, input.business_name
      ).run();
      break;
    } catch (e) {
      if (!String(e.message).includes('UNIQUE') || i === 4) throw e;   // order number clash: try another
    }
  }

  const rzp = await razorpay.createOrder(env, {
    amountPaise: q.totalPaise,
    receipt: orderNumber,
    notes: { order_number: orderNumber, product: q.sku, quantity: String(q.quantity) },
  });
  await env.DB.prepare('UPDATE orders SET razorpay_order_id = ?, updated_at = ? WHERE order_number = ?')
    .bind(rzp.id, nowIso(), orderNumber).run();

  return { orderNumber, quote: q, razorpayOrderId: rzp.id, token: await orderToken(env, orderNumber) };
}

export async function logPaymentEvent(env, { orderId, source, event, paymentId, amountPaise, payload }) {
  await env.DB.prepare('INSERT INTO payment_events (order_id, source, event, payment_id, amount_paise, payload) VALUES (?,?,?,?,?,?)')
    .bind(orderId ?? null, source, event, paymentId ?? null, amountPaise ?? null, payload ? String(payload).slice(0, 8000) : null).run();
}

// created -> paid, exactly once however many times Razorpay tells us.
// Returns true if this call made the change (and so should start fulfilment).
export async function markPaid(env, order, { paymentId, amountPaise }) {
  if (amountPaise !== order.total_paise) {
    throw new Error(`amount mismatch on ${order.order_number}: paid ${amountPaise}, expected ${order.total_paise}`);
  }
  const r = await env.DB.prepare(
    "UPDATE orders SET status = 'paid', razorpay_payment_id = ?, paid_at = ?, updated_at = ? WHERE id = ? AND status = 'created'"
  ).bind(paymentId, nowIso(), nowIso(), order.id).run();
  return r.meta.changes === 1;
}

// ------------------------------------------------------------------ fulfilment
// Runs after payment, and again from the cron for anything left unfinished.
// Each step records its own completion, so a re-run only redoes what failed.

async function takeLock(env, id, seconds = 120) {
  const r = await env.DB.prepare(
    'UPDATE orders SET fulfil_lock_until = ?, fulfil_attempts = fulfil_attempts + 1 WHERE id = ? AND (fulfil_lock_until IS NULL OR fulfil_lock_until < ?)'
  ).bind(nowSec() + seconds, id, nowSec()).run();
  return r.meta.changes === 1;
}
const releaseLock = (env, id) => env.DB.prepare('UPDATE orders SET fulfil_lock_until = NULL WHERE id = ?').bind(id).run();
const setFields = (env, id, fields) => {
  const keys = Object.keys(fields);
  return env.DB.prepare(`UPDATE orders SET ${keys.map(k => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
    .bind(...keys.map(k => fields[k]), nowIso(), id).run();
};

export async function fulfil(env, orderId) {
  if (!(await takeLock(env, orderId))) return { skipped: 'locked' };
  const result = {};
  try {
    let o = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(orderId).first();
    if (!o || o.status === 'created' || o.status === 'cancelled') return { skipped: o?.status || 'missing' };
    o.zohoItemVar = PRODUCTS[o.product_sku].zohoItemVar;
    o.link_token = await orderToken(env, o.order_number);

    // 1. GST invoice in Zoho Books
    if (!o.zoho_invoice_id) {
      try {
        const inv = await zoho.createPaidInvoice(env, o);
        await setFields(env, o.id, { zoho_contact_id: inv.contactId, zoho_invoice_id: inv.invoiceId, invoice_number: inv.invoiceNumber, invoice_error: null });
        Object.assign(o, { zoho_contact_id: inv.contactId, zoho_invoice_id: inv.invoiceId, invoice_number: inv.invoiceNumber });
        result.invoice = inv.invoiceNumber;
      } catch (e) {
        console.error(`invoice failed for ${o.order_number}:`, e.message);
        await setFields(env, o.id, { invoice_error: e.message.slice(0, 500) });
        result.invoiceError = e.message;
      }
    }

    let pdf = null;
    const needPdf = o.zoho_invoice_id && !o.invoice_sent_at;
    if (needPdf) {
      try { pdf = await zoho.invoicePdf(env, o.zoho_invoice_id); }
      catch (e) { console.error(`invoice PDF failed for ${o.order_number}:`, e.message); }
    }
    const attach = pdf ? [email.pdfAttachment(`${o.invoice_number}.pdf`, pdf)] : [];

    // 2. Confirmation to the buyer (invoice attached when we have it)
    if (!o.confirmation_sent_at) {
      try {
        const m = email.confirmationEmail(env, o, { hasInvoice: Boolean(pdf) });
        await email.sendEmail(env, { to: o.email, ...m, attachments: attach, idempotencyKey: `${o.order_number}-confirmation` });
        const fields = { confirmation_sent_at: nowIso(), email_error: null };
        if (pdf) fields.invoice_sent_at = nowIso();
        await setFields(env, o.id, fields);
        Object.assign(o, fields);
        result.confirmation = 'sent';
      } catch (e) {
        console.error(`confirmation email failed for ${o.order_number}:`, e.message);
        await setFields(env, o.id, { email_error: e.message.slice(0, 500) });
        result.emailError = e.message;
      }
    } else if (pdf && !o.invoice_sent_at) {
      // 3. Invoice came later than the confirmation: send it on its own.
      try {
        const m = email.invoiceEmail(env, o);
        await email.sendEmail(env, { to: o.email, ...m, attachments: attach, idempotencyKey: `${o.order_number}-invoice` });
        await setFields(env, o.id, { invoice_sent_at: nowIso() });
        result.invoiceEmail = 'sent';
      } catch (e) {
        await setFields(env, o.id, { email_error: e.message.slice(0, 500) });
        result.emailError = e.message;
      }
    }

    // 4. Tell the team
    if (!o.team_notified_at && env.ORDER_NOTIFY_EMAIL) {
      try {
        const m = email.teamEmail(env, o);
        await email.sendEmail(env, { to: env.ORDER_NOTIFY_EMAIL.split(',').map(s => s.trim()), ...m, replyTo: o.email, idempotencyKey: `${o.order_number}-team` });
        await setFields(env, o.id, { team_notified_at: nowIso() });
      } catch (e) {
        console.error(`team email failed for ${o.order_number}:`, e.message);
      }
    }
    return result;
  } finally {
    await releaseLock(env, orderId);
  }
}

// Cron: retry paid orders that are missing an invoice or an email.
// Gives up after 20 attempts so a permanent error doesn't loop for ever.
export async function retryUnfinished(env) {
  const { results } = await env.DB.prepare(`SELECT id FROM orders
    WHERE status IN ('paid','shipped','delivered') AND fulfil_attempts < 20
      AND (zoho_invoice_id IS NULL OR confirmation_sent_at IS NULL OR invoice_sent_at IS NULL
           OR (team_notified_at IS NULL AND ? = 1))
    ORDER BY id LIMIT 20`).bind(env.ORDER_NOTIFY_EMAIL ? 1 : 0).all();
  const out = [];
  for (const r of results) out.push({ id: r.id, ...(await fulfil(env, r.id)) });
  return out;
}

export async function markShipped(env, order, { courier, tracking_number, tracking_url }) {
  await setFields(env, order.id, { status: 'shipped', courier, tracking_number, tracking_url: tracking_url || null, shipped_at: nowIso() });
  const o = { ...order, status: 'shipped', courier, tracking_number, tracking_url: tracking_url || null };
  o.link_token = await orderToken(env, o.order_number);
  const m = email.dispatchEmail(env, o);
  await email.sendEmail(env, { to: o.email, ...m, idempotencyKey: `${o.order_number}-dispatch-${tracking_number}` });
  await setFields(env, order.id, { dispatch_sent_at: nowIso() });
}

export async function markDelivered(env, order) {
  await setFields(env, order.id, { status: 'delivered', delivered_at: nowIso() });
}

// What the buyer's order page may see: no internal ids, no errors.
export function publicView(o) {
  return {
    order_number: o.order_number,
    status: o.status,
    product_name: o.product_name,
    quantity: o.quantity,
    unit_price_paise: o.unit_price_paise,
    subtotal_paise: o.subtotal_paise,
    gst_paise: o.gst_paise,
    tax_kind: o.tax_kind,
    total_paise: o.total_paise,
    customer_name: o.customer_name,
    city: o.city,
    state_code: o.state_code,
    pincode: o.pincode,
    invoice_number: o.invoice_number,
    courier: o.courier,
    tracking_number: o.tracking_number,
    tracking_url: o.tracking_url,
    created_at: o.created_at,
    paid_at: o.paid_at,
    shipped_at: o.shipped_at,
    delivered_at: o.delivered_at,
  };
}
