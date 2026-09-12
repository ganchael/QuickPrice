import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBinanceRate } from '../lib/live-rate.ts';
const now = Date.parse('2026-09-12T06:35:00Z');
const fx = { code: '000000', success: true, data: [{ pair: 'CNY_USD', rate: 6.71 }] };
const history = (price = 0.9998397124502325, timestamp = '2026-09-12T06:30:00Z', symbol = 'USDT') => ({ code: '000000', success: true, data: { body: { status: { error_code: 0 }, data: { id: 825, symbol, quotes: [{ timestamp, quote: { USD: { price } } }] } } } });
test('Binance combines actual USDT price and CNY FX without assuming a USD peg', () => {
  const value = parseBinanceRate(fx, history(), now);
  assert.equal(value.rate, '6.708924');
  assert.equal(value.updatedAt, '2026-09-12T06:30:00.000Z');
  assert.equal(value.sourceUrl, 'https://www.binance.com/zh-CN/price/tether/CNY');
});
test('selects newest point even when history order differs', () => {
  const h = history();
  h.data.body.data.quotes.unshift({ timestamp: '2026-09-12T06:35:00Z', quote: { USD: { price: 1 } } });
  assert.equal(parseBinanceRate(fx, h, now).rate, '6.710000');
});
test('rejects wrong assets, stale or future quotes, invalid prices and missing FX', () => {
  for (const h of [history(0), history(NaN), history(1, '2026-09-12T06:00:00Z'), history(1, '2026-09-12T07:00:00Z'), history(1, '2026-09-12T06:30:00Z', 'BTC'), {}]) assert.throws(() => parseBinanceRate(fx, h, now));
  assert.throws(() => parseBinanceRate({ ...fx, data: [{ pair: 'USD_CNY', rate: .15 }] }, history(), now));
});
