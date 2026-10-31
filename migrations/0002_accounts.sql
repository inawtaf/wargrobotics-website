-- Customer accounts: login, cart, saved addresses, service requests.

CREATE TABLE users (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  email              TEXT NOT NULL UNIQUE,              -- stored lower-case
  email_verified_at  TEXT,                              -- set by the email link, or by Google
  name               TEXT NOT NULL,
  phone              TEXT,
  password_hash      TEXT,                              -- NULL for Google-only accounts
  google_sub         TEXT UNIQUE,                       -- Google's stable account id
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- Signed-in browsers. Only a SHA-256 of the cookie value is stored, so a
-- leaked database cannot be used to sign in.
CREATE TABLE sessions (
  token_hash    TEXT PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at    INTEGER NOT NULL,                       -- unix seconds
  expires_at    INTEGER NOT NULL,
  user_agent    TEXT
);
CREATE INDEX idx_sessions_user ON sessions (user_id);

-- One-time links: email verification and password reset (hashed, short-lived).
CREATE TABLE auth_tokens (
  token_hash    TEXT PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose       TEXT NOT NULL CHECK (purpose IN ('verify','reset')),
  expires_at    INTEGER NOT NULL,
  used_at       INTEGER
);
CREATE INDEX idx_auth_tokens_user ON auth_tokens (user_id, purpose);

-- Failed logins and similar, counted per key (email or IP) per window.
CREATE TABLE throttle (
  key           TEXT PRIMARY KEY,
  count         INTEGER NOT NULL,
  window_start  INTEGER NOT NULL
);

CREATE TABLE addresses (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label          TEXT,                                  -- "Home", "Office"
  name           TEXT NOT NULL,
  phone          TEXT NOT NULL,
  address_line1  TEXT NOT NULL,
  address_line2  TEXT,
  city           TEXT NOT NULL,
  state_code     TEXT NOT NULL,
  pincode        TEXT NOT NULL,
  gstin          TEXT,
  business_name  TEXT,
  is_default     INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX idx_addresses_user ON addresses (user_id);

CREATE TABLE cart_items (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sku         TEXT NOT NULL,
  quantity    INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 9),
  added_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  PRIMARY KEY (user_id, sku)
);

CREATE TABLE service_requests (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  request_number  TEXT NOT NULL UNIQUE,                 -- SR-261026-K7Q2
  user_id         INTEGER NOT NULL REFERENCES users(id),
  order_id        INTEGER REFERENCES orders(id),
  kind            TEXT NOT NULL CHECK (kind IN ('repair','warranty','return','setup','other')),
  subject         TEXT NOT NULL,
  message         TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','resolved','closed')),
  team_note       TEXT,                                 -- latest update shown to the customer
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX idx_service_user   ON service_requests (user_id, id);
CREATE INDEX idx_service_status ON service_requests (status, id);
