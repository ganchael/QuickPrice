import { rateUnits } from './quote-export.ts';

export function parseLiveRate(data: unknown, now = Date.now()) {
  const quote = (data as { tether?: { cny?: unknown; last_updated_at?: unknown } })?.tether;
  if (typeof quote?.cny !== 'number' || !Number.isFinite(quote.cny) || typeof quote.last_updated_at !== 'number') throw new Error('行情格式无效');
  const timestamp = quote.last_updated_at * 1000;
  if (!Number.isFinite(timestamp) || now - timestamp > 15 * 60 * 1000 || timestamp > now + 60000) throw new Error('行情已过期');
  const rate = quote.cny.toFixed(6);
  if (rateUnits(rate) === null) throw new Error('汇率无效');
  return { rate, updatedAt: new Date(timestamp).toISOString(), source: 'CoinGecko', kind: 'market', sourceUrl: 'https://www.coingecko.com/en/coins/tether' };
}

export function parseDailyRate(data: unknown, now = Date.now()) {
  const quote = data as { date?: string; usdt?: { cny?: number } };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(quote?.date ?? '') || typeof quote?.usdt?.cny !== 'number' || !Number.isFinite(quote.usdt.cny)) throw new Error('每日参考汇率无效');
  const timestamp = Date.parse(quote.date!);
  if (!Number.isFinite(timestamp) || now - timestamp > 48 * 3600000 || timestamp > now + 3600000) throw new Error('每日参考汇率已过期');
  const rate = quote.usdt.cny.toFixed(6);
  if (rateUnits(rate) === null) throw new Error('每日参考汇率无效');
  return { rate, updatedAt: new Date(timestamp).toISOString(), source: 'Currency API', kind: 'daily', sourceUrl: 'https://github.com/fawazahmed0/exchange-api' };
}
