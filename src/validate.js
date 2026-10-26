import { PRODUCTS, MAX_QUANTITY, STATE_BY_CODE } from './config.js';

export const clean = (v, max = 200) =>
  typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';

const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const result = (errors, value) => (Object.keys(errors).length ? { ok: false, errors } : { ok: true, value });

export function normalisePhone(raw) {
  const digits = clean(raw, 20).replace(/[\s\-().]/g, '');
  const m = digits.match(/^(?:\+?91|0)?([6-9][0-9]{9})$/);
  return m ? `+91${m[1]}` : null;
}

// A delivery address (checkout or saved address book).
export function validateAddress(b) {
  b = b && typeof b === 'object' ? b : {};
  const errors = {};

  const label = clean(b.label, 30) || null;
  const name = clean(b.name, 100);
  if (name.length < 2) errors.name = 'Enter the name of the person receiving it.';

  const phone = normalisePhone(b.phone);
  if (!phone) errors.phone = 'Enter a 10-digit Indian mobile number; the courier needs it.';

  const address_line1 = clean(b.address_line1, 150);
  if (address_line1.length < 5) errors.address_line1 = 'Enter the house, building and street.';
  const address_line2 = clean(b.address_line2, 150) || null;

  const city = clean(b.city, 80);
  if (city.length < 2) errors.city = 'Enter the city or town.';

  const state_code = clean(b.state_code, 2).toUpperCase();
  if (!STATE_BY_CODE[state_code]) errors.state_code = 'Choose the state.';

  const pincode = clean(b.pincode, 6);
  if (!/^[1-9][0-9]{5}$/.test(pincode)) errors.pincode = 'Enter the 6-digit pincode.';

  const gstin = clean(b.gstin, 15).toUpperCase() || null;
  let business_name = clean(b.business_name, 150) || null;
  if (gstin) {
    if (!GSTIN_RE.test(gstin)) {
      errors.gstin = 'That does not look like a GSTIN (15 characters, e.g. 29ABCDE1234F1Z5).';
    } else if (STATE_BY_CODE[state_code] && gstin.slice(0, 2) !== STATE_BY_CODE[state_code].gst) {
      errors.gstin = `This GSTIN is registered outside ${STATE_BY_CODE[state_code].name}. Use the delivery state of that registration.`;
    }
    if (!business_name) errors.business_name = 'Enter the business name on the GST registration.';
  } else {
    business_name = null;
  }

  return result(errors, { label, name, phone, address_line1, address_line2, city, state_code, pincode, gstin, business_name });
}

// Cart lines: [{ sku, quantity }]. Merges duplicates; total units capped.
export function validateItems(items) {
  if (!Array.isArray(items) || !items.length) return { ok: false, errors: { items: 'Your cart is empty.' } };
  const merged = {};
  for (const it of items.slice(0, 20)) {
    const sku = clean(it?.sku, 20).toLowerCase();
    const q = Number(it?.quantity);
    if (!PRODUCTS[sku] || !Number.isInteger(q) || q < 1) return { ok: false, errors: { items: 'Your cart has an item we do not sell.' } };
    merged[sku] = (merged[sku] || 0) + q;
  }
  const list = Object.entries(merged).map(([sku, quantity]) => ({ sku, quantity }));
  const total = list.reduce((s, l) => s + l.quantity, 0);
  if (total > MAX_QUANTITY) return { ok: false, errors: { items: `Up to ${MAX_QUANTITY} units per order. For more, contact us for a bulk order.` } };
  return { ok: true, value: list };
}

export function validateEmail(raw) {
  const email = clean(raw, 254).toLowerCase();
  return EMAIL_RE.test(email) ? email : null;
}

// Passwords: long beats complex. 10+ characters, not the email, not trivially common.
const COMMON = new Set(['password12', 'password123', '1234567890', 'qwertyuiop', '1q2w3e4r5t', 'iloveyou12', 'wargrobotics', 'warg123456']);
export function passwordProblem(password, email) {
  if (typeof password !== 'string' || password.length < 10) return 'Use at least 10 characters.';
  if (password.length > 200) return 'Use at most 200 characters.';
  const lower = password.toLowerCase();
  if (COMMON.has(lower) || /^(.)\1+$/.test(password)) return 'That password is too easy to guess.';
  if (email && lower === email.toLowerCase()) return 'Do not use your email as the password.';
  return null;
}

export function validateRegistration(b) {
  b = b && typeof b === 'object' ? b : {};
  const errors = {};
  const name = clean(b.name, 100);
  if (name.length < 2) errors.name = 'Enter your name.';
  const email = validateEmail(b.email);
  if (!email) errors.email = 'Enter a valid email address.';
  const pw = passwordProblem(b.password, email);
  if (pw) errors.password = pw;
  return result(errors, { name, email, password: b.password });
}
