import test from 'node:test';
import assert from 'node:assert/strict';
import { createRateService } from '../lib/rate-service.ts';
import { COINGATE_RATE_URL, OKX_RATE_PAGE, parseCoinGateRate } from '../lib/live-rate.ts';

const start = Date.parse('2026-10-03T08:00:00.000Z');
const hour = 60 * 60 * 1000;
const okxHtml = (rate = 6.72) => `<script id="appState">${JSON.stringify({ appContext: { serverSideProps: {
  fetchParams: { fromCurrency: 'USDT', toCurrency: 'CNY' },
  detail: { currencyPairInfo: { crypto: { currency: 'USDT' }, fiat: { currency: 'CNY' }, pair: 'usdt-to-cny' }, convertInfo: { rate } },
} } })}</script>`;
const upstreamUnavailable = async () => { throw new Error('Network unavailable'); };

test('keeps OKX first and falls back server-side to CoinGate when OKX is unreachable', async () => {
  const calls = [];
  const writes = [];
  const service = createRateService({ now: () => start,
    fetcher: async (url, init) => {
      calls.push(url);
      assert.equal(init.cache, 'no-store');
      assert.ok(init.signal instanceof AbortSignal);
      if (url === OKX_RATE_PAGE) throw new Error('blocked');
      assert.equal(url, COINGATE_RATE_URL);
      return Response.json(6.71);
    },
    writeStored: async quote => { writes.push(quote); },
  });
  const quote = await service.get();
  assert.deepEqual(calls, [OKX_RATE_PAGE, COINGATE_RATE_URL]);
  assert.equal(quote.rate, '6.710000');
  assert.equal(quote.sourceUrl, COINGATE_RATE_URL);
  assert.match(quote.warning, /CoinGate 支付换算参考/);
  assert.deepEqual(writes, [quote]);
});

test('returns OKX directly when valid without touching the fallback', async () => {
  const calls = [];
  const service = createRateService({ now: () => start, fetcher: async url => {
    calls.push(url); return new Response(okxHtml());
  } });
  const quote = await service.get();
  assert.equal(quote.rate, '6.720000');
  assert.equal(quote.sourceUrl, OKX_RATE_PAGE);
  assert.equal(quote.warning, undefined);
  assert.deepEqual(calls, [OKX_RATE_PAGE]);
});

test('caches for one minute, allows forced refresh, and persists the replacement', async () => {
  let clock = start;
  let calls = 0;
  const service = createRateService({ now: () => clock,
    fetcher: async () => new Response(okxHtml(6.7 + ++calls / 100)),
  });
  assert.equal((await service.get()).rate, '6.710000');
  clock += 59_999;
  assert.equal((await service.get()).rate, '6.710000');
  assert.equal(calls, 1);
  assert.equal((await service.get({ force: true })).rate, '6.720000');
  clock += 60_000;
  assert.equal((await service.get()).rate, '6.730000');
  assert.equal(calls, 3);
});

test('loads a fresh durable quote as cache and force still requests upstream', async () => {
  let reads = 0;
  let calls = 0;
  const service = createRateService({ now: () => start,
    readStored: async () => { reads++; return parseCoinGateRate(6.71, start - 59_999); },
    fetcher: async () => { calls++; return new Response(okxHtml()); },
  });
  assert.equal((await service.get()).rate, '6.710000');
  assert.equal(calls, 0);
  assert.equal((await service.get({ force: true })).rate, '6.720000');
  assert.equal(calls, 1);
  assert.equal(reads, 1);
});

test('coalesces concurrent requests and resets singleflight after failure', async () => {
  let release;
  const waiting = new Promise(resolve => { release = resolve; });
  let calls = 0;
  const service = createRateService({ now: () => start, fetcher: async () => {
    calls++; await waiting; return new Response(okxHtml());
  } });
  const first = service.get();
  const second = service.get({ force: true });
  assert.equal(first, second);
  release();
  await Promise.all([first, second]);
  assert.equal(calls, 1);

  let failedCalls = 0;
  const failing = createRateService({ now: () => start, fetcher: async () => {
    failedCalls++; throw new Error('offline');
  } });
  await assert.rejects(failing.get(), /请手动输入或重试/);
  await assert.rejects(failing.get(), /请手动输入或重试/);
  assert.equal(failedCalls, 4);
});

test('a forced request joining initial storage loading bypasses a fresh durable cache', async () => {
  let release;
  const stored = new Promise(resolve => { release = resolve; });
  let calls = 0;
  const service = createRateService({ now: () => start,
    readStored: async () => stored,
    fetcher: async () => { calls++; return new Response(okxHtml()); },
  });
  const normal = service.get();
  const forced = service.get({ force: true });
  assert.equal(normal, forced);
  release(parseCoinGateRate(6.71, start - 1000));
  assert.equal((await forced).rate, '6.720000');
  assert.equal(calls, 1);
});

test('uses at most 24-hour durable quotes as explicitly stale, preserving source and timestamps', async () => {
  const stored = parseCoinGateRate(6.71, start - 24 * hour);
  const service = createRateService({ now: () => start, fetcher: upstreamUnavailable,
    readStored: async () => stored,
  });
  const quote = await service.get();
  assert.equal(quote.kind, 'stale');
  assert.equal(quote.rate, stored.rate);
  assert.equal(quote.sourceUrl, stored.sourceUrl);
  assert.equal(quote.fetchedAt, stored.fetchedAt);
  assert.equal(quote.updatedAt, stored.updatedAt);
  assert.match(quote.warning, /CoinGate/);
  assert.ok(quote.warning.includes(stored.fetchedAt));
});

test('rejects expired, future, malformed and untrusted stored references', async () => {
  const valid = parseCoinGateRate(6.71, start - hour);
  const invalid = [
    parseCoinGateRate(6.71, start - 24 * hour - 1),
    parseCoinGateRate(6.71, start + 1),
    { ...valid, updatedAt: new Date(start + 1).toISOString() },
    { ...valid, fetchedAt: 'invalid' },
    { ...valid, sourceUrl: 'https://example.invalid/rate' },
    { ...valid, sourceUrl: 'https://example.invalid/rate', source: undefined },
    { ...valid, source: '欧易 OKX · 获取于' },
    { ...valid, kind: 'stale' },
    { ...valid, rate: '0' },
    { ...valid, rate: '6.71 USD' },
  ];
  for (const stored of invalid) {
    const service = createRateService({ now: () => start, fetcher: upstreamUnavailable, readStored: async () => stored });
    await assert.rejects(service.get(), /请手动输入或重试/);
  }
});

test('memory last-good expires too, and failed storage does not prevent a successful refresh', async () => {
  let clock = start;
  let available = true;
  const service = createRateService({ now: () => clock,
    readStored: async () => { throw new Error('database read failed'); },
    writeStored: async () => { throw new Error('database write failed'); },
    fetcher: async () => {
      if (available) return new Response(okxHtml());
      throw new Error('offline');
    },
  });
  assert.equal((await service.get()).rate, '6.720000');
  available = false;
  clock += hour;
  assert.equal((await service.get()).kind, 'stale');
  clock += 24 * hour;
  await assert.rejects(service.get(), /请手动输入或重试/);
});

test('invalid currency, challenge pages and old upstream cache cannot poison the current quote', async () => {
  const wrongPair = okxHtml().replaceAll('CNY', 'USD');
  for (const response of [new Response(wrongPair), new Response('Access denied'),
    new Response(okxHtml(), { headers: { age: '901' } })]) {
    const service = createRateService({ now: () => start, fetcher: async url =>
      url === OKX_RATE_PAGE ? response : Response.json({ currency: 'USD', rate: 6.71 }),
    });
    await assert.rejects(service.get(), /请手动输入或重试/);
  }
});

test('a fetch ignoring abort is bounded and its late result cannot replace the fallback', async () => {
  let release;
  let signal;
  const late = new Promise(resolve => { release = resolve; });
  const service = createRateService({ now: () => start, fetcher: async (url, init) => {
    if (url === OKX_RATE_PAGE) { signal = init.signal; return late; }
    return Response.json(6.73);
  } });
  const quote = await service.get();
  assert.equal(signal.aborted, true);
  assert.equal(quote.rate, '6.730000');
  release(new Response(okxHtml(6.99)));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal((await service.get()).rate, '6.730000');
});
