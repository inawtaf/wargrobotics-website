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
// Pasted values often carry a stray space or line break: trim them.
export const clientId = env => String(env.GOOGLE_CLIENT_ID || '').trim();
const clientSecret = env => String(env.GOOGLE_CLIENT_SECRET || '').trim();
export const configured = env => Boolean(clientId(env) && !/REPLACE/.test(clientId(env)));

export const redirectUri = env => `${String(env.SITE_URL || 'https://wargrobotics.com').trim().replace(/\/+$/, '')}/api/auth/google/callback`;

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
  if (!configured(env)) throw Object.assign(new Error('Google sign-in is not available right now. Please use email.'), { notConfigured: true });
  const state = randomUrlToken(24);
  const nonce = randomUrlToken(24);
  const verifier = randomUrlToken(48);
  const params = new URLSearchParams({
    client_id: clientId(env),
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
  const gErr = url.searchParams.get('error');
  if (gErr) {
    console.error('Google sign-in: Google returned error', gErr, url.searchParams.get('error_description') || '');
    throw new Error(gErr === 'access_denied' ? 'Google sign-in was cancelled.' : 'Google could not sign you in. Please try again, or use email.');
  }
  if (!clientSecret(env)) {
    console.error('Google sign-in: GOOGLE_CLIENT_SECRET is not set');
    throw new Error('Google sign-in is not available right now. Please use email.');
  }
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
      client_id: clientId(env),
      client_secret: clientSecret(env),
      redirect_uri: redirectUri(env),
      grant_type: 'authorization_code',
      code_verifier: st.v,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.id_token) {
    // invalid_client = wrong GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET pair;
    // redirect_uri_mismatch = the callback URL isn't listed on the Google client.
    console.error('Google sign-in: token exchange failed', res.status, data.error || '', data.error_description || '');
    throw new Error('Google did not complete the sign-in. Please try again.');
  }

  const claims = decodeJwtPayload(data.id_token);
  const now = Math.floor(Date.now() / 1000);
  if (!['accounts.google.com', 'https://accounts.google.com'].includes(claims.iss)) throw new Error('Sign-in failed (issuer).');
  if (claims.aud !== clientId(env)) throw new Error('Sign-in failed (audience).');
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

// Setup check: trade a dummy code. Google answers invalid_grant when the client
// id and secret are right (only the code is bad), invalid_client when they're wrong.
export async function checkCredentials(env) {
  if (!configured(env)) return { ok: false, detail: 'GOOGLE_CLIENT_ID is not set in wrangler.jsonc.' };
  if (!clientSecret(env)) return { ok: false, detail: 'GOOGLE_CLIENT_SECRET secret is missing.' };
  const res = await fetch(TOKEN_URL(env), {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code: 'setup-check', client_id: clientId(env), client_secret: clientSecret(env), redirect_uri: redirectUri(env), grant_type: 'authorization_code', code_verifier: 'x'.repeat(43) }),
  });
  const data = await res.json().catch(() => ({}));
  if (data.error === 'invalid_grant') return { ok: true, detail: 'Client ID and secret accepted by Google.' };
  if (data.error === 'invalid_client' || data.error === 'unauthorized_client') {
    return { ok: false, detail: 'Google rejected the client ID / secret pair. Copy the client secret again from Google Cloud (same OAuth client as the ID) into GOOGLE_CLIENT_SECRET.' };
  }
  if (data.error === 'redirect_uri_mismatch') return { ok: false, detail: `Add ${redirectUri(env)} under "Authorised redirect URIs" on the Google OAuth client.` };
  return { ok: false, detail: `Unexpected answer from Google: ${data.error || res.status} ${data.error_description || ''}`.trim() };
}

export const _test = { decodeJwtPayload, pkceChallenge, sha256Hex };
