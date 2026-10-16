-- Rolls back ONLY the cost-price structures added by 0004_cost_prices.sql.
-- Does not touch catalogs, auth_sessions, login_attempts, or exchange_rate_cache.
-- Production app rollback must NOT run this file: keep the cost tables and audit rows,
-- restore the previous application, and disable the 111 entry instead.

DROP TABLE IF EXISTS price_change_batches;
DROP TABLE IF EXISTS product_price_meta;
DROP TABLE IF EXISTS product_cost_prices;
DROP TABLE IF EXISTS cost_price_book_state;
