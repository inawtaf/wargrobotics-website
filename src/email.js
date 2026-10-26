// Transactional email through Resend (https://resend.com/docs/api-reference/emails/send-email).
// The wording lives in this file: edit the templates below to change what buyers read.

import { escapeHtml as h, inr, base64FromBytes } from './util.js';
import { STATE_BY_CODE } from './config.js';

const base = env => env.RESEND_API_BASE || 'https://api.resend.com';

// idempotencyKey makes Resend drop a repeat of the same email for 24 hours,
// so a retry after a timeout never sends the buyer two copies.
export async function sendEmail(env, { to, subject, html, text, attachments, idempotencyKey, replyTo }) {
  if (!env.RESEND_API_KEY) throw new Error('RESEND_API_KEY is not set');
  const res = await fetch(`${base(env)}/emails`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      'content-type': 'application/json',
      ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM || 'Warg Robotics <orders@wargrobotics.com>',
      to: Array.isArray(to) ? to : [to],
      reply_to: replyTo || env.EMAIL_REPLY_TO || 'hello@wargrobotics.com',
      subject,
      html,
      text,
      ...(attachments?.length ? { attachments } : {}),
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Resend: ${data.message || data.name || `HTTP ${res.status}`}`);
  return data.id;
}

export const pdfAttachment = (filename, bytes) => ({ filename, content: base64FromBytes(bytes) });

// ---------------------------------------------------------------- layout

function layout(title, bodyHtml) {
  return `<!doctype html><html><body style="margin:0;background:#f4f5f7;font-family:Inter,Segoe UI,Arial,sans-serif;color:#16171c">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:8px;overflow:hidden">
<tr><td style="background:#0a0a0d;padding:20px 28px;color:#ffffff;font-weight:700;font-size:18px;letter-spacing:.04em">WARG ROBOTICS</td></tr>
<tr><td style="padding:28px">
<h1 style="margin:0 0 16px;font-size:22px;line-height:1.3">${h(title)}</h1>
${bodyHtml}
</td></tr>
<tr><td style="padding:18px 28px;border-top:1px solid #e6e7eb;font-size:12px;color:#6b6e78">
Warg Robotics · Indiranagar, Bengaluru · <a href="mailto:hello@wargrobotics.com" style="color:#6b6e78">hello@wargrobotics.com</a>
</td></tr></table></td></tr></table></body></html>`;
}

const p = s => `<p style="margin:0 0 14px;font-size:15px;line-height:1.6">${s}</p>`;
const btn = (href, label) =>
  `<p style="margin:20px 0"><a href="${h(href)}" style="display:inline-block;background:#2a00ff;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:4px">${h(label)}</a></p>`;

function orderTable(o) {
  const row = (k, v, bold) =>
    `<tr><td style="padding:6px 0;font-size:14px;color:#4a4d57">${k}</td><td align="right" style="padding:6px 0;font-size:14px;${bold ? 'font-weight:700' : ''}">${v}</td></tr>`;
  const tax = o.tax_kind === 'intra'
    ? row('CGST 9%', inr(Math.floor(o.gst_paise / 2))) + row('SGST 9%', inr(o.gst_paise - Math.floor(o.gst_paise / 2)))
    : row('IGST 18%', inr(o.gst_paise));
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 18px;border-top:1px solid #e6e7eb;border-bottom:1px solid #e6e7eb">
${(o.items || []).map(i => row(`${h(i.product_name)} × ${i.quantity}`, inr(i.subtotal_paise))).join('')}
${row('Subtotal', inr(o.subtotal_paise))}
${tax}
${row('Total paid', inr(o.total_paise), true)}
</table>`;
}

function addressBlock(o) {
  const lines = [o.business_name, o.customer_name, o.address_line1, o.address_line2,
    `${o.city}, ${STATE_BY_CODE[o.state_code]?.name || o.state_code} ${o.pincode}`, o.phone].filter(Boolean);
  return `<p style="margin:0 0 14px;font-size:14px;line-height:1.6;color:#4a4d57">${lines.map(h).join('<br>')}</p>`;
}

// o.link_token is filled in by the caller (orders.js) before rendering.
const site = env => env.SITE_URL || 'https://wargrobotics.com';
const orderLink = (env, o) =>
  `${site(env)}/order?n=${encodeURIComponent(o.order_number)}&t=${o.link_token}`;

// ---------------------------------------------------------------- templates

export function confirmationEmail(env, o, { hasInvoice }) {
  const first = h(o.customer_name.split(' ')[0]);
  const html = layout(`Order ${o.order_number} confirmed`, [
    p(`Hi ${first}, thank you for your order. Your payment has been received.`),
    orderTable(o),
    p('<b>Delivering to</b>'),
    addressBlock(o),
    p(hasInvoice
      ? `Your GST invoice ${h(o.invoice_number || '')} is attached.`
      : 'Your GST invoice will follow in a separate email shortly.'),
    p('<b>What happens next</b>'),
    p('We test and pack each unit before dispatch. When it ships we email you the courier and tracking number, with instructions for receiving the parcel.'),
    btn(orderLink(env, o), 'View your order'),
    p(`You can also track this order and download the invoice from <a href="${site(env)}/account" style="color:#2a00ff">your account</a>.`),
    p('Questions? Reply to this email and quote your order number.'),
  ].join(''));
  const text = `Order ${o.order_number} confirmed.

${o.summary}
Total paid: ${inr(o.total_paise)} (incl. GST)

${hasInvoice ? 'Your GST invoice is attached.' : 'Your GST invoice will follow shortly.'}
We will email tracking details when it ships.

View your order: ${orderLink(env, o)}`;
  return { subject: `Order ${o.order_number} confirmed – Warg Robotics`, html, text };
}

export function invoiceEmail(env, o) {
  const html = layout(`Invoice for order ${o.order_number}`, [
    p(`Your GST invoice ${h(o.invoice_number)} for order ${h(o.order_number)} is attached.`),
    orderTable(o),
  ].join(''));
  return { subject: `Invoice ${o.invoice_number} – order ${o.order_number}`, html, text: `Your GST invoice ${o.invoice_number} for order ${o.order_number} is attached.` };
}

export function dispatchEmail(env, o) {
  const first = h(o.customer_name.split(' ')[0]);
  const track = o.tracking_url
    ? btn(o.tracking_url, 'Track your parcel')
    : '';
  const html = layout(`Your order ${o.order_number} has shipped`, [
    p(`Hi ${first}, your order (${h(o.summary)}) is on its way.`),
    p(`<b>Courier:</b> ${h(o.courier)}<br><b>Tracking number:</b> ${h(o.tracking_number)}`),
    track,
    p('<b>Delivering to</b>'),
    addressBlock(o),
    p('<b>When the parcel arrives</b>'),
    `<ol style="margin:0 0 14px 18px;padding:0;font-size:15px;line-height:1.6">
      <li>Keep your phone on: the courier may call, and may ask for a delivery OTP.</li>
      <li>Check the outer box before you accept it. If it is torn, crushed, wet or the seal is broken, refuse the delivery and email us.</li>
      <li>Record a short video while you open the box. If anything is damaged or missing, it lets us replace it quickly.</li>
      <li>Report any damage or missing items within 48 hours of delivery by replying to this email.</li>
    </ol>`,
    p('<b>Getting started</b>'),
    // Add your own first-use steps here (from the product manual).
    p('Setup guides and service help are on our <a href="https://wargrobotics.com/support" style="color:#2a00ff">support page</a>. Reply to this email if anything is unclear.'),
    btn(orderLink(env, o), 'View your order'),
  ].join(''));
  const text = `Your order ${o.order_number} has shipped.

Courier: ${o.courier}
Tracking number: ${o.tracking_number}
${o.tracking_url ? `Track: ${o.tracking_url}\n` : ''}
When the parcel arrives:
1. Keep your phone on; the courier may call or ask for an OTP.
2. Check the outer box. If damaged, refuse delivery and email us.
3. Record a video while unboxing.
4. Report damage or missing items within 48 hours.

Support: https://wargrobotics.com/support`;
  return { subject: `Shipped: order ${o.order_number} – Warg Robotics`, html, text };
}

export function teamEmail(env, o) {
  const lines = [
    `Order ${o.order_number} paid: ${inr(o.total_paise)}`,
    ...(o.items || []).map(i => `${i.product_name} x ${i.quantity} (${i.price_type} price)`),
    '',
    `${o.customer_name}${o.business_name ? ` / ${o.business_name} (${o.gstin})` : ''}`,
    `${o.email} · ${o.phone}`,
    o.address_line1, o.address_line2,
    `${o.city}, ${o.state_code} ${o.pincode}`,
    '',
    `Razorpay payment: ${o.razorpay_payment_id}`,
    `Invoice: ${o.invoice_number || 'not yet created'}`,
  ].filter(l => l !== null && l !== undefined);
  return {
    subject: `New order ${o.order_number} – ${o.summary}`,
    html: `<pre style="font:14px/1.6 ui-monospace,monospace">${h(lines.join('\n'))}</pre>`,
    text: lines.join('\n'),
  };
}

// ---------------------------------------------------------------- accounts

export function verifyEmail(env, user, token) {
  const link = `${site(env)}/api/auth/verify?token=${encodeURIComponent(token)}`;
  return {
    subject: 'Confirm your email – Warg Robotics',
    html: layout('Confirm your email', [
      p(`Hi ${h(user.name.split(' ')[0])}, confirm this is your email address to finish setting up your Warg Robotics account.`),
      btn(link, 'Confirm my email'),
      p('The link works for 24 hours. If you did not create an account, ignore this email.'),
    ].join('')),
    text: `Confirm your email for your Warg Robotics account:\n${link}\n\nThe link works for 24 hours. If you did not create an account, ignore this email.`,
  };
}

export function resetEmail(env, user, token) {
  const link = `${site(env)}/reset?token=${encodeURIComponent(token)}`;
  return {
    subject: 'Reset your password – Warg Robotics',
    html: layout('Reset your password', [
      p(`Hi ${h(user.name.split(' ')[0])}, we received a request to reset the password for your Warg Robotics account.`),
      btn(link, 'Choose a new password'),
      p('The link works for one hour and can be used once. If you did not ask for this, ignore this email: your password stays the same.'),
    ].join('')),
    text: `Reset your Warg Robotics password:\n${link}\n\nThe link works for one hour. If you did not ask for this, ignore this email.`,
  };
}

export function passwordChangedEmail(env, user) {
  return {
    subject: 'Your password was changed – Warg Robotics',
    html: layout('Your password was changed', [
      p(`Hi ${h(user.name.split(' ')[0])}, the password for your Warg Robotics account was just changed, and other devices were signed out.`),
      p(`If this was not you, <a href="${site(env)}/login#forgot" style="color:#2a00ff">reset your password</a> now and reply to this email.`),
    ].join('')),
    text: `The password for your Warg Robotics account was just changed. If this was not you, reset it at ${site(env)}/login#forgot and reply to this email.`,
  };
}

// ---------------------------------------------------------------- service requests

const KIND = { repair: 'Repair', warranty: 'Warranty claim', return: 'Return', setup: 'Setup help', other: 'Other' };
const STATUS = { open: 'Open', in_progress: 'In progress', resolved: 'Resolved', closed: 'Closed' };

export function serviceCreatedEmail(env, sr, user) {
  return {
    subject: `Service request ${sr.request_number} received – Warg Robotics`,
    html: layout(`Request ${sr.request_number} received`, [
      p(`Hi ${h(user.name.split(' ')[0])}, we have your ${h(KIND[sr.kind].toLowerCase())} request${sr.order_number ? ` for order ${h(sr.order_number)}` : ''}. We will reply within two working days.`),
      p(`<b>${h(sr.subject)}</b><br>${h(sr.message).replace(/\n/g, '<br>')}`),
      p('If photos or a video would help, reply to this email with them attached.'),
      btn(`${site(env)}/account#service`, 'View your requests'),
    ].join('')),
    text: `We have your request ${sr.request_number}: ${sr.subject}\nWe will reply within two working days. Reply to this email with photos if they help.`,
  };
}

export function serviceTeamEmail(env, sr, user) {
  const lines = [
    `${KIND[sr.kind]} request ${sr.request_number}${sr.order_number ? ` (order ${sr.order_number})` : ''}`,
    `${user.name} · ${user.email}${user.phone ? ' · ' + user.phone : ''}`,
    '', sr.subject, '', sr.message, '', `Update it in ${site(env)}/admin`,
  ];
  return {
    subject: `Service ${sr.request_number}: ${sr.subject}`,
    html: `<pre style="font:14px/1.6 ui-monospace,monospace;white-space:pre-wrap">${h(lines.join('\n'))}</pre>`,
    text: lines.join('\n'),
  };
}

export function serviceUpdateEmail(env, sr, user) {
  return {
    subject: `Update on ${sr.request_number}: ${STATUS[sr.status]} – Warg Robotics`,
    html: layout(`Request ${sr.request_number}: ${STATUS[sr.status]}`, [
      p(`Hi ${h(user.name.split(' ')[0])}, there is an update on your request <b>${h(sr.subject)}</b>.`),
      sr.team_note ? p(h(sr.team_note).replace(/\n/g, '<br>')) : '',
      btn(`${site(env)}/account#service`, 'View your requests'),
      p('Reply to this email if you have questions.'),
    ].join('')),
    text: `Update on ${sr.request_number} (${STATUS[sr.status]}): ${sr.team_note || ''}\n${site(env)}/account#service`,
  };
}
