-- Incremental cost book. Safe to run more than once.
-- Does not read, rewrite, or delete catalogs, auth_sessions, login_attempts, or exchange_rate_cache.

CREATE TABLE IF NOT EXISTS product_cost_prices (
  catalog_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  cost_cents INTEGER,
  spec_fingerprint TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'missing',
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  batch_id TEXT,
  PRIMARY KEY (catalog_id, product_id)
);

CREATE TABLE IF NOT EXISTS product_price_meta (
  catalog_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  sales_updated_at TEXT,
  sales_updated_by TEXT,
  PRIMARY KEY (catalog_id, product_id)
);

CREATE TABLE IF NOT EXISTS cost_price_book_state (
  book_id TEXT PRIMARY KEY NOT NULL,
  revision INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  last_request_id TEXT NOT NULL DEFAULT ''
);

INSERT INTO cost_price_book_state (book_id, revision, updated_at, last_request_id)
VALUES ('shared-cost', 0, '1970-01-01T00:00:00.000Z', '')
ON CONFLICT(book_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS price_change_batches (
  request_id TEXT PRIMARY KEY NOT NULL,
  batch_id TEXT NOT NULL,
  actor TEXT NOT NULL,
  created_at TEXT NOT NULL,
  source_type TEXT NOT NULL,
  product_ids TEXT NOT NULL,
  before_json TEXT NOT NULL,
  after_json TEXT NOT NULL,
  result TEXT NOT NULL
);
