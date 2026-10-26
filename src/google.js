// "Sign in with Google" (OAuth 2.0 authorisation code flow + PKCE).
//
// GET /api/auth/google?next=/checkout       -> redirect to Google
// GET /api/auth/google/callback?code&state  -> back from Google: sign in / sign up / link
//
// The ID token is fetched directly from Google's token endpoint over HTTPS with
// our client secret, so per Google's guidance its signature need not be
// re-verified; we still check issuer, audience, expiry, nonce and that the
// email is verified.

import { cookie, readCookie, randomUrlToken } from './auth.js';
import { sha256Hex, safeEqual } from './util.js';

const AUTH_URL = env => env.GOOGLE_AUTH_URL || 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = env => env.GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token';
const STATE_COOKIE = 'wr_oauth';

const redirectUri = env => `${env.SITE_URL || 'https://wargrobotics.com'}/api/auth/google/callback`;

const b64urlFromBytes = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
async function pkceChallenge(verifier) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return b64urlFromBytes(new Uint8Array(digest));
}

// Only allow redirects back to our own pages.
export function safeNext(next) {
  return typeof next === 'string' && /^\/(?!\/)[\w\-./?=&%#]*$/.test(next) ? next.slice(0, 200) : '/account';
}

export async function startGoogle(env, { next, mode }) {
  if (!env.GOOGLE_CLIENT_ID) throw new Error('GOOGLE_CLIENT_ID is not set');
  const state = randomUrlToken(24);
  const nonce = randomUrlToken(24);
  const verifier = randomUrlToken(48);
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri(env),
    response_type: 'code',
    scope: 'openid email profile',
    state,
    nonce,
    code_challenge: await pkceChallenge(verifier),
    code_challenge_method: 'S256',
    prompt: 'select_account',
  });
  // Everything the callback needs, in a short-lived HttpOnly cookie scoped to the callback.
  const payload = btoa(JSON.stringify({ s: state, n: nonce, v: verifier, next: safeNext(next), mode: mode === 'link' ? 'link' : 'login' }));
  return {
    location: `${AUTH_URL(env)}?${params}`,
    setCookie: cookie(STATE_COOKIE, payload, { maxAge: 600, path: '/api/auth/google' }),
  };
}

export const clearStateCookie = () => cookie(STATE_COOKIE, '', { maxAge: 0, path: '/api/auth/google' });

function decodeJwtPayload(jwt) {
  const part = jwt.split('.')[1];
  const json = atob(part.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (part.length % 4)) % 4));
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(json, c => c.charCodeAt(0))));
}

// Returns { sub, email, name, next, mode } or throws with a user-safe message.
export async function finishGoogle(env, request) {
  const url = new URL(request.url);
  if (url.searchParams.get('error')) throw new Error('Google sign-in was cancelled.');
  const raw = readCookie(request, STATE_COOKIE);
  if (!raw) throw new Error('Your sign-in took too long. Please try again.');
  let st;
  try { st = JSON.parse(atob(raw)); } catch { throw new Error('Sign-in failed. Please try again.'); }
  if (!safeEqual(st.s, url.searchParams.get('state') || '')) throw new Error('Sign-in failed. Please try again.');

  const res = await fetch(TOKEN_URL(env), {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: url.searchParams.get('code') || '',
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri(env),
      grant_type: 'authorization_code',
      code_verifier: st.v,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.id_token) throw new Error('Google did not complete the sign-in. Please try again.');

  const claims = decodeJwtPayload(data.id_token);
  const now = Math.floor(Date.now() / 1000);
  if (!['accounts.google.com', 'https://accounts.google.com'].includes(claims.iss)) throw new Error('Sign-in failed (issuer).');
  if (claims.aud !== env.GOOGLE_CLIENT_ID) throw new Error('Sign-in failed (audience).');
  if (!(claims.exp > now)) throw new Error('Sign-in failed (expired).');
  if (claims.nonce !== st.n) throw new Error('Sign-in failed. Please try again.');
  if (!claims.email || claims.email_verified !== true) throw new Error('Your Google account email is not verified.');

  return {
    sub: String(claims.sub),
    email: String(claims.email).toLowerCase(),
    name: (claims.name || claims.given_name || claims.email.split('@')[0]).slice(0, 100),
    next: safeNext(st.next),
    mode: st.mode,
  };
}

export const _test = { decodeJwtPayload, pkceChallenge, sha256Hex };
