-- Separate billing address on orders (the invoice "Bill to"), and a default
-- billing address in the address book. Orders from before this have no
-- billing_* values: their billing address is the delivery address.

ALTER TABLE orders ADD COLUMN billing_name        TEXT;
ALTER TABLE orders ADD COLUMN billing_phone       TEXT;
ALTER TABLE orders ADD COLUMN billing_line1       TEXT;
ALTER TABLE orders ADD COLUMN billing_line2       TEXT;
ALTER TABLE orders ADD COLUMN billing_city        TEXT;
ALTER TABLE orders ADD COLUMN billing_state_code  TEXT;
ALTER TABLE orders ADD COLUMN billing_pincode     TEXT;
-- GST place of supply: the GSTIN's state for a business invoice, else the delivery state.
ALTER TABLE orders ADD COLUMN place_of_supply     TEXT;

ALTER TABLE addresses ADD COLUMN is_default_billing INTEGER NOT NULL DEFAULT 0;
