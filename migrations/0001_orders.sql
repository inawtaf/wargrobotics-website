-- Orders for wargrobotics.com.
-- Apply with:  npx wrangler d1 migrations apply wargrobotics-orders --remote
-- All money is stored in paise (integer), never as a decimal.

CREATE TABLE orders (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  order_number          TEXT NOT NULL UNIQUE,          -- WR-261026-K7Q2, shown to the buyer
  user_id               INTEGER REFERENCES users(id),  -- account that placed it (see 0002)
  status                TEXT NOT NULL DEFAULT 'created'
                        CHECK (status IN ('created','paid','shipped','delivered','cancelled','refunded')),

  -- totals across all items (lines are in order_items)
  item_count            INTEGER NOT NULL,              -- total units, 1..9
  summary               TEXT NOT NULL,                 -- "Warg Ghost × 1, Warg Greywind × 2"
  subtotal_paise        INTEGER NOT NULL,              -- before GST
  gst_rate_bp           INTEGER NOT NULL,              -- basis points: 1800 = 18%
  gst_paise             INTEGER NOT NULL,
  total_paise           INTEGER NOT NULL,              -- what the buyer pays
  tax_kind              TEXT NOT NULL CHECK (tax_kind IN ('intra','inter')),  -- CGST+SGST or IGST

  -- buyer and delivery address (a copy: editing a saved address later
  -- must not change where a past order went)
  customer_name         TEXT NOT NULL,
  email                 TEXT NOT NULL,
  phone                 TEXT NOT NULL,
  address_line1         TEXT NOT NULL,
  address_line2         TEXT,
  city                  TEXT NOT NULL,
  state_code            TEXT NOT NULL,                 -- two-letter code, e.g. KA
  pincode               TEXT NOT NULL,
  gstin                 TEXT,                          -- only for business buyers
  business_name         TEXT,

  -- payment (Razorpay)
  razorpay_order_id     TEXT UNIQUE,
  razorpay_payment_id   TEXT,
  paid_at               TEXT,

  -- invoice (Zoho Books)
  zoho_contact_id       TEXT,
  zoho_invoice_id       TEXT,
  invoice_number        TEXT,
  invoice_error         TEXT,

  -- emails
  confirmation_sent_at  TEXT,
  invoice_sent_at       TEXT,
  team_notified_at      TEXT,
  dispatch_sent_at      TEXT,
  email_error           TEXT,

  -- shipping
  courier               TEXT,
  tracking_number       TEXT,
  tracking_url          TEXT,
  shipped_at            TEXT,
  delivered_at          TEXT,

  -- housekeeping
  fulfil_lock_until     INTEGER,                       -- unix seconds; stops two runs at once
  fulfil_attempts       INTEGER NOT NULL DEFAULT 0,
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE INDEX idx_orders_status ON orders (status, created_at);
CREATE INDEX idx_orders_user   ON orders (user_id, id);

-- One row per product in an order.
CREATE TABLE order_items (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id          INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  sku               TEXT NOT NULL,                     -- 'ghost' | 'greywind'
  product_name      TEXT NOT NULL,
  quantity          INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 9),
  price_type        TEXT NOT NULL CHECK (price_type IN ('offer','list')),
  unit_price_paise  INTEGER NOT NULL,                  -- before GST
  subtotal_paise    INTEGER NOT NULL,
  gst_paise         INTEGER NOT NULL
);
CREATE INDEX idx_order_items_order ON order_items (order_id);
CREATE INDEX idx_order_items_sku   ON order_items (sku, price_type);

-- Every payment event we receive, for audit and debugging.
CREATE TABLE payment_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id      INTEGER REFERENCES orders(id),
  source        TEXT NOT NULL,          -- 'checkout' | 'webhook'
  event         TEXT NOT NULL,          -- e.g. payment.captured
  payment_id    TEXT,
  amount_paise  INTEGER,
  payload       TEXT,                   -- raw JSON, trimmed
  received_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX idx_payment_events_order ON payment_events (order_id);

-- Small key/value cache (Zoho access token).
CREATE TABLE kv (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  expires_at  INTEGER NOT NULL          -- unix seconds
);
