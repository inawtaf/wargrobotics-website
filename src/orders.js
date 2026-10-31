import { PRODUCTS, COUPON } from './config.js';
import { quoteCart } from './pricing.js';
import { nowIso, nowSec, newOrderNumber, orderToken } from './util.js';
import * as razorpay from './razorpay.js';
import * as zoho from './zoho.js';
import * as email from './email.js';
import { addEvent } from './fulfilment.js';
import { billingOf, placeOfSupply } from './billing.js';
export { billingOf, placeOfSupply };

const sellerState = env => env.SELLER_STATE || 'GA';

// Coupon uses left: paid orders on which the coupon took money off count
// (cancelled ones too, so a cancel can't be used to reopen it). Unpaid don't.
export async function couponUsesLeft(env) {
  const r = await env.DB.prepare(`SELECT COUNT(*) AS n FROM orders WHERE coupon_code = ? AND coupon_discount_paise > 0
    AND status IN ('paid','processing','shipped','delivered','cancelled','refunded')`).bind(COUPON.code).first();
  return Math.max(0, COUPON.maxOrders - r.n);
}

// couponCode: what the buyer applied at checkout (or nothing).
export async function quoteItems(env, items, buyerState, couponCode = null) {
  const usesLeft = couponCode ? await couponUsesLeft(env) : 0;
  return quoteCart({ items, buyerState, sellerState: sellerState(env), coupon: { code: couponCode, usesLeft } });
}

export const getByNumber = (env, n) => env.DB.prepare('SELECT * FROM orders WHERE order_number = ?').bind(n).first();
export const getByRazorpayOrder = (env, id) => env.DB.prepare('SELECT * FROM orders WHERE razorpay_order_id = ?').bind(id).first();
export const getItems = async (env, orderId) =>
  (await env.DB.prepare('SELECT sku, product_name, quantity, price_type, unit_price_paise, subtotal_paise, gst_paise, discount_paise, discount_label FROM order_items WHERE order_id = ? ORDER BY id').bind(orderId).all()).results;

// Saves the order and its lines, then asks Razorpay for an order to pay against.
// user: the signed-in account; items: validated cart lines;
// a: checkoutAddresses() result { delivery, billing, gstin, business_name, place_of_supply }.
export async function createOrder(env, user, items, a, couponCode = null) {
  const { delivery: d, billing: bl } = a;
  const q = await quoteItems(env, items, a.place_of_supply, couponCode);
  let orderNumber, orderId;
  for (let i = 0; i < 5; i++) {
    orderNumber = newOrderNumber();
    try {
      const row = await env.DB.prepare(`INSERT INTO orders (
          order_number, user_id, item_count, summary, subtotal_paise, gst_rate_bp, gst_paise, total_paise, tax_kind,
          customer_name, email, phone, address_line1, address_line2, city, state_code, pincode, gstin, business_name,
          billing_name, billing_phone, billing_line1, billing_line2, billing_city, billing_state_code, billing_pincode, place_of_supply,
          list_subtotal_paise, combo_discount_paise, coupon_code, coupon_discount_paise)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id`).bind(
        orderNumber, user.id, q.itemCount, q.summary, q.subtotalPaise, q.gstRateBp, q.gstPaise, q.totalPaise, q.taxKind,
        d.name, user.email, d.phone, d.address_line1, d.address_line2 ?? null, d.city, d.state_code, d.pincode,
        a.gstin ?? null, a.business_name ?? null,
        bl.name, bl.phone ?? null, bl.address_line1, bl.address_line2 ?? null, bl.city, bl.state_code, bl.pincode, a.place_of_supply,
        q.listSubtotalPaise, q.comboDiscountPaise, q.couponDiscountPaise ? q.coupon.code : null, q.couponDiscountPaise
      ).first();
      orderId = row.id;
      break;
    } catch (e) {
      if (!String(e.message).includes('UNIQUE') || i === 4) throw e;   // order number clash: try another
    }
  }
  await env.DB.batch(q.lines.map(l => env.DB.prepare(
    'INSERT INTO order_items (order_id, sku, product_name, quantity, price_type, unit_price_paise, subtotal_paise, gst_paise, discount_paise, discount_label) VALUES (?,?,?,?,?,?,?,?,?,?)'
  ).bind(orderId, l.sku, l.productName, l.quantity, l.priceType, l.unitPricePaise, l.subtotalPaise, l.gstPaise, l.discountPaise, l.discountLabel)));

  const rzp = await razorpay.createOrder(env, {
    amountPaise: q.totalPaise,
    receipt: orderNumber,
    notes: { order_number: orderNumber, items: q.summary.slice(0, 250) },
  });
  await env.DB.prepare('UPDATE orders SET razorpay_order_id = ?, updated_at = ? WHERE id = ?').bind(rzp.id, nowIso(), orderId).run();

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
  if (r.meta.changes !== 1) return false;
  await addEvent(env, order.id, { status: 'paid', message: `Payment received (Razorpay ${paymentId}).`, visible: true });
  // Bought: empty the cart of the products in this order.
  if (order.user_id) {
    await env.DB.prepare('DELETE FROM cart_items WHERE user_id = ? AND sku IN (SELECT sku FROM order_items WHERE order_id = ?)')
      .bind(order.user_id, order.id).run();
  }
  return true;
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
export const setFields = (env, id, fields) => {
  const keys = Object.keys(fields);
  return env.DB.prepare(`UPDATE orders SET ${keys.map(k => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
    .bind(...keys.map(k => fields[k]), nowIso(), id).run();
};

// The order row plus what templates and Zoho need.
async function loadFull(env, orderId) {
  const o = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(orderId).first();
  if (!o) return null;
  o.items = (await getItems(env, o.id)).map(i => ({ ...i, zohoItemVar: PRODUCTS[i.sku]?.zohoItemVar }));
  o.link_token = await orderToken(env, o.order_number);
  return o;
}

export async function fulfil(env, orderId) {
  if (!(await takeLock(env, orderId))) return { skipped: 'locked' };
  const result = {};
  try {
    const o = await loadFull(env, orderId);
    if (!o || o.status === 'created' || o.status === 'cancelled') return { skipped: o?.status || 'missing' };

    // 1. GST invoice in Zoho Books
    if (!o.zoho_invoice_id) {
      try {
        const inv = await zoho.createPaidInvoice(env, o);
        await setFields(env, o.id, { zoho_contact_id: inv.contactId, zoho_invoice_id: inv.invoiceId, invoice_number: inv.invoiceNumber, invoice_error: null });
        Object.assign(o, { zoho_contact_id: inv.contactId, zoho_invoice_id: inv.invoiceId, invoice_number: inv.invoiceNumber });
        result.invoice = inv.invoiceNumber;
        await addEvent(env, o.id, { kind: 'note', message: `GST invoice ${inv.invoiceNumber} created in Zoho Books.` });
      } catch (e) {
        console.error(`invoice failed for ${o.order_number}:`, e.message);
        await setFields(env, o.id, { invoice_error: e.message.slice(0, 500) });
        result.invoiceError = e.message;
      }
    }

    let pdf = null;
    if (o.zoho_invoice_id && !o.invoice_sent_at) {
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
        await addEvent(env, o.id, { kind: 'email', message: `Emailed: ${m.subject}${pdf ? ' (invoice attached)' : ''}` });
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
    WHERE status IN ('paid','processing','shipped','delivered') AND fulfil_attempts < 20
      AND (zoho_invoice_id IS NULL OR confirmation_sent_at IS NULL OR invoice_sent_at IS NULL
           OR (team_notified_at IS NULL AND ? = 1))
    ORDER BY id LIMIT 20`).bind(env.ORDER_NOTIFY_EMAIL ? 1 : 0).all();
  const out = [];
  for (const r of results) out.push({ id: r.id, ...(await fulfil(env, r.id)) });
  return out;
}

// What the buyer may see: no internal ids, no errors.
export function publicView(o, items) {
  return {
    order_number: o.order_number,
    status: o.status,
    summary: o.summary,
    item_count: o.item_count,
    items: (items || []).map(i => ({ sku: i.sku, product_name: i.product_name, quantity: i.quantity, price_type: i.price_type, unit_price_paise: i.unit_price_paise, discount_paise: i.discount_paise || 0, discount_label: i.discount_label || null, subtotal_paise: i.subtotal_paise })),
    list_subtotal_paise: o.list_subtotal_paise ?? o.subtotal_paise,
    combo_discount_paise: o.combo_discount_paise || 0,
    coupon_code: o.coupon_code || null,
    coupon_discount_paise: o.coupon_discount_paise || 0,
    subtotal_paise: o.subtotal_paise,
    gst_paise: o.gst_paise,
    tax_kind: o.tax_kind,
    total_paise: o.total_paise,
    customer_name: o.customer_name,
    phone: o.phone,
    address_line1: o.address_line1,
    address_line2: o.address_line2,
    city: o.city,
    state_code: o.state_code,
    pincode: o.pincode,
    gstin: o.gstin,
    business_name: o.business_name,
    billing: billingOf(o),
    place_of_supply: placeOfSupply(o),
    invoice_number: o.invoice_number,
    courier: o.courier,
    tracking_number: o.tracking_number,
    tracking_url: o.tracking_url,
    expected_delivery: o.expected_delivery,
    cancel_reason: o.cancel_reason,
    created_at: o.created_at,
    paid_at: o.paid_at,
    processing_at: o.processing_at,
    shipped_at: o.shipped_at,
    delivered_at: o.delivered_at,
    cancelled_at: o.cancelled_at,
  };
}
