// Accounts and sessions.
//
// Passwords: PBKDF2-SHA256, 100,000 rounds (the most Workers' WebCrypto allows),
// 16-byte random salt, plus an optional server-side pepper (AUTH_PEPPER secret)
// so a stolen database alone is not enough to start guessing.
// Sessions: random 32-byte token in an HttpOnly, Secure, SameSite=Lax cookie;
// only its SHA-256 is stored. 30 days, renewed while in use.

import { nowSec, sha256Hex, safeEqual } from './util.js';

const enc = new TextEncoder();
export const SESSION_COOKIE = 'wr_session';
const SESSION_DAYS = 30;
const PBKDF2_ROUNDS = 100_000;

const b64 = bytes => btoa(String.fromCharCode(...bytes));
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const randomBytes = n => crypto.getRandomValues(new Uint8Array(n));
const b64url = bytes => b64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const randomUrlToken = (n = 32) => b64url(randomBytes(n));

async function pbkdf2(password, salt, rounds, pepper) {
  const material = pepper ? `${password}\u0000${pepper}` : password;
  const key = await crypto.subtle.importKey('raw', enc.encode(material), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: rounds }, key, 256);
  return new Uint8Array(bits);
}

// Stored as: pbkdf2-sha256$<rounds>$<peppered 0|1>$<salt b64>$<hash b64>
export async function hashPassword(env, password) {
  const salt = randomBytes(16);
  const pepper = env.AUTH_PEPPER || '';
  const hash = await pbkdf2(password, salt, PBKDF2_ROUNDS, pepper);
  return `pbkdf2-sha256$${PBKDF2_ROUNDS}$${pepper ? 1 : 0}$${b64(salt)}$${b64(hash)}`;
}

export async function verifyPassword(env, password, stored) {
  if (typeof password !== 'string' || !stored) return false;
  const [scheme, rounds, peppered, salt, hash] = stored.split('$');
  if (scheme !== 'pbkdf2-sha256') return false;
  const got = await pbkdf2(password, unb64(salt), Number(rounds), peppered === '1' ? env.AUTH_PEPPER || '' : '');
  return safeEqual(b64(got), hash);
}

// A real-looking hash to verify against when the email is unknown, so a
// wrong email takes as long as a wrong password (no account probing by timing).
const DUMMY_HASH = 'pbkdf2-sha256$100000$0$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
export const burnPasswordCheck = (env, password) => verifyPassword(env, password, DUMMY_HASH);

// ------------------------------------------------------------------ cookies

export function readCookie(request, name) {
  const header = request.headers.get('cookie') || '';
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

export function cookie(name, value, { maxAge, path = '/', httpOnly = true } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${path}`, 'Secure', 'SameSite=Lax'];
  if (httpOnly) parts.push('HttpOnly');
  if (maxAge !== undefined) parts.push(`Max-Age=${maxAge}`);
  return parts.join('; ');
}

// ------------------------------------------------------------------ sessions

export async function createSession(env, userId, request) {
  const token = randomUrlToken(32);
  const now = nowSec();
  await env.DB.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at, user_agent) VALUES (?,?,?,?,?)')
    .bind(await sha256Hex(token), userId, now, now + SESSION_DAYS * 86400, (request.headers.get('user-agent') || '').slice(0, 200)).run();
  return cookie(SESSION_COOKIE, token, { maxAge: SESSION_DAYS * 86400 });
}

export const clearSessionCookie = () => cookie(SESSION_COOKIE, '', { maxAge: 0 });

// Returns the signed-in user (without the password hash) or null.
export async function currentUser(env, request) {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token || token.length > 100) return null;
  const hash = await sha256Hex(token);
  const row = await env.DB.prepare(`SELECT s.expires_at, u.id, u.email, u.email_verified_at, u.name, u.phone,
      u.google_sub, (u.password_hash IS NOT NULL) AS has_password, u.created_at
    FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`).bind(hash).first();
  if (!row) return null;
  const now = nowSec();
  if (row.expires_at < now) {
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(hash).run();
    return null;
  }
  // Slide the expiry forward at most once a day.
  if (row.expires_at - now < (SESSION_DAYS - 1) * 86400) {
    await env.DB.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?').bind(now + SESSION_DAYS * 86400, hash).run();
  }
  const { expires_at, ...user } = row;
  user.has_password = Boolean(user.has_password);
  user.session_hash = hash;
  return user;
}

export async function endSession(env, request) {
  const token = readCookie(request, SESSION_COOKIE);
  if (token) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256Hex(token)).run();
}

export const endAllSessions = (env, userId, exceptHash = null) =>
  env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash IS NOT ?').bind(userId, exceptHash).run();

// ------------------------------------------------------------------ one-time links

export async function issueToken(env, userId, purpose, ttlSeconds) {
  const token = randomUrlToken(32);
  // One live link per purpose: a new one replaces the old.
  await env.DB.prepare('DELETE FROM auth_tokens WHERE user_id = ? AND purpose = ?').bind(userId, purpose).run();
  await env.DB.prepare('INSERT INTO auth_tokens (token_hash, user_id, purpose, expires_at) VALUES (?,?,?,?)')
    .bind(await sha256Hex(token), userId, purpose, nowSec() + ttlSeconds).run();
  return token;
}

// Marks the token used and returns its user id, or null if invalid/expired/used.
export async function consumeToken(env, token, purpose) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
  const hash = await sha256Hex(token);
  const r = await env.DB.prepare('UPDATE auth_tokens SET used_at = ? WHERE token_hash = ? AND purpose = ? AND used_at IS NULL AND expires_at > ? RETURNING user_id')
    .bind(nowSec(), hash, purpose, nowSec()).first();
  return r ? r.user_id : null;
}

// ------------------------------------------------------------------ throttling

// Allows `limit` hits per key per `windowSec`. Returns true if this hit is allowed.
export async function throttle(env, key, limit, windowSec) {
  const now = nowSec();
  const row = await env.DB.prepare(`INSERT INTO throttle (key, count, window_start) VALUES (?, 1, ?)
    ON CONFLICT(key) DO UPDATE SET
      count = CASE WHEN throttle.window_start <= ? THEN 1 ELSE throttle.count + 1 END,
      window_start = CASE WHEN throttle.window_start <= ? THEN ? ELSE throttle.window_start END
    RETURNING count`).bind(key, now, now - windowSec, now - windowSec, now).first();
  return row.count <= limit;
}
export const clearThrottle = (env, key) => env.DB.prepare('DELETE FROM throttle WHERE key = ?').bind(key).run();
export const clientIp = request => request.headers.get('cf-connecting-ip') || 'local';

// ------------------------------------------------------------------ CSRF

// State-changing requests must come from our own pages: same Origin, JSON body.
// Together with SameSite=Lax cookies this stops other sites submitting forms
// as a signed-in visitor.
export function sameOrigin(request, env) {
  const origin = request.headers.get('origin');
  const site = new URL(env.SITE_URL || 'https://wargrobotics.com');
  const self = new URL(request.url);
  if (!origin) return false;
  try {
    const o = new URL(origin);
    return o.host === self.host || o.host === site.host || o.host === `www.${site.host}`;
  } catch { return false; }
}
