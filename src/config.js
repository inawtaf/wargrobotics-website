// Catalogue, tax and state settings. Prices are in paise and exclude GST.
// Change a price here and redeploy; the checkout page reads it from /api/products.

export const PRODUCTS = {
  ghost: {
    sku: 'ghost',
    name: 'Warg Ghost',
    line: '720p90 · 8 GB onboard',
    listPricePaise: 24_999_00,
    offerPricePaise: 19_999_00,
    offerUnits: 100,               // "Offer price, first 100 orders" (counted in units)
    zohoItemVar: 'ZOHO_ITEM_ID_GHOST',
  },
  greywind: {
    sku: 'greywind',
    name: 'Warg Greywind',
    line: '1080p30 / 720p90 · 16 GB onboard',
    listPricePaise: 29_999_00,
    offerPricePaise: 24_999_00,
    offerUnits: 100,
    zohoItemVar: 'ZOHO_ITEM_ID_GREYWIND',
  },
};

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
