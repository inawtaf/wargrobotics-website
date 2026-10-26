const enc = new TextEncoder();

export const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });

export const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
export const nowSec = () => Math.floor(Date.now() / 1000);

const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');

export async function hmacSha256Hex(secret, message) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, enc.encode(message)));
}

export async function sha256Hex(message) {
  return hex(await crypto.subtle.digest('SHA-256', enc.encode(message)));
}

// Constant-time string compare, so signatures can't be guessed byte by byte.
export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// The buyer's order-page link carries ?t=<token>. The token is derived from
// the order number with a secret, so it never needs storing and any email can
// rebuild the link, but nobody can guess another order's link.
export async function orderToken(env, orderNumber) {
  if (!env.ORDER_LINK_SECRET) throw new Error('ORDER_LINK_SECRET is not set');
  return (await hmacSha256Hex(env.ORDER_LINK_SECRET, `order:${orderNumber}`)).slice(0, 32);
}

// WR-261026-K7Q2: date for humans, 4 characters with no 0/O/1/I for safety on the phone.
export function newOrderNumber(date = new Date()) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const a = new Uint8Array(4);
  crypto.getRandomValues(a);
  const tail = [...a].map(x => alphabet[x % alphabet.length]).join('');
  const d = date.toISOString().slice(2, 10).replace(/-/g, '');
  return `WR-${d}-${tail}`;
}

export const escapeHtml = s =>
  String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const inr = paise =>
  '₹' + (paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function base64FromBytes(bytes) {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(s);
}
