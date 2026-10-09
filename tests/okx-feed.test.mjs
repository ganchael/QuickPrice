import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fetchOkxFeed, parseOkxFeed, writeOkxFeed, OKX_RATE_PAGE, OKX_UPSTREAM_URL } from '../scripts/fetch-okx-rate.mjs';

const now = Date.parse('2026-10-10T08:00:00.000Z');
const payload = (price = '6.6884758') => ({ code: 0, data: {
  baseCurrencyInfo: { currency: 'USDT', type: 'CRYPTO' },
  quoteCurrencyInfo: { currency: 'CNY', type: 'FIAT' },
  convertInfo: { currentPrice: price },
} });

test('publishes the correct pair, raw precision and truthful retrieval timestamp', () => {
  assert.deepEqual(parseOkxFeed(payload(), now), {
    schemaVersion: 1, baseCurrency: 'USDT', quoteCurrency: 'CNY', delivery: 'scheduled',
    rate: '6.688476', rawRate: '6.6884758', fetchedAt: '2026-10-10T08:00:00.000Z',
    updatedAt: '2026-10-10T08:00:00.000Z', source: '欧易 OKX · 获取于', kind: 'reference', sourceUrl: OKX_RATE_PAGE,
  });
  assert.equal(parseOkxFeed(payload(6.69377018), now).rawRate, '6.69377018');
  assert.equal(parseOkxFeed(payload('6.70000000'), now).rawRate, '6.70000000');
});

test('rejects USD CNY, wrong types, upstream errors and invalid rates', () => {
  const wrongBase = payload(); wrongBase.data.baseCurrencyInfo.currency = 'USD';
  const wrongQuote = payload(); wrongQuote.data.quoteCurrencyInfo.currency = 'USD';
  const wrongType = payload(); wrongType.data.baseCurrencyInfo.type = 'FIAT';
  for (const value of [null, {}, { ...payload(), code: '0' }, { ...payload(), code: 403 }, wrongBase, wrongQuote, wrongType]) {
    assert.throws(() => parseOkxFeed(value, now));
  }
  for (const price of [0, -1, null, true, '', ' 6.7 ', '1e2', '6,7', '6.7 USDT', Infinity, 1_000_000, '0.0000001']) {
    assert.throws(() => parseOkxFeed(payload(price), now));
  }
  assert.throws(() => parseOkxFeed(payload(), NaN));
});

test('rejects aged cache and future or old upstream Date headers', () => {
  for (const age of ['301', '-1', '', 'NaN', '2.5']) {
    assert.throws(() => parseOkxFeed(payload(), now, new Headers({ Age: age })));
  }
  for (const date of [new Date(now - 331_000).toUTCString(), new Date(now + 31_000).toUTCString(), 'invalid']) {
    assert.throws(() => parseOkxFeed(payload(), now, new Headers({ Date: date })));
  }
  assert.equal(parseOkxFeed(payload(), now, new Headers({ Age: '300', Date: new Date(now - 300_000).toUTCString() })).rate, '6.688476');
});

test('fetches only the fixed official endpoint and bounds retries without forwarding credentials', async () => {
  let calls = 0;
  const waits = [];
  const quote = await fetchOkxFeed({ now: () => now, wait: async ms => { waits.push(ms); }, fetcher: async (url, init) => {
    assert.equal(url, OKX_UPSTREAM_URL);
    assert.equal(init.redirect, 'error');
    assert.equal(init.cache, 'no-store');
    assert.equal(new Headers(init.headers).get('Authorization'), null);
    if (++calls < 3) return new Response('temporarily unavailable', { status: 503 });
    return Response.json(payload());
  } });
  assert.equal(quote.rate, '6.688476');
  assert.equal(calls, 3);
  assert.deepEqual(waits, [1000, 2000]);
});

test('failed fetch or challenge page never overwrites the successful file', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'quickprice-okx-feed-'));
  const destination = join(directory, 'okx-usdt-cny.json');
  const previous = JSON.stringify(parseOkxFeed(payload(), now - 300_000));
  await writeFile(destination, previous);
  try {
    for (const fetcher of [
      async () => new Response('Access denied', { status: 403 }),
      async () => new Response('<html>Verify you are human</html>'),
      async () => Response.json(payload(), { headers: { Age: '900' } }),
    ]) {
      await assert.rejects(() => writeOkxFeed(destination, { fetcher, now: () => now, attempts: 1 }));
      assert.equal(await readFile(destination, 'utf8'), previous);
    }
    await writeOkxFeed(destination, { fetcher: async () => Response.json(payload('6.69004219')), now: () => now });
    const quote = JSON.parse(await readFile(destination, 'utf8'));
    assert.equal(quote.rawRate, '6.69004219');
    assert.equal(quote.fetchedAt, new Date(now).toISOString());
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('deadline covers fetch and body reading even when abort is ignored', async () => {
  for (const hangingBody of [false, true]) {
    let signal;
    const fetcher = async (_url, init) => {
      signal = init.signal;
      if (!hangingBody) return new Promise(() => {});
      return { ok: true, headers: new Headers(), text: async () => new Promise(() => {}) };
    };
    await assert.rejects(() => fetchOkxFeed({ fetcher, attempts: 1, deadlineMs: 10 }), /超时/);
    assert.equal(signal.aborted, true);
  }
});

test('rejects oversized or malformed payloads and unsafe retry settings', async () => {
  for (const fetcher of [
    async () => new Response('body', { headers: { 'Content-Length': '131073' } }),
    async () => new Response('x'.repeat(131073)),
    async () => new Response('malformed JSON'),
  ]) {
    await assert.rejects(() => fetchOkxFeed({ fetcher, attempts: 1 }));
  }
  await assert.rejects(() => fetchOkxFeed({ deadlineMs: 8001 }));
  await assert.rejects(() => fetchOkxFeed({ attempts: 4 }));
});
