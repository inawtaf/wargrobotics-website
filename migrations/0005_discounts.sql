-- Combo price and coupon discounts (31 Oct). subtotal_paise stays the taxable
-- value (after discounts); these record what was taken off and why.

ALTER TABLE orders ADD COLUMN list_subtotal_paise    INTEGER;               -- before discounts
ALTER TABLE orders ADD COLUMN combo_discount_paise   INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN coupon_code            TEXT;                  -- set only when the coupon took money off
ALTER TABLE orders ADD COLUMN coupon_discount_paise  INTEGER NOT NULL DEFAULT 0;

ALTER TABLE order_items ADD COLUMN discount_paise    INTEGER NOT NULL DEFAULT 0;
ALTER TABLE order_items ADD COLUMN discount_label    TEXT;                  -- "1 in combo, 1 with WARG20 (20% off)"

CREATE INDEX idx_orders_coupon ON orders (coupon_code, status);
