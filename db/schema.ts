import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const catalogs = sqliteTable('catalogs', {
  userId: text('user_id').primaryKey(),
  productsJson: text('products_json').notNull(),
  revision: integer('revision').notNull().default(1),
  updatedAt: text('updated_at').notNull(),
});

export const authSessions = sqliteTable('auth_sessions', {
  tokenHash: text('token_hash').primaryKey(),
  userId: text('user_id').notNull(),
  expiresAt: integer('expires_at').notNull(),
});
export const loginAttempts = sqliteTable('login_attempts', {
  attemptKey: text('attempt_key').primaryKey(),
  attempts: integer('attempts').notNull(),
  resetAt: integer('reset_at').notNull(),
});

// Shared public rate cache survives process restarts and is independent of catalogs.
export const exchangeRateCache = sqliteTable('exchange_rate_cache', {
  cacheKey: text('cache_key').primaryKey(),
  quoteJson: text('quote_json').notNull(),
  storedAt: text('stored_at').notNull(),
});

export const productCostPrices = sqliteTable('product_cost_prices', {
  catalogId: text('catalog_id').notNull(),
  productId: text('product_id').notNull(),
  costCents: integer('cost_cents'),
  specFingerprint: text('spec_fingerprint').notNull().default(''),
  status: text('status').notNull().default('missing'),
  updatedAt: text('updated_at').notNull(),
  updatedBy: text('updated_by').notNull(),
  batchId: text('batch_id'),
});

export const productPriceMeta = sqliteTable('product_price_meta', {
  catalogId: text('catalog_id').notNull(),
  productId: text('product_id').notNull(),
  salesUpdatedAt: text('sales_updated_at'),
  salesUpdatedBy: text('sales_updated_by'),
});

export const costPriceBookState = sqliteTable('cost_price_book_state', {
  bookId: text('book_id').primaryKey(),
  revision: integer('revision').notNull(),
  updatedAt: text('updated_at').notNull(),
  lastRequestId: text('last_request_id').notNull().default(''),
});

export const priceChangeBatches = sqliteTable('price_change_batches', {
  requestId: text('request_id').primaryKey(),
  batchId: text('batch_id').notNull(),
  actor: text('actor').notNull(),
  createdAt: text('created_at').notNull(),
  sourceType: text('source_type').notNull(),
  productIds: text('product_ids').notNull(),
  beforeJson: text('before_json').notNull(),
  afterJson: text('after_json').notNull(),
  result: text('result').notNull(),
});
