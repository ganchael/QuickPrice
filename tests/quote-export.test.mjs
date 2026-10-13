import test from 'node:test';
import assert from 'node:assert/strict';
import { rateUnits, usdtAmount, quoteFilename } from '../lib/quote-export.ts';
import { quoteText, quoteCsv, productsSeed, parseQuote } from '../lib/pricing.ts';
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
test('USDT line amount is rounded unit times quantity, and the total is the sum of lines', () => {
  const product = { id: 'pep', shortName: '甲', name: '测试肽甲', specification: '5mg', unit: '件', category: '肽', price: '75.50', aliases: [] };
  const lines = [{ id: '1', source: '甲 × 2', parsed: '甲', productId: 'pep', quantity: '2', price: '75.50', match: 'manual' }];
  const text = quoteText(lines, [product], '7.2');
  assert.match(text, /折合：20.98 USDT/);
  assert.match(text, /折合合计：20.98 USDT/);
  assert.match(text, /单价乘数量/);
  const book = read(quoteCsv(lines, [product], '7.2'), { type: 'string' });
  const rows = utils.sheet_to_json(book.Sheets[book.SheetNames[0]], { header: 1 });
  assert.equal(rows[1][11], 10.49);
  assert.equal(rows[1][12], 20.98);
  assert.equal(rows[2][12], 20.98);
  const tiny = { ...product, id: 'edge', price: '0.01' };
  const edges = [1, 2, 3].map(i => ({ id: String(i), source: 'edge', parsed: 'edge', productId: 'edge', quantity: '1', price: '0.01', match: 'manual' }));
  assert.match(quoteText(edges, [tiny], '2'), /折合合计：0.03 USDT/);
  const edgeBook = read(quoteCsv(edges, [tiny], '2'), { type: 'string' });
  const edgeRows = utils.sheet_to_json(edgeBook.Sheets[edgeBook.SheetNames[0]], { header: 1 });
  assert.equal(edgeRows[4][12], 0.03);
});
test('CSV unit prices are trimmed numbers with exactly two decimal places', () => {
  const product = { id: 'pep', shortName: '甲', name: '测试肽甲', specification: '', unit: '件', category: '肽', price: '75.50', aliases: [] };
  const lines = [
    { id: '1', source: '甲', parsed: '甲', productId: 'pep', quantity: '1', price: ' 75.50', match: 'manual' },
    { id: '2', source: '乙', parsed: '乙', productId: 'pep', quantity: '1', price: '10.5', match: 'manual' },
  ];
  const csv = quoteCsv(lines, [product], '7.2');
  assert.match(csv, /"75.50"/);
  assert.match(csv, /"10.50"/);
  assert.equal(csv.includes('" 75.50"'), false);
  assert.equal(csv.includes(',10.5,'), false);
});
test('copied and exported quotes retain scheduled OKX retrieval time without changing conversions', () => {
  const lines = parseQuote('GND10 × 2', productsSeed);
  const source = '欧易 OKX · 获取于 · 2026/10/10 10:05:00 · 缓存汇率 · 约每 5 分钟更新，可能延迟';
  const copied = quoteText(lines, productsSeed, '6.75', source);
  assert.match(copied, /折合合计：22.22 USDT/);
  assert.ok(copied.includes(source));
  const book = read(quoteCsv(lines, productsSeed, '6.75', source), { type: 'string' });
  const rows = utils.sheet_to_json(book.Sheets[book.SheetNames[0]], { header: 1 });
  assert.equal(rows[1][12], 22.22);
  assert.equal(rows[3][1], source);
});
