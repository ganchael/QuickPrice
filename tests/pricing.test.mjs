import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseQuote, productsSeed, sampleText, summarize, moneyCents, quantityValue, lineTotal, quoteCsv, quoteText } from '../lib/pricing.ts';

test('reference-style sample totals six rows, 110 units and ¥11,300', () => {
  const s = summarize(parseQuote(sampleText, productsSeed));
  assert.deepEqual(s, { cents: 1130000, count: 6, matched: 6, exact: 6, quantity: 110, pending: 0, safe: true });
});
test('unknown screenshot models remain unpriced; exact matches and aliases work', () => {
  const ls = parseQuote('Rt5×20\nMs5x30\nTsm5*20\nMl10 5个\nNj100×15', productsSeed);
  assert.equal(summarize(ls).cents, 615000);
  assert.equal(summarize(ls).pending, 2);
  assert.equal(ls[0].quantity, '20');
  assert.equal(ls[3].productId, 'ml10');
});
test('normalizes fullwidth, case, spaces and quantity units', () => {
  const ls = parseQuote(' ｔｓｍ５ ＊ ２０ ；nj100 × 15件;MT2 5套', productsSeed);
  assert.equal(summarize(ls).cents, 615000);
  assert.equal(summarize(ls).pending, 0);
});
test('model digits never become quantities', () => {
  for (const text of ['GND10', 'TSM5', 'NJ100']) {
    const [line] = parseQuote(text, productsSeed);
    assert.equal(line.quantity, ''); assert.equal(lineTotal(line), null);
  }
});
test('no guessed, prefix or ambiguous model matches', () => {
  for (const text of ['TSM50×2', 'NJ1000×15', 'ML1O×5', 'ML10 MT2×5', 'TSM5×20×2', 'TSM5×20 备注30']) {
    const [line] = parseQuote(text, productsSeed); assert.equal(lineTotal(line), null, text);
  }
});
test('rejects invalid, fractional, empty and excessive quantities', () => {
  for (const q of ['', '0', '-2', '1.5', '1e3', '1000000', 'Infinity', 'NaN']) {
    assert.equal(quantityValue(q), null, q);
    assert.equal(lineTotal(parseQuote(`TSM5×${q}`, productsSeed)[0]), null);
  }
  assert.equal(quantityValue('999999'), 999999);
});
test('cent arithmetic is exact, including free products', () => {
  const ls = parseQuote('TSM5×3;NJ100×1', productsSeed);
  ls[0].price = '0.10'; ls[1].price = '0.20';
  assert.equal(summarize(ls).cents, 50);
  assert.equal(moneyCents('0'), 0);
  for (const s of ['1.005', '-1', '', '1e3', '0.', '1000000']) assert.equal(moneyCents(s), null);
});
test('duplicate rows remain independent and manually edited values are reflected', () => {
  const ls = parseQuote('NJ100×15;NJ100×15', productsSeed);
  assert.notEqual(ls[0].id, ls[1].id); assert.equal(summarize(ls).cents, 180000);
  ls[0].quantity = '20'; ls[0].price = '75.00'; assert.equal(summarize(ls).cents, 240000);
  ls[0].productId = ''; assert.equal(summarize(ls).cents, 90000);
});
test('caps line count and detects unsafe aggregate', () => {
  assert.throws(() => parseQuote(Array(201).fill('TSM5×1').join('\n'), productsSeed));
  const ls = parseQuote(Array(200).fill('TSM5×999999').join('\n'), productsSeed);
  ls.forEach(l => { l.price = '999999.99'; }); assert.equal(summarize(ls).safe, false);
});
test('CSV and text match totals, escape quotes and prevent spreadsheet formulas', () => {
  const ls = parseQuote('NJ100×15', productsSeed); ls[0].source = '=HYPERLINK("example")';
  const csv = quoteCsv(ls, productsSeed);
  assert.ok(csv.startsWith('\uFEFF')); assert.ok(csv.includes("'=HYPERLINK")); assert.ok(csv.includes('""example""')); assert.ok(csv.includes('900.00'));
  assert.ok(quoteText(ls, productsSeed).includes('合计：¥900.00'));
});
