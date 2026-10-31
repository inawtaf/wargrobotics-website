// Billing address and GST place of supply of a stored order.

// The invoice "Bill to". Orders from before billing addresses existed bill the delivery address.
export function billingOf(o) {
  if (!o.billing_line1) {
    return { name: o.customer_name, phone: o.phone, address_line1: o.address_line1, address_line2: o.address_line2, city: o.city, state_code: o.state_code, pincode: o.pincode, same: true };
  }
  const b = { name: o.billing_name, phone: o.billing_phone, address_line1: o.billing_line1, address_line2: o.billing_line2, city: o.billing_city, state_code: o.billing_state_code, pincode: o.billing_pincode };
  b.same = ['address_line1', 'address_line2', 'city', 'state_code', 'pincode'].every(k => (b[k] || '') === (o[k] || '')) && b.name === o.customer_name;
  return b;
}
export const placeOfSupply = o => o.place_of_supply || o.state_code;

