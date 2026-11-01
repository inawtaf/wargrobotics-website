import { PRODUCTS, GST_RATE_BP, MAX_QUANTITY, COMBO, COUPON } from './config.js';

const gstOn = paise => Math.round((paise * GST_RATE_BP) / 10_000);

// A combo pair's discount, split between its two lines in proportion to their
// list prices (whole paise; the second line takes the remainder), so each
// invoice line carries its own share.
export function comboShares() {
  const [a, b] = COMBO.skus.map(s => PRODUCTS[s].listPricePaise);
  const total = a + b - COMBO.pricePaise;
  const first = Math.round((total * a) / (a + b));
  return { [COMBO.skus[0]]: first, [COMBO.skus[1]]: total - first, total };
}

// Discount per unit: what takes the price down to the coupon price, which is
// percent off rounded down to whole rupees (29,999 -> 23,999; 35,999 -> 28,799).
export const couponUnitDiscount = sku => {
  const list = PRODUCTS[sku].listPricePaise;
  return list - Math.floor((list * (100 - COUPON.percent)) / 100 / 100) * 100;
};

export const couponExpired = (now = Date.now()) => now > Date.parse(COUPON.validUntil);

// What a requested coupon code does, given how many uses are left.
export function couponStatus(code, usesLeft, now = Date.now()) {
  if (!code) return { code: null, status: 'none' };
  const c = String(code).trim().toUpperCase();
  if (c !== COUPON.code) return { code: c, status: 'invalid', message: `${c} is not a valid coupon.` };
  if (couponExpired(now)) return { code: c, status: 'used_up', message: `Coupon ${c} was valid until ${COUPON.validUntilText} and has ended.` };
  if (!(usesLeft > 0)) return { code: c, status: 'used_up', message: `Coupon ${c} has been used by the first ${COUPON.maxOrders} orders and has ended.` };
  return { code: c, status: 'ok' };
}

// Prices a cart. GST is added on top, per line, on the price after discounts
// (as Zoho Books does with line discounts before tax), then summed.
//   intra-state (buyer in the seller's state): CGST + SGST, half each.
//   inter-state: IGST, the whole rate.
// items: [{ sku, quantity }]   coupon: { code, usesLeft } (optional)
export function quoteCart({ items, buyerState, sellerState, coupon = {} }) {   // coupon: { code, usesLeft, now? }
  if (!Array.isArray(items) || !items.length) throw new Error('cart is empty');
  const qty = {};
  for (const { sku, quantity } of items) {
    if (!PRODUCTS[sku]) throw new Error(`unknown product ${sku}`);
    qty[sku] = (qty[sku] || 0) + quantity;
  }
  const pairs = Math.min(...COMBO.skus.map(s => qty[s] || 0));
  const shares = comboShares();
  const cs = couponStatus(coupon.code, coupon.usesLeft, coupon.now);
  const couponOn = cs.status === 'ok';

  const lines = Object.entries(qty).map(([sku, quantity]) => {
    const product = PRODUCTS[sku];
    const comboUnits = COMBO.skus.includes(sku) ? pairs : 0;
    const couponUnits = couponOn ? quantity - comboUnits : 0;
    const listSubtotal = product.listPricePaise * quantity;
    const comboDiscount = comboUnits * shares[sku];
    const couponDiscount = couponUnits * couponUnitDiscount(sku);
    const discount = comboDiscount + couponDiscount;
    const subtotal = listSubtotal - discount;
    const labels = [];
    if (comboUnits) labels.push(`${comboUnits} in combo`);
    if (couponUnits) labels.push(`${couponUnits} with ${COUPON.code} (${COUPON.percent}% off)`);
    return {
      sku, productName: product.name, line: product.line, quantity,
      priceType: 'list', unitPricePaise: product.listPricePaise, listPricePaise: product.listPricePaise,
      listSubtotalPaise: listSubtotal, comboUnits, couponUnits,
      comboDiscountPaise: comboDiscount, couponDiscountPaise: couponDiscount, discountPaise: discount,
      discountLabel: labels.join(', ') || null,
      subtotalPaise: subtotal, gstPaise: gstOn(subtotal),
    };
  });

  const sum = k => lines.reduce((s, l) => s + l[k], 0);
  const itemCount = sum('quantity');
  const comboDiscount = sum('comboDiscountPaise');
  const couponDiscount = sum('couponDiscountPaise');
  const subtotal = sum('subtotalPaise');
  const gst = sum('gstPaise');
  const taxKind = buyerState && buyerState === sellerState ? 'intra' : 'inter';
  const taxLines = taxKind === 'intra'
    ? [
        { label: `CGST ${GST_RATE_BP / 200}%`, paise: Math.floor(gst / 2) },
        { label: `SGST ${GST_RATE_BP / 200}%`, paise: gst - Math.floor(gst / 2) },
      ]
    : [{ label: `IGST ${GST_RATE_BP / 100}%`, paise: gst }];
  const discounts = [];
  if (comboDiscount) discounts.push({ kind: 'combo', label: `${COMBO.label}${pairs > 1 ? ` × ${pairs}` : ''}`, paise: comboDiscount });
  if (couponDiscount) discounts.push({ kind: 'coupon', label: `Coupon ${COUPON.code} (${COUPON.percent}% off)`, paise: couponDiscount });

  let couponInfo = cs;
  if (couponOn && !couponDiscount) couponInfo = { ...cs, status: 'no_items', message: 'The combo price is already lower than the coupon, so the coupon adds nothing to this cart.' };
  if (couponOn && couponDiscount) couponInfo = { ...cs, status: 'applied', discountPaise: couponDiscount };

  return {
    lines,
    itemCount,
    overLimit: itemCount > MAX_QUANTITY,
    summary: lines.map(l => `${l.productName} × ${l.quantity}`).join(', '),
    listSubtotalPaise: sum('listSubtotalPaise'),
    comboPairs: pairs,
    comboDiscountPaise: comboDiscount,
    couponDiscountPaise: couponDiscount,
    discountPaise: comboDiscount + couponDiscount,
    discounts,
    coupon: couponInfo,
    subtotalPaise: subtotal,          // taxable value, after discounts
    gstRateBp: GST_RATE_BP,
    gstPaise: gst,
    taxKind,
    taxLines,
    totalPaise: subtotal + gst,
  };
}

export const rupees = paise => (paise / 100).toFixed(2);
