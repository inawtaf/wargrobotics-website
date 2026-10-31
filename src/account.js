// Account API: sign-up/sign-in, profile, addresses, cart, orders, service requests.
// Every handler gets (request, env, ctx, user?) and returns a Response.

import { PRODUCTS, MAX_QUANTITY } from './config.js';
import { json, readJson, httpError, nowIso, newRequestNumber, sha256Hex } from './util.js';
import { validateAddress, validateItems, validateRegistration, validateEmail, passwordProblem, normalisePhone, clean } from './validate.js';
import * as auth from './auth.js';
import * as google from './google.js';
import * as orders from './orders.js';
import * as zoho from './zoho.js';
import * as email from './email.js';
import { events as orderEvents } from './fulfilment.js';

const VERIFY_TTL = 24 * 3600;
const RESET_TTL = 3600;
const MAX_ADDRESSES = 10;

const publicUser = u => ({
  id: u.id, email: u.email, name: u.name, phone: u.phone,
  email_verified: Boolean(u.email_verified_at), has_password: Boolean(u.has_password ?? u.password_hash),
  google_linked: Boolean(u.google_sub), created_at: u.created_at,
});

const getUserById = (env, id) => env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first();
const getUserByEmail = (env, e) => env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(e).first();

async function sendSafely(env, msg) {
  try { await email.sendEmail(env, msg); } catch (e) { console.error('email failed:', e.message); }
}

async function sendVerification(env, user) {
  const token = await auth.issueToken(env, user.id, 'verify', VERIFY_TTL);
  await sendSafely(env, { to: user.email, ...email.verifyEmail(env, user, token) });
}

// Sign in: create the session and hand back the cookie.
async function signedIn(env, request, user, body = {}) {
  const setCookie = await auth.createSession(env, user.id, request);
  return json({ user: publicUser(user), ...body }, 200, { 'set-cookie': setCookie });
}

// ===================================================================== auth

export async function register(request, env) {
  if (!(await auth.throttle(env, `register:${auth.clientIp(request)}`, 10, 3600))) throw httpError(429, 'Too many sign-ups from this network. Try again later.');
  const v = validateRegistration(await readJson(request));
  if (!v.ok) return json({ error: 'validation', fields: v.errors }, 422);
  const { name, email: addr, password } = v.value;

  const existing = await getUserByEmail(env, addr);
  if (existing) {
    return json({ error: 'validation', fields: { email: 'An account with this email already exists. Sign in, or reset your password.' } }, 409);
  }
  const hash = await auth.hashPassword(env, password);
  const user = await env.DB.prepare('INSERT INTO users (email, name, password_hash) VALUES (?,?,?) RETURNING *').bind(addr, name, hash).first();
  await sendVerification(env, user);
  return signedIn(env, request, user, { verification_sent: true });
}

export async function login(request, env) {
  const b = await readJson(request);
  const addr = validateEmail(b.email);
  const ipKey = `login-ip:${auth.clientIp(request)}`;
  const emailKey = `login-email:${addr}`;
  // 10 failures per email per 15 minutes, 50 per network per 15 minutes.
  if (!(await auth.throttle(env, ipKey, 50, 900)) || (addr && !(await auth.throttle(env, emailKey, 10, 900)))) {
    throw httpError(429, 'Too many attempts. Wait 15 minutes, or reset your password.');
  }
  const user = addr && (await getUserByEmail(env, addr));
  const ok = user?.password_hash ? await auth.verifyPassword(env, b.password, user.password_hash) : await auth.burnPasswordCheck(env, b.password);
  if (!ok) {
    const googleOnly = user && !user.password_hash && user.google_sub;
    return json({ error: googleOnly ? 'This account uses Google sign-in. Continue with Google, or reset your password to add one.' : 'Email or password is incorrect.' }, 401);
  }
  await auth.clearThrottle(env, emailKey);
  return signedIn(env, request, user);
}

export async function logout(request, env) {
  await auth.endSession(env, request);
  return json({ ok: true }, 200, { 'set-cookie': auth.clearSessionCookie() });
}

export async function logoutAll(request, env, ctx, user) {
  await auth.endAllSessions(env, user.id);
  return json({ ok: true }, 200, { 'set-cookie': auth.clearSessionCookie() });
}

export async function me(request, env, ctx, user) {
  if (!user) return json({ user: null });
  const cart = await env.DB.prepare('SELECT COALESCE(SUM(quantity),0) AS n FROM cart_items WHERE user_id = ?').bind(user.id).first();
  return json({ user: { ...publicUser(user), is_staff: auth.isStaff(env, user) }, cart_count: cart.n });
}

// GET /api/auth/verify?token=  (the link in the email) -> back to the account page
export async function verify(request, env) {
  const url = new URL(request.url);
  const userId = await auth.consumeToken(env, url.searchParams.get('token'), 'verify');
  if (!userId) return Response.redirect(`${new URL(request.url).origin}/account?verify=expired`, 302);
  await env.DB.prepare('UPDATE users SET email_verified_at = COALESCE(email_verified_at, ?), updated_at = ? WHERE id = ?').bind(nowIso(), nowIso(), userId).run();
  return Response.redirect(`${url.origin}/account?verify=done`, 302);
}

export async function resendVerification(request, env, ctx, user) {
  if (user.email_verified_at) return json({ ok: true, already: true });
  if (!(await auth.throttle(env, `verify-send:${user.id}`, 5, 3600))) throw httpError(429, 'We have sent several links already. Check your spam folder, or try again in an hour.');
  await sendVerification(env, user);
  return json({ ok: true });
}

// Always answers the same way, so it can't be used to find out who has an account.
export async function forgot(request, env) {
  const addr = validateEmail((await readJson(request)).email);
  if (addr && (await auth.throttle(env, `reset-send:${addr}`, 5, 3600)) && (await auth.throttle(env, `reset-ip:${auth.clientIp(request)}`, 20, 3600))) {
    const user = await getUserByEmail(env, addr);
    if (user) {
      const token = await auth.issueToken(env, user.id, 'reset', RESET_TTL);
      await sendSafely(env, { to: user.email, ...email.resetEmail(env, user, token) });
    }
  }
  return json({ ok: true, message: 'If there is an account for that email, a reset link is on its way.' });
}

export async function reset(request, env) {
  const b = await readJson(request);
  const userId = await auth.consumeToken(env, b.token, 'reset');
  if (!userId) return json({ error: 'This reset link has expired or was already used. Ask for a new one.' }, 400);
  const user = await getUserById(env, userId);
  const problem = passwordProblem(b.password, user.email);
  if (problem) {
    // Put the token back so the visitor can fix the password and retry.
    await env.DB.prepare('UPDATE auth_tokens SET used_at = NULL WHERE token_hash = ?').bind(await sha256Hex(b.token)).run();
    return json({ error: 'validation', fields: { password: problem } }, 422);
  }
  // A reset link proves the visitor controls the inbox, so the email counts as verified.
  await env.DB.prepare('UPDATE users SET password_hash = ?, email_verified_at = COALESCE(email_verified_at, ?), updated_at = ? WHERE id = ?')
    .bind(await auth.hashPassword(env, b.password), nowIso(), nowIso(), userId).run();
  await auth.endAllSessions(env, userId);
  await sendSafely(env, { to: user.email, ...email.passwordChangedEmail(env, user) });
  return signedIn(env, request, user);
}

// ===================================================================== Google

export async function googleStart(request, env, ctx, user) {
  const url = new URL(request.url);
  const mode = url.searchParams.get('mode') === 'link' && user ? 'link' : 'login';
  const { location, setCookie } = await google.startGoogle(env, { next: url.searchParams.get('next'), mode });
  return new Response(null, { status: 302, headers: { location, 'set-cookie': setCookie, 'cache-control': 'no-store' } });
}

export async function googleCallback(request, env, ctx, user) {
  const origin = new URL(request.url).origin;
  const back = (path, cookies = []) => {
    const h = new Headers({ location: origin + path, 'cache-control': 'no-store' });
    h.append('set-cookie', google.clearStateCookie());
    for (const c of cookies) h.append('set-cookie', c);
    return new Response(null, { status: 302, headers: h });
  };
  let g;
  try { g = await google.finishGoogle(env, request); }
  catch (e) { return back(`/login?error=${encodeURIComponent(e.message)}`); }

  const bySub = await env.DB.prepare('SELECT * FROM users WHERE google_sub = ?').bind(g.sub).first();

  // Linking from the profile page while signed in.
  if (g.mode === 'link' && user) {
    if (bySub && bySub.id !== user.id) return back('/account?google=taken#profile');
    await env.DB.prepare('UPDATE users SET google_sub = ?, updated_at = ? WHERE id = ?').bind(g.sub, nowIso(), user.id).run();
    return back('/account?google=linked#profile');
  }

  let account = bySub;
  if (!account) {
    const byEmail = await getUserByEmail(env, g.email);
    if (byEmail) {
      // Google has proved this person owns the email. If the existing account
      // was never verified, whoever set its password never proved that, so the
      // password is removed and its sessions ended (stops "pre-registering"
      // someone else's email and keeping access after they sign in).
      const unverified = !byEmail.email_verified_at;
      await env.DB.prepare(`UPDATE users SET google_sub = ?, email_verified_at = COALESCE(email_verified_at, ?),
          password_hash = CASE WHEN ? THEN NULL ELSE password_hash END, updated_at = ? WHERE id = ?`)
        .bind(g.sub, nowIso(), unverified ? 1 : 0, nowIso(), byEmail.id).run();
      if (unverified) await auth.endAllSessions(env, byEmail.id);
      account = await getUserById(env, byEmail.id);
    } else {
      account = await env.DB.prepare('INSERT INTO users (email, name, google_sub, email_verified_at) VALUES (?,?,?,?) RETURNING *')
        .bind(g.email, g.name, g.sub, nowIso()).first();
    }
  }
  const session = await auth.createSession(env, account.id, request);
  return back(g.next.includes('?') ? `${g.next}&signed_in=1` : `${g.next}?signed_in=1`, [session]);
}

// ===================================================================== profile

export async function updateProfile(request, env, ctx, user) {
  const b = await readJson(request);
  const fields = {};
  if (b.name !== undefined) {
    const name = clean(b.name, 100);
    if (name.length < 2) return json({ error: 'validation', fields: { name: 'Enter your name.' } }, 422);
    fields.name = name;
  }
  if (b.phone !== undefined) {
    if (b.phone === '' || b.phone === null) fields.phone = null;
    else {
      const phone = normalisePhone(b.phone);
      if (!phone) return json({ error: 'validation', fields: { phone: 'Enter a 10-digit Indian mobile number.' } }, 422);
      fields.phone = phone;
    }
  }
  const keys = Object.keys(fields);
  if (keys.length) {
    await env.DB.prepare(`UPDATE users SET ${keys.map(k => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
      .bind(...keys.map(k => fields[k]), nowIso(), user.id).run();
  }
  return json({ user: publicUser({ ...user, ...fields }) });
}

// Change (needs the current password) or set (Google-only accounts) a password.
export async function changePassword(request, env, ctx, user) {
  const b = await readJson(request);
  const full = await getUserById(env, user.id);
  if (full.password_hash) {
    if (!(await auth.throttle(env, `pwchange:${user.id}`, 10, 900))) throw httpError(429, 'Too many attempts. Try again in 15 minutes.');
    if (!(await auth.verifyPassword(env, b.current_password, full.password_hash))) {
      return json({ error: 'validation', fields: { current_password: 'Your current password is incorrect.' } }, 422);
    }
  }
  const problem = passwordProblem(b.new_password, user.email);
  if (problem) return json({ error: 'validation', fields: { new_password: problem } }, 422);
  await env.DB.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').bind(await auth.hashPassword(env, b.new_password), nowIso(), user.id).run();
  await auth.endAllSessions(env, user.id, user.session_hash);   // sign out everywhere else
  await sendSafely(env, { to: user.email, ...email.passwordChangedEmail(env, user) });
  return json({ ok: true });
}

export async function unlinkGoogle(request, env, ctx, user) {
  if (!user.has_password) return json({ error: 'Set a password first, or you would have no way to sign in.' }, 409);
  await env.DB.prepare('UPDATE users SET google_sub = NULL, updated_at = ? WHERE id = ?').bind(nowIso(), user.id).run();
  return json({ ok: true });
}

// ===================================================================== addresses

const addressCols = 'id, label, name, phone, address_line1, address_line2, city, state_code, pincode, gstin, business_name, is_default';

export async function listAddresses(request, env, ctx, user) {
  const { results } = await env.DB.prepare(`SELECT ${addressCols} FROM addresses WHERE user_id = ? ORDER BY is_default DESC, id DESC`).bind(user.id).all();
  return json({ addresses: results });
}

export async function saveAddress(env, user, a, { makeDefault = false } = {}) {
  const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM addresses WHERE user_id = ?').bind(user.id).first();
  if (count.n >= MAX_ADDRESSES) throw httpError(409, `You can save up to ${MAX_ADDRESSES} addresses. Delete one first.`);
  const first = count.n === 0;
  if (makeDefault && !first) await env.DB.prepare('UPDATE addresses SET is_default = 0 WHERE user_id = ?').bind(user.id).run();
  return env.DB.prepare(`INSERT INTO addresses (user_id, label, name, phone, address_line1, address_line2, city, state_code, pincode, gstin, business_name, is_default)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?) RETURNING ${addressCols}`)
    .bind(user.id, a.label, a.name, a.phone, a.address_line1, a.address_line2, a.city, a.state_code, a.pincode, a.gstin, a.business_name, first || makeDefault ? 1 : 0).first();
}

export async function createAddress(request, env, ctx, user) {
  const b = await readJson(request);
  const v = validateAddress(b);
  if (!v.ok) return json({ error: 'validation', fields: v.errors }, 422);
  return json({ address: await saveAddress(env, user, v.value, { makeDefault: Boolean(b.is_default) }) }, 201);
}

export async function updateAddress(request, env, ctx, user, id) {
  const b = await readJson(request);
  const v = validateAddress(b);
  if (!v.ok) return json({ error: 'validation', fields: v.errors }, 422);
  const a = v.value;
  const row = await env.DB.prepare(`UPDATE addresses SET label=?, name=?, phone=?, address_line1=?, address_line2=?, city=?, state_code=?, pincode=?, gstin=?, business_name=?
    WHERE id = ? AND user_id = ? RETURNING ${addressCols}`)
    .bind(a.label, a.name, a.phone, a.address_line1, a.address_line2, a.city, a.state_code, a.pincode, a.gstin, a.business_name, id, user.id).first();
  if (!row) return json({ error: 'not found' }, 404);
  if (b.is_default) await setDefault(env, user, id);
  return json({ address: { ...row, is_default: b.is_default ? 1 : row.is_default } });
}

async function setDefault(env, user, id) {
  await env.DB.batch([
    env.DB.prepare('UPDATE addresses SET is_default = 0 WHERE user_id = ?').bind(user.id),
    env.DB.prepare('UPDATE addresses SET is_default = 1 WHERE id = ? AND user_id = ?').bind(id, user.id),
  ]);
}

export async function makeDefaultAddress(request, env, ctx, user, id) {
  await setDefault(env, user, id);
  return json({ ok: true });
}

export async function deleteAddress(request, env, ctx, user, id) {
  const r = await env.DB.prepare('DELETE FROM addresses WHERE id = ? AND user_id = ? RETURNING is_default').bind(id, user.id).first();
  if (!r) return json({ error: 'not found' }, 404);
  if (r.is_default) {
    await env.DB.prepare('UPDATE addresses SET is_default = 1 WHERE id = (SELECT id FROM addresses WHERE user_id = ? ORDER BY id DESC LIMIT 1)').bind(user.id).run();
  }
  return json({ ok: true });
}

// ===================================================================== cart

async function cartItems(env, userId) {
  const { results } = await env.DB.prepare('SELECT sku, quantity FROM cart_items WHERE user_id = ? ORDER BY added_at').bind(userId).all();
  return results.filter(r => PRODUCTS[r.sku]);
}

async function cartResponse(env, user, stateCode) {
  const items = await cartItems(env, user.id);
  const quote = items.length ? await orders.quoteItems(env, items, stateCode || null) : null;
  return json({ items, quote, max_quantity: MAX_QUANTITY });
}

export async function getCart(request, env, ctx, user) {
  return cartResponse(env, user, new URL(request.url).searchParams.get('state_code'));
}

async function writeCart(env, userId, items) {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM cart_items WHERE user_id = ?').bind(userId),
    ...items.map(i => env.DB.prepare('INSERT INTO cart_items (user_id, sku, quantity) VALUES (?,?,?)').bind(userId, i.sku, i.quantity)),
  ]);
}

// PUT /api/cart {items:[{sku,quantity}]}: replaces the cart (an empty list clears it).
export async function putCart(request, env, ctx, user) {
  const b = await readJson(request);
  if (Array.isArray(b.items) && b.items.length === 0) { await writeCart(env, user.id, []); return cartResponse(env, user); }
  const v = validateItems(b.items);
  if (!v.ok) return json({ error: v.errors.items }, 422);
  await writeCart(env, user.id, v.value);
  return cartResponse(env, user);
}

// Adds items to what is already in the cart (used by "add to cart", reorder and
// merging a signed-out cart at sign-in). Trims to the per-order limit.
export async function addToCart(env, userId, add) {
  const current = await cartItems(env, userId);
  const merged = {};
  for (const i of [...current, ...add]) merged[i.sku] = (merged[i.sku] || 0) + i.quantity;
  let room = MAX_QUANTITY;
  const list = [];
  for (const [sku, q] of Object.entries(merged)) {
    if (!PRODUCTS[sku] || room <= 0) continue;
    const take = Math.min(q, room);
    list.push({ sku, quantity: take });
    room -= take;
  }
  await writeCart(env, userId, list);
  return list.reduce((s, l) => s + l.quantity, 0) < Object.values(merged).reduce((s, q) => s + q, 0);
}

export async function postCartAdd(request, env, ctx, user) {
  const b = await readJson(request);
  const items = Array.isArray(b.items) ? b.items : [{ sku: b.sku, quantity: b.quantity ?? 1 }];
  const clamp = items.map(i => ({ sku: clean(i?.sku, 20).toLowerCase(), quantity: Math.max(1, Math.min(MAX_QUANTITY, Number(i?.quantity) || 1)) }))
    .filter(i => PRODUCTS[i.sku]);
  if (!clamp.length) return json({ error: 'Unknown product.' }, 422);
  const trimmed = await addToCart(env, user.id, clamp);
  const res = await cartResponse(env, user);
  const data = await res.json();
  return json({ ...data, trimmed });
}

// ===================================================================== orders

async function ownOrder(env, user, n) {
  const o = await orders.getByNumber(env, n);
  return o && o.user_id === user.id ? o : null;
}

export async function listOrders(request, env, ctx, user) {
  const { results } = await env.DB.prepare(`SELECT id, order_number, status, summary, item_count, total_paise, invoice_number,
      courier, tracking_number, tracking_url, expected_delivery, created_at, paid_at, processing_at, shipped_at, delivered_at, cancelled_at
    FROM orders WHERE user_id = ? AND status != 'created' ORDER BY id DESC LIMIT 100`).bind(user.id).all();
  return json({ orders: results.map(({ id, ...o }) => o) });
}

export async function getOrder(request, env, ctx, user, n) {
  const o = await ownOrder(env, user, n);
  if (!o) return json({ error: 'not found' }, 404);
  const service = await env.DB.prepare('SELECT request_number, kind, subject, status, updated_at FROM service_requests WHERE order_id = ? ORDER BY id DESC').bind(o.id).all();
  return json({
    order: { ...orders.publicView(o, await orders.getItems(env, o.id)), invoice_available: Boolean(o.zoho_invoice_id), timeline: await orderEvents(env, o.id, { visibleOnly: true }) },
    service_requests: service.results,
  });
}

export async function invoicePdf(request, env, ctx, user, n) {
  const o = await ownOrder(env, user, n);
  if (!o || !o.zoho_invoice_id) return json({ error: 'The invoice is not ready yet.' }, 404);
  const pdf = await zoho.invoicePdf(env, o.zoho_invoice_id);
  return new Response(pdf, {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `attachment; filename="${(o.invoice_number || o.order_number).replace(/[^\w.-]/g, '_')}.pdf"`,
      'cache-control': 'private, no-store',
    },
  });
}

export async function reorder(request, env, ctx, user, n) {
  const o = await ownOrder(env, user, n);
  if (!o) return json({ error: 'not found' }, 404);
  const items = (await orders.getItems(env, o.id)).filter(i => PRODUCTS[i.sku]).map(i => ({ sku: i.sku, quantity: i.quantity }));
  const trimmed = await addToCart(env, user.id, items);
  return json({ ok: true, trimmed });
}

// ===================================================================== service requests

const KINDS = ['repair', 'warranty', 'return', 'setup', 'other'];

export async function createService(request, env, ctx, user) {
  if (!(await auth.throttle(env, `service:${user.id}`, 10, 86400))) throw httpError(429, 'You have opened several requests today. Reply to an existing one, or email us.');
  const b = await readJson(request);
  const errors = {};
  const kind = KINDS.includes(b.kind) ? b.kind : null;
  if (!kind) errors.kind = 'Choose what you need help with.';
  const subject = clean(b.subject, 120);
  if (subject.length < 3) errors.subject = 'Give it a short title.';
  const message = typeof b.message === 'string' ? b.message.replace(/\r/g, '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim().slice(0, 4000) : '';
  if (message.length < 10) errors.message = 'Describe the problem in a sentence or two.';
  let order = null;
  if (b.order_number) {
    order = await ownOrder(env, user, String(b.order_number));
    if (!order) errors.order_number = 'Choose one of your orders.';
  }
  if (Object.keys(errors).length) return json({ error: 'validation', fields: errors }, 422);

  let sr;
  for (let i = 0; i < 5 && !sr; i++) {
    try {
      sr = await env.DB.prepare(`INSERT INTO service_requests (request_number, user_id, order_id, kind, subject, message) VALUES (?,?,?,?,?,?)
        RETURNING request_number, kind, subject, message, status, created_at`)
        .bind(newRequestNumber('SR'), user.id, order?.id ?? null, kind, subject, message).first();
    } catch (e) { if (!String(e.message).includes('UNIQUE') || i === 4) throw e; }
  }
  sr.order_number = order?.order_number || null;
  ctx.waitUntil(Promise.all([
    sendSafely(env, { to: user.email, ...email.serviceCreatedEmail(env, sr, user), idempotencyKey: `${sr.request_number}-created` }),
    env.ORDER_NOTIFY_EMAIL ? sendSafely(env, { to: env.ORDER_NOTIFY_EMAIL.split(',').map(s => s.trim()), replyTo: user.email, ...email.serviceTeamEmail(env, sr, user) }) : null,
  ]));
  return json({ service_request: sr }, 201);
}

export async function listService(request, env, ctx, user) {
  const { results } = await env.DB.prepare(`SELECT s.request_number, s.kind, s.subject, s.message, s.status, s.team_note, s.created_at, s.updated_at, o.order_number
    FROM service_requests s LEFT JOIN orders o ON o.id = s.order_id WHERE s.user_id = ? ORDER BY s.id DESC LIMIT 100`).bind(user.id).all();
  return json({ service_requests: results });
}

// Admin: change status and leave a note the customer sees (emailed to them).
export async function adminUpdateService(request, env, ctx, number) {
  const b = await readJson(request);
  const status = ['open', 'in_progress', 'resolved', 'closed'].includes(b.status) ? b.status : null;
  if (!status) return json({ error: 'status must be open, in_progress, resolved or closed' }, 422);
  const note = typeof b.team_note === 'string' ? b.team_note.trim().slice(0, 2000) : null;
  const sr = await env.DB.prepare(`UPDATE service_requests SET status = ?, team_note = COALESCE(?, team_note), updated_at = ? WHERE request_number = ?
    RETURNING request_number, user_id, kind, subject, status, team_note`).bind(status, note || null, nowIso(), number).first();
  if (!sr) return json({ error: 'not found' }, 404);
  if (b.notify !== false) {
    const user = await getUserById(env, sr.user_id);
    await sendSafely(env, { to: user.email, ...email.serviceUpdateEmail(env, sr, user) });
  }
  return json({ ok: true, service_request: sr });
}

export async function adminListService(request, env) {
  const status = new URL(request.url).searchParams.get('status');
  const stmt = env.DB.prepare(`SELECT s.request_number, s.kind, s.subject, s.message, s.status, s.team_note, s.created_at, s.updated_at,
      u.name, u.email, u.phone, o.order_number
    FROM service_requests s JOIN users u ON u.id = s.user_id LEFT JOIN orders o ON o.id = s.order_id
    ${status ? 'WHERE s.status = ?' : "WHERE s.status IN ('open','in_progress')"} ORDER BY s.id DESC LIMIT 200`);
  return json({ service_requests: (await (status ? stmt.bind(status) : stmt).all()).results });
}
