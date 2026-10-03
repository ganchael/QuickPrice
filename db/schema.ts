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
