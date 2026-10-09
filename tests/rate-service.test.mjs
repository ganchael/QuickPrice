import test from 'node:test';
import assert from 'node:assert/strict';
import { createRateService } from '../lib/rate-service.ts';
import { KUCOIN_RATE_URL, OKX_RATE_PAGE, parseKuCoinRate } from '../lib/live-rate.ts';

const start = Date.parse('2026-10-10T08:00:00.000Z');
const hour = 60 * 60 * 1000;
const okxHtml = (rate = 6.97652426) => `<script id="appState">${JSON.stringify({ appContext: { serverSideProps: {
  fetchParams: { fromCurrency: 'USDT', toCurrency: 'CNY' },
  detail: { currencyPairInfo: { crypto: { currency: 'USDT' }, fiat: { currency: 'CNY' }, pair: 'usdt-to-cny' }, convertInfo: { rate } },
} } })}</script>`;
const kucoinPayload = (rate = '6.98432189') => ({ code: '200000', data: { USDT: rate } });
const kucoinResponse = (rate = '6.98432189') => Response.json(kucoinPayload(rate));
const kucoinQuote = (time = start) => parseKuCoinRate(kucoinPayload(), time);
const upstreamUnavailable = async () => { throw new Error('Network unavailable'); };

test('requests KuCoin first, preserves price precision and writes its actual source', async () => {
  const calls = [];
  const writes = [];
  const service = createRateService({ now: () => start,
    fetcher: async (url, init) => {
      calls.push(url);
      assert.equal(init.cache, 'no-store');
      assert.ok(init.signal instanceof AbortSignal);
      assert.equal(url, KUCOIN_RATE_URL);
      return kucoinResponse();
    },
    writeStored: async quote => { writes.push(quote); },
  });
  const quote = await service.get();
  assert.deepEqual(calls, [KUCOIN_RATE_URL]);
  assert.equal(quote.rate, '6.984322');
  assert.notEqual(quote.rate, '6.700000');
  assert.equal(quote.sourceUrl, KUCOIN_RATE_URL);
  assert.equal(quote.warning, undefined);
  assert.deepEqual(writes, [quote]);
});

test('falls back server-side to OKX when KuCoin is unreachable', async () => {
  const calls = [];
  const service = createRateService({ now: () => start, fetcher: async url => {
    calls.push(url);
    if (url === KUCOIN_RATE_URL) throw new Error('blocked');
    assert.equal(url, OKX_RATE_PAGE);
    return new Response(okxHtml());
  } });
  const quote = await service.get();
  assert.equal(quote.rate, '6.976524');
  assert.equal(quote.sourceUrl, OKX_RATE_PAGE);
  assert.match(quote.warning, /欧易 OKX USDT\/CNY 市场参考/);
  assert.deepEqual(calls, [KUCOIN_RATE_URL, OKX_RATE_PAGE]);
});

test('caches for one minute, allows forced refresh, and does not reuse a fixed peg', async () => {
  let clock = start;
  let calls = 0;
  const service = createRateService({ now: () => clock,
    fetcher: async () => kucoinResponse(6.981234 + ++calls / 100),
  });
  assert.equal((await service.get()).rate, '6.991234');
  clock += 59_999;
  assert.equal((await service.get()).rate, '6.991234');
  assert.equal(calls, 1);
  assert.equal((await service.get({ force: true })).rate, '7.001234');
  clock += 60_000;
  assert.equal((await service.get()).rate, '7.011234');
  assert.equal(calls, 3);
});

test('loads a fresh accepted durable quote as cache and force still requests upstream', async () => {
  let reads = 0;
  let calls = 0;
  const service = createRateService({ now: () => start,
    readStored: async () => { reads++; return kucoinQuote(start - 59_999); },
    fetcher: async () => { calls++; return kucoinResponse('6.972314'); },
  });
  assert.equal((await service.get()).rate, '6.984322');
  assert.equal(calls, 0);
  assert.equal((await service.get({ force: true })).rate, '6.972314');
  assert.equal(calls, 1);
  assert.equal(reads, 1);
});

test('never revives a recently fetched CoinGate durable quote as cache or failure fallback', async () => {
  const old = { ...kucoinQuote(start - 1000), rate: '6.700000',
    source: 'CoinGate 支付换算参考 · 获取于', sourceUrl: 'https://api.coingate.com/v2/rates/merchant/USDT/CNY' };
  let calls = 0;
  const succeeds = createRateService({ now: () => start, readStored: async () => old,
    fetcher: async () => { calls++; return kucoinResponse(); },
  });
  assert.equal((await succeeds.get()).rate, '6.984322');
  assert.equal(calls, 1);
  const fails = createRateService({ now: () => start, readStored: async () => old, fetcher: upstreamUnavailable });
  await assert.rejects(fails.get(), /请手动输入或重试/);
});

test('coalesces concurrent requests and resets singleflight after failure', async () => {
  let release;
  const waiting = new Promise(resolve => { release = resolve; });
  let calls = 0;
  const service = createRateService({ now: () => start, fetcher: async () => {
    calls++; await waiting; return kucoinResponse();
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
    fetcher: async () => { calls++; return kucoinResponse('6.923145'); },
  });
  const normal = service.get();
  const forced = service.get({ force: true });
  assert.equal(normal, forced);
  release(kucoinQuote(start - 1000));
  assert.equal((await forced).rate, '6.923145');
  assert.equal(calls, 1);
});

test('uses at most 24-hour durable quotes as explicitly stale, preserving source and timestamps', async () => {
  const stored = kucoinQuote(start - 24 * hour);
  const service = createRateService({ now: () => start, fetcher: upstreamUnavailable, readStored: async () => stored });
  const quote = await service.get();
  assert.equal(quote.kind, 'stale');
  assert.equal(quote.rate, stored.rate);
  assert.equal(quote.sourceUrl, stored.sourceUrl);
  assert.equal(quote.fetchedAt, stored.fetchedAt);
  assert.equal(quote.updatedAt, stored.updatedAt);
  assert.match(quote.warning, /KuCoin/);
  assert.ok(quote.warning.includes(stored.fetchedAt));
});

test('429 responses preserve a successful quote without relabelling its retrieval time as current', async () => {
  let clock = start;
  let available = true;
  const writes = [];
  const service = createRateService({ now: () => clock,
    fetcher: async () => available ? kucoinResponse() : new Response('Rate limited', { status: 429 }),
    writeStored: async quote => { writes.push(quote); },
  });
  const original = await service.get();
  available = false;
  clock += 90_000;
  const quote = await service.get({ force: true });
  assert.equal(quote.kind, 'stale');
  assert.equal(quote.rate, original.rate);
  assert.equal(quote.fetchedAt, original.fetchedAt);
  assert.equal(quote.updatedAt, original.updatedAt);
  assert.equal(writes.length, 1);
});

test('rejects expired, future, malformed and untrusted stored references', async () => {
  const valid = kucoinQuote(start - hour);
  const invalid = [
    kucoinQuote(start - 24 * hour - 1), kucoinQuote(start + 1),
    { ...valid, updatedAt: new Date(start + 1).toISOString() },
    { ...valid, fetchedAt: 'invalid' },
    { ...valid, sourceUrl: 'https://example.invalid/rate' },
    { ...valid, sourceUrl: 'https://example.invalid/rate', source: undefined },
    { ...valid, source: '欧易 OKX · 获取于' },
    { ...valid, kind: 'stale' }, { ...valid, rate: '0' }, { ...valid, rate: '6.71 USD' },
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
      if (available) return kucoinResponse();
      throw new Error('offline');
    },
  });
  assert.equal((await service.get()).rate, '6.984322');
  available = false;
  clock += hour;
  assert.equal((await service.get()).kind, 'stale');
  clock += 24 * hour;
  await assert.rejects(service.get(), /请手动输入或重试/);
});

test('invalid currency, challenge pages and old upstream cache cannot poison the current quote', async () => {
  const wrongPair = okxHtml().replaceAll('CNY', 'USD');
  for (const response of [Response.json({ code: '200000', data: { USD: '6.98' } }),
    new Response('Access denied'), Response.json(kucoinPayload(), { headers: { age: '901' } })]) {
    const service = createRateService({ now: () => start, fetcher: async url =>
      url === KUCOIN_RATE_URL ? response : new Response(wrongPair),
    });
    await assert.rejects(service.get(), /请手动输入或重试/);
  }
});

test('a primary fetch ignoring abort is bounded and its late result cannot replace the OKX fallback', async () => {
  let release;
  let signal;
  const late = new Promise(resolve => { release = resolve; });
  const service = createRateService({ now: () => start, fetcher: async (url, init) => {
    if (url === KUCOIN_RATE_URL) { signal = init.signal; return late; }
    return new Response(okxHtml());
  } });
  const quote = await service.get();
  assert.equal(signal.aborted, true);
  assert.equal(quote.rate, '6.976524');
  release(kucoinResponse('7.093145'));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal((await service.get()).rate, '6.976524');
});
