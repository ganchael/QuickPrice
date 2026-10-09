import test from 'node:test';
import assert from 'node:assert/strict';
import { createRateService, parseScheduledOkxFeed } from '../lib/rate-service.ts';
import { OKX_FEED_URL, OKX_FEED_API_URL, OKX_RATE_PAGE, KUCOIN_RATE_URL } from '../lib/live-rate.ts';

const start = Date.parse('2026-10-10T08:00:00.000Z');
const minute = 60_000;
const feed = (time = start - 5 * minute, rawRate = '6.68827497') => ({
  schemaVersion: 1, baseCurrency: 'USDT', quoteCurrency: 'CNY', delivery: 'scheduled', rawRate,
  rate: Number(rawRate).toFixed(6), source: '欧易 OKX · 获取于', sourceUrl: OKX_RATE_PAGE,
  fetchedAt: new Date(time).toISOString(), updatedAt: new Date(time).toISOString(), kind: 'reference',
});

test('reads the GitHub feed with its original OKX source and acquisition time', async () => {
  const calls = [];
  const writes = [];
  const value = feed();
  const service = createRateService({ scheduled: true, now: () => start,
    fetcher: async (url, init) => {
      calls.push(url);
      assert.equal(url, `${OKX_FEED_URL}?t=${start}`);
      assert.equal(init.redirect, 'manual');
      assert.equal(init.cache, 'no-store');
      return Response.json(value);
    }, writeStored: async quote => { writes.push(quote); },
  });
  const quote = await service.get({ force: true });
  assert.equal(quote.rate, '6.688275');
  assert.equal(quote.delivery, 'scheduled');
  assert.equal(quote.fetchedAt, value.fetchedAt);
  assert.equal(quote.updatedAt, value.updatedAt);
  assert.equal(quote.sourceUrl, OKX_RATE_PAGE);
  assert.equal(quote.kind, 'reference');
  assert.deepEqual(writes, [quote]);
  assert.equal(calls.length, 1);
});

test('marks a delayed feed stale and refuses a feed older than 24 hours', async () => {
  const value = feed(start - 16 * minute);
  const service = createRateService({ scheduled: true, now: () => start,
    fetcher: async () => Response.json(value),
  });
  const quote = await service.get();
  assert.equal(quote.kind, 'stale');
  assert.equal(quote.fetchedAt, value.fetchedAt);
  assert.match(quote.warning, /超过 15 分钟/);
  assert.throws(() => parseScheduledOkxFeed(feed(start - 24 * 60 * minute - 1), start));
});

test('retains the prior OKX feed on failure or regression without switching its source or updating its time', async () => {
  for (const fetcher of [async () => { throw new Error('offline'); }, async () => Response.json(feed(start - 10 * minute))]) {
    let writes = 0;
    const original = feed();
    const service = createRateService({ scheduled: true, now: () => start,
      readStored: async () => original, fetcher, writeStored: async () => { writes++; },
    });
    const quote = await service.get({ force: true });
    assert.equal(quote.kind, 'stale');
    assert.equal(quote.rate, original.rate);
    assert.equal(quote.fetchedAt, original.fetchedAt);
    assert.equal(quote.sourceUrl, OKX_RATE_PAGE);
    assert.equal(writes, 0);
  }
});

test('uses explicitly labeled KuCoin only when no valid previous OKX feed exists', async () => {
  const calls = [];
  const service = createRateService({ scheduled: true, now: () => start,
    fetcher: async url => {
      calls.push(url);
      if (String(url).startsWith(OKX_FEED_URL) || String(url).startsWith(OKX_FEED_API_URL)) return new Response('Not Found', { status: 404 });
      assert.equal(url, KUCOIN_RATE_URL);
      return Response.json({ code: '200000', data: { USDT: '6.69654321' } });
    },
  });
  const quote = await service.get();
  assert.equal(quote.sourceUrl, KUCOIN_RATE_URL);
  assert.equal(quote.delivery, undefined);
  assert.match(quote.warning, /欧易定时报价暂时不可用.*KuCoin/);
  assert.equal(calls.length, 3);
});

test('reads the same OKX publication through GitHub API when the raw domain fails', async () => {
  const original = feed();
  const calls = [];
  const service = createRateService({ scheduled: true, now: () => start,
    fetcher: async (url, init) => {
      calls.push(url);
      if (String(url).startsWith(OKX_FEED_URL)) throw new Error('TLS failure');
      assert.equal(url, `${OKX_FEED_API_URL}&t=${start}`);
      assert.equal(init.headers.Accept, 'application/vnd.github.raw+json');
      return Response.json(original);
    },
  });
  const quote = await service.get();
  assert.equal(quote.rate, original.rate);
  assert.equal(quote.fetchedAt, original.fetchedAt);
  assert.equal(quote.delivery, 'scheduled');
  assert.equal(calls.length, 2);
});

test('rejects mismatched pairs, precision, provenance and future acquisition time', () => {
  for (const invalid of [
    { ...feed(), quoteCurrency: 'USD' }, { ...feed(), baseCurrency: 'BTC' },
    { ...feed(), rate: '6.700000' }, { ...feed(), rawRate: '6.68 USD' },
    { ...feed(), schemaVersion: 2 }, { ...feed(), sourceUrl: KUCOIN_RATE_URL },
    { ...feed(), delivery: undefined }, { ...feed(), kind: 'stale' },
    feed(start + 1), { ...feed(), updatedAt: new Date(start).toISOString() },
  ]) assert.throws(() => parseScheduledOkxFeed(invalid, start));
});

test('force refresh reads a new publication while retaining actual scheduled timestamps', async () => {
  let value = feed(start - 5 * minute);
  let calls = 0;
  const service = createRateService({ scheduled: true, now: () => start,
    fetcher: async () => { calls++; return Response.json(value); },
  });
  await service.get();
  await service.get();
  assert.equal(calls, 1);
  value = feed(start - 10_000, '6.68976543');
  const latest = await service.get({ force: true });
  assert.equal(latest.rate, '6.689765');
  assert.equal(latest.fetchedAt, value.fetchedAt);
  assert.equal(calls, 2);
});
