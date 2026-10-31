// Catalogue, tax and state settings. Prices are in paise and exclude GST.
// Change a price here and redeploy; the checkout page reads it from /api/products.

export const PRODUCTS = {
  ghost: {
    sku: 'ghost',
    name: 'Warg Ghost',
    line: '720p90 · 8 GB onboard',
    listPricePaise: 29_999_00,
    zohoItemVar: 'ZOHO_ITEM_ID_GHOST',
  },
  greywind: {
    sku: 'greywind',
    name: 'Warg Greywind',
    line: '1080p30 / 720p90 · 16 GB onboard',
    listPricePaise: 35_999_00,
    zohoItemVar: 'ZOHO_ITEM_ID_GREYWIND',
  },
};

// One Ghost + one Greywind together cost this (before GST). Applied
// automatically to every pair in the cart.
export const COMBO = { skus: ['ghost', 'greywind'], pricePaise: 49_999_00, label: 'Ghost + Greywind combo' };

// Launch coupon: percent off items that aren't in a combo pair (the combo is
// always the better price, so the two never stack). Works for the first
// `maxOrders` paid orders that used it.
export const COUPON = { code: 'WARG20', percent: 20, maxOrders: 100 };

export const GST_RATE_BP = 1800;   // 18%, in basis points
export const MAX_QUANTITY = 9;     // ten or more is a bulk order (see prebook page)

// Indian states and union territories.
//   code: two-letter code sent to Zoho Books as place_of_supply.
//   gst:  first two digits of a GSTIN registered in that state.
// Zoho's codes follow its own list; four differ between sources (marked *).
// If Zoho rejects a place_of_supply, check that state's code in Zoho Books
// (Settings > Taxes > GST) and change it here.
export const STATES = [
  { code: 'AN', gst: '35', name: 'Andaman and Nicobar Islands' },
  { code: 'AP', gst: '37', name: 'Andhra Pradesh' },
  { code: 'AR', gst: '12', name: 'Arunachal Pradesh' },
  { code: 'AS', gst: '18', name: 'Assam' },
  { code: 'BR', gst: '10', name: 'Bihar' },
  { code: 'CH', gst: '04', name: 'Chandigarh' },
  { code: 'CG', gst: '22', name: 'Chhattisgarh' },                 // * some lists use CT
  { code: 'DN', gst: '26', name: 'Dadra and Nagar Haveli and Daman and Diu' },
  { code: 'DL', gst: '07', name: 'Delhi' },
  { code: 'GA', gst: '30', name: 'Goa' },
  { code: 'GJ', gst: '24', name: 'Gujarat' },
  { code: 'HR', gst: '06', name: 'Haryana' },
  { code: 'HP', gst: '02', name: 'Himachal Pradesh' },
  { code: 'JK', gst: '01', name: 'Jammu and Kashmir' },
  { code: 'JH', gst: '20', name: 'Jharkhand' },
  { code: 'KA', gst: '29', name: 'Karnataka' },
  { code: 'KL', gst: '32', name: 'Kerala' },
  { code: 'LA', gst: '38', name: 'Ladakh' },
  { code: 'LD', gst: '31', name: 'Lakshadweep' },
  { code: 'MP', gst: '23', name: 'Madhya Pradesh' },
  { code: 'MH', gst: '27', name: 'Maharashtra' },
  { code: 'MN', gst: '14', name: 'Manipur' },
  { code: 'ML', gst: '17', name: 'Meghalaya' },
  { code: 'MZ', gst: '15', name: 'Mizoram' },
  { code: 'NL', gst: '13', name: 'Nagaland' },
  { code: 'OR', gst: '21', name: 'Odisha' },                       // * some lists use OD
  { code: 'PY', gst: '34', name: 'Puducherry' },
  { code: 'PB', gst: '03', name: 'Punjab' },
  { code: 'RJ', gst: '08', name: 'Rajasthan' },
  { code: 'SK', gst: '11', name: 'Sikkim' },
  { code: 'TN', gst: '33', name: 'Tamil Nadu' },
  { code: 'TS', gst: '36', name: 'Telangana' },                    // * some lists use TG
  { code: 'TR', gst: '16', name: 'Tripura' },
  { code: 'UP', gst: '09', name: 'Uttar Pradesh' },
  { code: 'UK', gst: '05', name: 'Uttarakhand' },                  // * some lists use UT
  { code: 'WB', gst: '19', name: 'West Bengal' },
];

export const STATE_BY_CODE = Object.fromEntries(STATES.map(s => [s.code, s]));

// Which pincodes belong to which state, by their first three digits (inclusive
// ranges). India Post assigns pincodes by postal circle, so this is a
// plausibility check, deliberately generous at the borders: it catches a
// Karnataka pincode with "Goa" picked as the state, not every typo.
export const PIN_PREFIXES = {
  AN: [[744, 744]], AP: [[515, 535]], AR: [[790, 792]], AS: [[781, 788]], BR: [[800, 855]], CH: [[160, 160]],
  CG: [[490, 497]], DN: [[362, 362], [396, 396]], DL: [[110, 110]], GA: [[403, 403]], GJ: [[360, 396]],
  HR: [[121, 136]], HP: [[171, 177]], JK: [[180, 194]], JH: [[813, 835]], KA: [[560, 591]], KL: [[670, 695]],
  LA: [[194, 194]], LD: [[682, 682]], MP: [[450, 488]], MH: [[400, 402], [404, 445]], MN: [[795, 795]], ML: [[793, 794]],
  MZ: [[796, 796]], NL: [[797, 798]], OR: [[751, 770]], PY: [[533, 533], [605, 605], [607, 607], [609, 609], [673, 673]],
  PB: [[140, 160]], RJ: [[301, 345]], SK: [[737, 737]], TN: [[600, 643]], TS: [[500, 509]], TR: [[799, 799]],
  UP: [[201, 285]], UK: [[244, 263]], WB: [[700, 736], [738, 743]],
};

export function pincodeFitsState(pincode, stateCode) {
  const ranges = PIN_PREFIXES[stateCode];
  if (!ranges) return true;
  const p = Number(String(pincode).slice(0, 3));
  return ranges.some(([a, b]) => p >= a && p <= b);
}

// The state(s) a pincode most likely belongs to, for the error message.
export function statesForPincode(pincode) {
  const p = Number(String(pincode).slice(0, 3));
  return Object.entries(PIN_PREFIXES).filter(([, rs]) => rs.some(([a, b]) => p >= a && p <= b)).map(([c]) => c);
}
