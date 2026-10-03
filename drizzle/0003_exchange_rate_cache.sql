CREATE TABLE IF NOT EXISTS exchange_rate_cache (
  cache_key TEXT PRIMARY KEY NOT NULL,
  quote_json TEXT NOT NULL,
  stored_at TEXT NOT NULL
);
