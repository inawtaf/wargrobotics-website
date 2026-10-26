import { PRODUCTS, MAX_QUANTITY, STATE_BY_CODE } from './config.js';

const clean = (v, max = 200) =>
  typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';

const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

// Validates the checkout form. Returns { ok, value } or { ok:false, errors:{field:msg} }.
export function validateOrder(body) {
  const errors = {};
  const b = body && typeof body === 'object' ? body : {};

  const sku = clean(b.sku, 20).toLowerCase();
  if (!PRODUCTS[sku]) errors.sku = 'Choose Ghost or Greywind.';

  const quantity = Number(b.quantity);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) {
    errors.quantity = `Between 1 and ${MAX_QUANTITY}. For more, contact us for a bulk order.`;
  }

  const name = clean(b.name, 100);
  if (name.length < 2) errors.name = 'Enter your full name.';

  const email = clean(b.email, 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) errors.email = 'Enter a valid email address.';

  // Indian mobile: optional +91 / 0 prefix, then 10 digits starting 6-9.
  const phoneDigits = clean(b.phone, 20).replace(/[\s\-().]/g, '');
  const m = phoneDigits.match(/^(?:\+?91|0)?([6-9][0-9]{9})$/);
  if (!m) errors.phone = 'Enter a 10-digit Indian mobile number; the courier needs it.';
  const phone = m ? `+91${m[1]}` : '';

  const address_line1 = clean(b.address_line1, 150);
  if (address_line1.length < 5) errors.address_line1 = 'Enter the house, building and street.';
  const address_line2 = clean(b.address_line2, 150) || null;

  const city = clean(b.city, 80);
  if (city.length < 2) errors.city = 'Enter the city or town.';

  const state_code = clean(b.state_code, 2).toUpperCase();
  if (!STATE_BY_CODE[state_code]) errors.state_code = 'Choose the state.';

  const pincode = clean(b.pincode, 6);
  if (!/^[1-9][0-9]{5}$/.test(pincode)) errors.pincode = 'Enter the 6-digit pincode.';

  let gstin = clean(b.gstin, 15).toUpperCase() || null;
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

  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    value: { sku, quantity, name, email, phone, address_line1, address_line2, city, state_code, pincode, gstin, business_name },
  };
}
