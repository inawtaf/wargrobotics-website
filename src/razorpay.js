import { hmacSha256Hex, safeEqual } from './util.js';

const base = env => env.RAZORPAY_API_BASE || 'https://api.razorpay.com/v1';

function auth(env) {
  if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) throw new Error('Razorpay keys are not configured');
  return 'Basic ' + btoa(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`);
}

async function call(env, method, path, body) {
  const res = await fetch(base(env) + path, {
    method,
    headers: { authorization: auth(env), 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.description || `HTTP ${res.status}`;
    throw new Error(`Razorpay ${method} ${path}: ${msg}`);
  }
  return data;
}

// https://razorpay.com/docs/api/orders/create/
export const createOrder = (env, { amountPaise, receipt, notes }) =>
  call(env, 'POST', '/orders', { amount: amountPaise, currency: 'INR', receipt, notes });

export const fetchPayment = (env, paymentId) =>
  call(env, 'GET', `/payments/${encodeURIComponent(paymentId)}`);

// Checkout success callback: signature = HMAC_SHA256(order_id + "|" + payment_id, key_secret)
export async function verifyCheckoutSignature(env, { orderId, paymentId, signature }) {
  if (!orderId || !paymentId || !signature) return false;
  const expected = await hmacSha256Hex(env.RAZORPAY_KEY_SECRET, `${orderId}|${paymentId}`);
  return safeEqual(expected, signature);
}

// Webhook: X-Razorpay-Signature = HMAC_SHA256(raw request body, webhook secret)
export async function verifyWebhookSignature(env, rawBody, signature) {
  if (!env.RAZORPAY_WEBHOOK_SECRET || !signature) return false;
  const expected = await hmacSha256Hex(env.RAZORPAY_WEBHOOK_SECRET, rawBody);
  return safeEqual(expected, signature);
}
