import { getAccountUser } from '@/app/account-auth';
import { getCatalogDatabase } from '@/db';
import { createRateService } from '@/lib/rate-service';
import type { RateQuote } from '@/lib/live-rate';

export const dynamic = 'force-dynamic';
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie' } });
let cacheTable: Promise<unknown> | undefined;
// Keep the former payment conversion cache separate from market references.
const CACHE_KEY = 'USDT-CNY:market-v2';

async function cacheDatabase() {
  const db = getCatalogDatabase();
  if (!cacheTable) {
    cacheTable = db.prepare('CREATE TABLE IF NOT EXISTS exchange_rate_cache (cache_key TEXT PRIMARY KEY, quote_json TEXT NOT NULL, stored_at TEXT NOT NULL)').run().catch(error => { cacheTable = undefined; throw error; });
  }
  await cacheTable;
  return db;
}

const rates = createRateService({
  readStored: async () => {
    const db = await cacheDatabase();
    const row = await db.prepare('SELECT quote_json FROM exchange_rate_cache WHERE cache_key = ?').bind(CACHE_KEY).first<{ quote_json: string }>();
    return row ? JSON.parse(row.quote_json) : undefined;
  },
  writeStored: async (quote: RateQuote) => {
    const db = await cacheDatabase();
    await db.prepare('INSERT INTO exchange_rate_cache (cache_key, quote_json, stored_at) VALUES (?, ?, ?) ON CONFLICT(cache_key) DO UPDATE SET quote_json = excluded.quote_json, stored_at = excluded.stored_at').bind(CACHE_KEY, JSON.stringify(quote), new Date().toISOString()).run();
  },
});

export async function GET(request: Request) {
  if (!await getAccountUser()) return json({ error: '请先登录。' }, 401);
  try {
    return json(await rates.get({ force: new URL(request.url).searchParams.get('refresh') === '1' }));
  } catch (error) {
    console.warn('USDT exchange rate unavailable:', error instanceof Error ? error.message : 'unknown error');
    return json({ error: '最新汇率获取失败，请手动输入或稍后重试。' }, 503);
  }
}
