import test from 'node:test';
import assert from 'node:assert/strict';
import { rateUnits, usdtAmount, quoteFilename } from '../lib/quote-export.ts';
import { quoteText, productsSeed, parseQuote } from '../lib/pricing.ts';

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
