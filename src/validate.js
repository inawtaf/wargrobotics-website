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

// An address (checkout delivery or billing, or the saved address book).
// Billing addresses may leave out the phone: { phoneRequired: false }.
export function validateAddress(b, { phoneRequired = true } = {}) {
  b = b && typeof b === 'object' ? b : {};
  const errors = {};

  const label = clean(b.label, 30) || null;
  const name = clean(b.name, 100);
  if (name.length < 2) errors.name = 'Enter the name of the person receiving it.';

  const phone = normalisePhone(b.phone);
  if (!phone && (phoneRequired || clean(b.phone, 20))) errors.phone = phoneRequired ? 'Enter a 10-digit Indian mobile number; the courier needs it.' : 'Enter a 10-digit Indian mobile number, or leave it empty.';

  const address_line1 = clean(b.address_line1, 150);
  if (address_line1.length < 5) errors.address_line1 = 'Enter the house, building and street.';
  const address_line2 = clean(b.address_line2, 150) || null;

  const city = clean(b.city, 80);
  if (city.length < 2) errors.city = 'Enter the city or town.';

  const state_code = clean(b.state_code, 2).toUpperCase();
  if (!STATE_BY_CODE[state_code]) errors.state_code = 'Choose the state.';

  const pincode = clean(b.pincode, 6);
  if (!/^[1-9][0-9]{5}$/.test(pincode)) errors.pincode = 'Enter the 6-digit pincode.';

  const gst = validateGst(b.gstin, b.business_name, state_code);
  Object.assign(errors, gst.errors);

  return result(errors, { label, name, phone: phone || null, address_line1, address_line2, city, state_code, pincode, gstin: gst.gstin, business_name: gst.business_name });
}

// GSTIN + business name, checked against the state of the address they belong to.
export function validateGst(rawGstin, rawBusiness, stateCode) {
  const errors = {};
  const gstin = clean(rawGstin, 40).toUpperCase().replace(/\s/g, '') || null;   // too long fails the pattern below
  let business_name = clean(rawBusiness, 150) || null;
  if (gstin) {
    if (!GSTIN_RE.test(gstin)) {
      errors.gstin = 'That does not look like a GSTIN (15 characters, e.g. 30ABCDE1234F1Z5).';
    } else if (STATE_BY_CODE[stateCode] && gstin.slice(0, 2) !== STATE_BY_CODE[stateCode].gst) {
      const reg = Object.values(STATE_BY_CODE).find(s => s.gst === gstin.slice(0, 2));
      errors.gstin = `This GSTIN is registered in ${reg ? reg.name : 'another state'}, but the billing address is in ${STATE_BY_CODE[stateCode].name}. Use an address in the state where the GSTIN is registered.`;
    }
    if (!business_name) errors.business_name = 'Enter the business name on the GST registration.';
  } else {
    business_name = null;
  }
  return { errors, gstin, business_name };
}

// Checkout: delivery address, billing address (or "same as delivery") and the
// optional GSTIN, which belongs to the billing address. Inputs are already
// validated addresses; this decides the invoice details and place of supply.
//   GST place of supply for goods: with a GSTIN, the registration's state
//   (the billing state); without one, where the goods are delivered.
export function checkoutAddresses({ delivery, billing, billingSame, gstin, businessName }) {
  const bill = billingSame || !billing ? { ...delivery } : billing;
  const gst = validateGst(gstin, businessName, bill.state_code);
  if (Object.keys(gst.errors).length) return { ok: false, errors: gst.errors };
  return {
    ok: true,
    value: {
      delivery: { ...delivery, gstin: null, business_name: null },
      billing: { name: bill.name, phone: bill.phone || null, address_line1: bill.address_line1, address_line2: bill.address_line2 || null, city: bill.city, state_code: bill.state_code, pincode: bill.pincode },
      billingSame: Boolean(billingSame || !billing),
      gstin: gst.gstin,
      business_name: gst.business_name,
      place_of_supply: gst.gstin ? bill.state_code : delivery.state_code,
    },
  };
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
