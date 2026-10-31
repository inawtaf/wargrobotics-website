import { PRODUCTS, GST_RATE_BP, MAX_QUANTITY } from './config.js';

// Which price applies, given how many units already sold at the offer price.
// A line gets the offer price only if all of its units fit in what's left.
export function unitPrice(product, unitsSoldAtOffer, quantity) {
  const left = Math.max(0, product.offerUnits - unitsSoldAtOffer);
  if (quantity <= left) {
    return { priceType: 'offer', unitPricePaise: product.offerPricePaise, offerUnitsLeft: left };
  }
  return { priceType: 'list', unitPricePaise: product.listPricePaise, offerUnitsLeft: left };
}

const gstOn = paise => Math.round((paise * GST_RATE_BP) / 10_000);

// Prices a cart. GST is added on top of the listed price, per line (as Zoho
// Books does), then summed.
//   intra-state (buyer in the seller's state): CGST + SGST, half each.
//   inter-state: IGST, the whole rate.
// items: [{ sku, quantity }]  soldAtOffer: { sku: units already sold at offer }
export function quoteCart({ items, soldAtOffer = {}, buyerState, sellerState }) {
  if (!Array.isArray(items) || !items.length) throw new Error('cart is empty');
  const lines = items.map(({ sku, quantity }) => {
    const product = PRODUCTS[sku];
    if (!product) throw new Error(`unknown product ${sku}`);
    const p = unitPrice(product, soldAtOffer[sku] || 0, quantity);
    const subtotal = p.unitPricePaise * quantity;
    return {
      sku, productName: product.name, line: product.line, quantity,
      priceType: p.priceType, unitPricePaise: p.unitPricePaise, listPricePaise: product.listPricePaise,
      offerUnitsLeft: p.offerUnitsLeft, subtotalPaise: subtotal, gstPaise: gstOn(subtotal),
    };
  });
  const itemCount = lines.reduce((s, l) => s + l.quantity, 0);
  const subtotal = lines.reduce((s, l) => s + l.subtotalPaise, 0);
  const gst = lines.reduce((s, l) => s + l.gstPaise, 0);
  const taxKind = buyerState && buyerState === sellerState ? 'intra' : 'inter';
  const taxLines = taxKind === 'intra'
    ? [
        { label: `CGST ${GST_RATE_BP / 200}%`, paise: Math.floor(gst / 2) },
        { label: `SGST ${GST_RATE_BP / 200}%`, paise: gst - Math.floor(gst / 2) },
      ]
    : [{ label: `IGST ${GST_RATE_BP / 100}%`, paise: gst }];
  return {
    lines,
    itemCount,
    overLimit: itemCount > MAX_QUANTITY,
    summary: lines.map(l => `${l.productName} × ${l.quantity}`).join(', '),
    subtotalPaise: subtotal,
    gstRateBp: GST_RATE_BP,
    gstPaise: gst,
    taxKind,
    taxLines,
    totalPaise: subtotal + gst,
  };
}

export const rupees = paise => (paise / 100).toFixed(2);
