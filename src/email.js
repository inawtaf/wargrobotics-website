// Transactional email through Resend (https://resend.com/docs/api-reference/emails/send-email).
// The wording lives in this file: edit the templates below to change what buyers read.

import { escapeHtml as h, inr, base64FromBytes } from './util.js';
import { STATE_BY_CODE } from './config.js';
import { billingOf, placeOfSupply } from './billing.js';

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
  if (!res.ok) {
    const message = `Resend: ${data.message || data.name || `HTTP ${res.status}`}`;
    await remember(env, 'last_email_error', { at: new Date().toISOString(), message, subject });
    throw new Error(message);
  }
  await remember(env, 'last_email_ok', { at: new Date().toISOString(), subject });
  return data.id;
}

// The latest send result, shown on the portal's setup check. Never fails the send.
async function remember(env, key, value) {
  try {
    await env.DB.prepare('INSERT INTO kv (key, value, expires_at) VALUES (?, ?, 4102444800) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .bind(key, JSON.stringify(value)).run();
  } catch { /* best effort */ }
}

// Setup check: is EMAIL_FROM's domain verified in Resend? A sending-only API
// key can't list domains (401 restricted_api_key); then we say so.
export async function checkDomain(env) {
  if (!env.RESEND_API_KEY) return { ok: false, detail: 'RESEND_API_KEY secret is missing.' };
  const from = env.EMAIL_FROM || 'orders@wargrobotics.com';
  const domain = (from.match(/@([^>\s]+)/) || [])[1]?.toLowerCase();
  const res = await fetch(`${base(env)}/domains`, { headers: { authorization: `Bearer ${env.RESEND_API_KEY}` } });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && /restricted/i.test(data.name || data.message || '')) {
    return { ok: null, detail: `The API key can only send, so the domain status can't be read here. Check resend.com → Domains shows ${domain} as Verified, and use "Send test email".` };
  }
  if (!res.ok) return { ok: false, detail: `Resend rejected the API key: ${data.message || data.name || res.status}. Create a new key and paste it into RESEND_API_KEY.` };
  const list = data.data || [];
  const d = list.find(x => (x.name || '').toLowerCase() === domain);
  if (!d) return { ok: false, detail: `${domain} (from EMAIL_FROM) is not added in Resend. Domains there: ${list.map(x => `${x.name} (${x.status})`).join(', ') || 'none'}.` };
  if (d.status !== 'verified') return { ok: false, detail: `${domain} is "${d.status}" in Resend, not verified. Add the DNS records Resend lists for it in Cloudflare DNS (set them to "DNS only", grey cloud), then click Verify in Resend.` };
  return { ok: true, detail: `${domain} is verified in Resend.` };
}

export function testEmail(env) {
  return {
    subject: 'Warg Robotics test email',
    text: `This is a test email from ${env.SITE_URL || 'wargrobotics.com'}. If you can read it, order and account emails will arrive too.`,
    html: layout('Test email', p(`This is a test email from ${h(env.SITE_URL || 'wargrobotics.com')}. If you can read it, order and account emails will arrive too.`)),
  };
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
Warg Robotics · Panaji, Goa · <a href="mailto:hello@wargrobotics.com" style="color:#6b6e78">hello@wargrobotics.com</a>
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

const stateName = c => STATE_BY_CODE[c]?.name || c;
const block = lines => `<p style="margin:0 0 14px;font-size:14px;line-height:1.6;color:#4a4d57">${lines.filter(Boolean).map(h).join('<br>')}</p>`;

function addressBlock(o) {
  return block([o.customer_name, o.address_line1, o.address_line2, `${o.city}, ${stateName(o.state_code)} ${o.pincode}`, o.phone]);
}

// "Billed to", shown when it differs from the delivery address or carries a GSTIN.
function billingBlock(o) {
  const b = billingOf(o);
  if (b.same && !o.gstin) return '';
  return p('<b>Billed to</b>') + block([o.business_name, b.name, b.address_line1, b.address_line2, `${b.city}, ${stateName(b.state_code)} ${b.pincode}`, o.gstin && `GSTIN ${o.gstin}`]);
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
    billingBlock(o),
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

export function dispatchEmail(env, o, { message } = {}) {
  const first = h(o.customer_name.split(' ')[0]);
  const track = o.tracking_url
    ? btn(o.tracking_url, 'Track your parcel')
    : '';
  const html = layout(`Your order ${o.order_number} has shipped`, [
    p(`Hi ${first}, your order (${h(o.summary)}) is on its way.`),
    p(`<b>Courier:</b> ${h(o.courier)}<br><b>Tracking number:</b> ${h(o.tracking_number)}${o.expected_delivery ? `<br><b>Expected delivery:</b> ${h(niceDate(o.expected_delivery))}` : ''}`),
    note(message),
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
Tracking number: ${o.tracking_number}${o.expected_delivery ? `\nExpected delivery: ${niceDate(o.expected_delivery)}` : ''}${message ? `\n\n${message}` : ''}
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
    `Deliver to: ${[o.address_line1, o.address_line2, `${o.city}, ${o.state_code} ${o.pincode}`].filter(Boolean).join(', ')}`,
    (() => { const b = billingOf(o); return b.same ? 'Bill to: same as delivery' : `Bill to: ${[b.name, b.address_line1, b.address_line2, `${b.city}, ${b.state_code} ${b.pincode}`].filter(Boolean).join(', ')}`; })(),
    `Place of supply: ${placeOfSupply(o)} (${o.tax_kind === 'intra' ? 'CGST+SGST' : 'IGST'})`,
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

// ---------------------------------------------------------------- fulfilment

const niceDate = d => new Date(`${d}T00:00:00+05:30`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
// A personal line from the team, shown as a quote when staff add one.
const note = m => (m ? `<p style="margin:0 0 14px;padding:12px 14px;background:#f4f5f7;border-left:3px solid #2a00ff;font-size:15px;line-height:1.6">${h(m).replace(/\n/g, '<br>')}</p>` : '');

export function processingEmail(env, o, { message } = {}) {
  const first = h(o.customer_name.split(' ')[0]);
  return {
    subject: `We're preparing order ${o.order_number} – Warg Robotics`,
    html: layout(`We're preparing your order`, [
      p(`Hi ${first}, your order ${h(o.order_number)} (${h(o.summary)}) is being tested and packed.`),
      note(message),
      p('We email you the courier and tracking number as soon as it ships.'),
      btn(orderLink(env, o), 'View your order'),
    ].join('')),
    text: `Your order ${o.order_number} (${o.summary}) is being tested and packed. We will email tracking when it ships.${message ? `\n\n${message}` : ''}\n\n${orderLink(env, o)}`,
  };
}

export function deliveredEmail(env, o, { message } = {}) {
  const first = h(o.customer_name.split(' ')[0]);
  return {
    subject: `Delivered: order ${o.order_number} – Warg Robotics`,
    html: layout('Your order was delivered', [
      p(`Hi ${first}, your order ${h(o.order_number)} (${h(o.summary)}) has been delivered.`),
      note(message),
      p('If anything is damaged or missing, tell us within 48 hours by replying to this email. For setup help or a repair, open a service request from your account.'),
      btn(`${site(env)}/account#service`, 'Get help'),
    ].join('')),
    text: `Your order ${o.order_number} has been delivered.${message ? `\n\n${message}` : ''}\nReport damage or missing items within 48 hours by replying. Help: ${site(env)}/account#service`,
  };
}

export function cancelledEmail(env, o, { message } = {}) {
  const first = h(o.customer_name.split(' ')[0]);
  return {
    subject: `Order ${o.order_number} cancelled – Warg Robotics`,
    html: layout(`Order ${o.order_number} cancelled`, [
      p(`Hi ${first}, your order ${h(o.order_number)} (${h(o.summary)}) has been cancelled.`),
      note(message),
      p(`A full refund of ${inr(o.total_paise)} goes back to the account you paid from. Banks usually show it within 5–7 working days.`),
      p('Reply to this email if you have questions.'),
    ].join('')),
    text: `Your order ${o.order_number} has been cancelled.${message ? `\n\n${message}` : ''}\nA full refund of ${inr(o.total_paise)} goes back to the account you paid from, usually within 5–7 working days.`,
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
