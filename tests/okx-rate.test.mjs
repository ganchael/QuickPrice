import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOkxRate, parseKuCoinRate, OKX_RATE_PAGE, KUCOIN_RATE_URL } from '../lib/live-rate.ts';
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
test('reads KuCoin USDT prices in CNY with real source precision and retrieval timestamps', () => {
  for (const input of [6.98432189, '6.98432189']) {
    const result = parseKuCoinRate({ code: '200000', data: { USDT: input } }, now);
    assert.equal(result.rate, '6.984322');
    assert.notEqual(result.rate, '6.700000');
    assert.equal(result.sourceUrl, KUCOIN_RATE_URL);
    assert.equal(result.source, 'KuCoin 市场参考 · 获取于');
    assert.equal(result.kind, 'reference');
    assert.equal(result.fetchedAt, '2026-09-12T07:00:00.000Z');
    assert.equal(result.updatedAt, result.fetchedAt);
  }
  assert.equal(parseKuCoinRate({ code: '200000', data: { USDT: '7.03214561' } }, now).rate, '7.032146');
});
test('rejects KuCoin error codes, missing USDT and invalid numeric prices', () => {
  for (const input of [0, -1, null, true, NaN, Infinity, 1e6, '', ' 6.7 ', '6.7 USD', '6,71', '1e1', { rate: 6.7 }, { currency: 'USD', rate: 6.7 }, { message: 'forbidden' }]) {
    assert.throws(() => parseKuCoinRate({ code: '200000', data: { USDT: input } }, now));
  }
  for (const payload of [null, true, '6.7', 6.7, [], {}, { code: '429000', data: { USDT: '6.984321' } }, { code: 200000, data: { USDT: '6.984321' } }, { code: '200000', data: { USD: '6.984321' } }, { code: '200000', data: [] }]) {
    assert.throws(() => parseKuCoinRate(payload, now));
  }
});
