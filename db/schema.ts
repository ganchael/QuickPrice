import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const catalogs = sqliteTable('catalogs', {
  userId: text('user_id').primaryKey(),
  productsJson: text('products_json').notNull(),
  revision: integer('revision').notNull().default(1),
  updatedAt: text('updated_at').notNull(),
});
