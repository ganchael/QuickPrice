import { env } from 'cloudflare:workers';
export function getCatalogDatabase(): D1Database {
  if (!env.DB) throw new Error('商品库暂时不可用，请稍后重试。');
  return env.DB;
}
