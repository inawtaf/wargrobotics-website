import { PRODUCTS, GST_RATE_BP } from './config.js';

// Which price applies, given how many units already sold at the offer price.
// The whole order gets the offer price only if all of it fits in what's left.
export function unitPrice(product, unitsSoldAtOffer, quantity) {
  const left = Math.max(0, product.offerUnits - unitsSoldAtOffer);
  if (quantity <= left) {
    return { priceType: 'offer', unitPricePaise: product.offerPricePaise, offerUnitsLeft: left };
  }
  return { priceType: 'list', unitPricePaise: product.listPricePaise, offerUnitsLeft: left };
}

// GST is added on top of the listed price.
// intra-state (buyer in the seller's state): CGST + SGST, half each.
// inter-state: IGST, the whole rate.
export function quote({ sku, quantity, unitsSoldAtOffer, buyerState, sellerState }) {
  const product = PRODUCTS[sku];
  if (!product) throw new Error(`unknown product ${sku}`);
  const p = unitPrice(product, unitsSoldAtOffer, quantity);
  const subtotal = p.unitPricePaise * quantity;
  const gst = Math.round((subtotal * GST_RATE_BP) / 10_000);
  const taxKind = buyerState && buyerState === sellerState ? 'intra' : 'inter';
  const lines = taxKind === 'intra'
    ? [
        { label: `CGST ${GST_RATE_BP / 200}%`, paise: Math.floor(gst / 2) },
        { label: `SGST ${GST_RATE_BP / 200}%`, paise: gst - Math.floor(gst / 2) },
      ]
    : [{ label: `IGST ${GST_RATE_BP / 100}%`, paise: gst }];
  return {
    sku,
    productName: product.name,
    quantity,
    priceType: p.priceType,
    unitPricePaise: p.unitPricePaise,
    listPricePaise: product.listPricePaise,
    offerUnitsLeft: p.offerUnitsLeft,
    subtotalPaise: subtotal,
    gstRateBp: GST_RATE_BP,
    gstPaise: gst,
    taxKind,
    taxLines: lines,
    totalPaise: subtotal + gst,
  };
}

export const rupees = paise => (paise / 100).toFixed(2);
