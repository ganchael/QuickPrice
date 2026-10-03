import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOkxRate, parseCoinGateRate, OKX_RATE_PAGE, COINGATE_RATE_URL } from '../lib/live-rate.ts';
const now = Date.parse('2026-09-12T07:00:00Z');
const fixture = (rate = 6.70652426, from = 'USDT', to = 'CNY') => `<script type="application/json" id="appState">${JSON.stringify({ appContext: { serverSideProps: { fetchParams: { fromCurrency: from, toCurrency: to }, detail: { currencyPairInfo: { crypto: { currency: from }, fiat: { currency: to }, pair: 'usdt-to-cny' }, convertInfo: { rate, price: '6.7065' } } } } })}</script>`;
test('reads full precision OKX rate and labels retrieval time', () => {
  const result = parseOkxRate(fixture(), now);
  assert.equal(result.rate, '6.706524');
  assert.equal(result.sourceUrl, OKX_RATE_PAGE);
  assert.match(result.source, /获取于/);
  assert.equal(result.fetchedAt, '2026-09-12T07:00:00.000Z');
});
test('rejects wrong pairs, invalid rates, missing data and challenge pages', () => {
  for (const html of [fixture(0), fixture(-1), fixture(null), fixture('6.7'), fixture(1e9), fixture(6.7, 'BTC'), fixture(6.7, 'USDT', 'USD'), '<html>Access denied</html>', '<script id="appState">{}</script>']) assert.throws(() => parseOkxRate(html, now));
});
test('reads CoinGate numeric and numeric-string USDT/CNY references with honest source labels', () => {
  for (const input of [6.71, '6.71']) {
    const result = parseCoinGateRate(input, now);
    assert.equal(result.rate, '6.710000');
    assert.equal(result.sourceUrl, COINGATE_RATE_URL);
    assert.equal(result.source, 'CoinGate 支付换算参考 · 获取于');
    assert.equal(result.kind, 'reference');
    assert.equal(result.fetchedAt, '2026-09-12T07:00:00.000Z');
  }
  assert.equal(parseCoinGateRate('6.70652489', now).rate, '6.706525');
});
test('rejects CoinGate errors, objects, unexpected currencies and nonnumeric responses', () => {
  for (const input of [0, -1, null, true, NaN, Infinity, 1e6, '', ' 6.7 ', '6.7 USD', '6,71', '1e1', { rate: 6.7 }, { currency: 'USD', rate: 6.7 }, { message: 'forbidden' }]) {
    assert.throws(() => parseCoinGateRate(input, now));
  }
});
