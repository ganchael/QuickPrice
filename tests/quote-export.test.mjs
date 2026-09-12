import test from 'node:test';
import assert from 'node:assert/strict';
import { rateUnits, usdtAmount, quoteFilename } from '../lib/quote-export.ts';
import { quoteText, quoteCsv, productsSeed, parseQuote } from '../lib/pricing.ts';
import { parseLiveRate, parseDailyRate } from '../lib/live-rate.ts';
import { read, utils } from 'xlsx';

test('export filename uses local calendar date and time through minutes', () => {
  assert.equal(quoteFilename(new Date(2026, 8, 12, 0, 5)), '多肽报价清单_2026年09月12日_00时05分.csv');
});
test('manual CNY per USDT rate divides amounts and rounds half up accurately', () => {
  assert.equal(usdtAmount(200000, '7.2'), '277.78');
  assert.equal(usdtAmount(1, '2'), '0.01');
  assert.equal(usdtAmount(0, '7'), '0.00');
  assert.equal(usdtAmount(100, '0.000001'), '1,000,000.00');
  assert.equal(usdtAmount(123456, '1.23456'), '1,000.00');
  for (const rate of ['', '0', '-7', 'NaN', 'Infinity', '1e2', '7.1234567', '1000000', '1,000']) {
    assert.equal(rateUnits(rate), null);
    assert.equal(usdtAmount(10000, rate), null);
  }
  assert.equal(usdtAmount(Number.MAX_SAFE_INTEGER + 1, '7'), null);
});
test('copied quotes retain CNY and include converted rows, total and the current rate', () => {
  const lines = parseQuote('GND10 × 2', productsSeed);
  const output = quoteText(lines, productsSeed, '7.5');
  assert.match(output, /2 件 × ¥75.00 = ¥150.00/);
  assert.match(output, /折合：20.00 USDT/);
  assert.match(output, /折合合计：20.00 USDT/);
  assert.match(output, /1 USDT = ¥7.5/);
  assert.match(quoteText(lines, productsSeed, '6'), /折合合计：25.00 USDT/);
  assert.throws(() => quoteText(lines, productsSeed, '0'), /有效汇率/);
});
test('CSV includes numeric USDT unit prices, amounts, total, rate and provenance', () => {
  const lines = parseQuote('GND10 × 2\nTSM5 × 3', productsSeed);
  const csv = quoteCsv(lines, productsSeed, '7.5', 'CoinGecko · test time');
  const book = read(csv, { type: 'string' });
  const rows = utils.sheet_to_json(book.Sheets[book.SheetNames[0]], { header: 1 });
  assert.deepEqual(rows[0].slice(11), ['单价（USDT）', '金额（USDT）', '汇率（人民币/USDT）']);
  assert.deepEqual(rows[1].slice(11), [10, 20, 7.5]);
  assert.deepEqual(rows[2].slice(11), [32, 96, 7.5]);
  assert.equal(rows[3][12], 116);
  assert.equal(rows[4][1], 'CoinGecko · test time');
  assert.throws(() => quoteCsv(lines, productsSeed, '0'), /有效汇率/);
});
test('live rate validation rejects missing, stale, future and invalid quotes', () => {
  const now = 1800000000000;
  assert.equal(parseLiveRate({ tether: { cny: 7.123456, last_updated_at: now / 1000 } }, now).rate, '7.123456');
  for (const quote of [{}, { cny: 0, last_updated_at: now / 1000 }, { cny: 7, last_updated_at: now / 1000 - 901 }, { cny: 7, last_updated_at: now / 1000 + 61 }]) {
    assert.throws(() => parseLiveRate({ tether: quote }, now));
  }
});
test('daily fallback preserves the actual source date and rejects old data', () => {
  const now = Date.parse('2026-09-12T06:00:00Z');
  const result = parseDailyRate({ date: '2026-09-11', usdt: { cny: 7.0123456 } }, now);
  assert.equal(result.kind, 'daily');
  assert.equal(result.rate, '7.012346');
  assert.equal(result.updatedAt, '2026-09-11T00:00:00.000Z');
  assert.throws(() => parseDailyRate({ date: '2026-09-09', usdt: { cny: 7 } }, now));
});
