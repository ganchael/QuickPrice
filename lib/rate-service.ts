import { COINGATE_RATE_URL, OKX_RATE_PAGE, parseCoinGateRate, parseOkxRate, type RateQuote } from './live-rate.ts';
import { rateUnits } from './quote-export.ts';

const CACHE_TTL = 60_000;
const MAX_STALE_AGE = 24 * 60 * 60 * 1000;
const STORAGE_TIMEOUT = 150;
const SOURCES = new Map([
  [OKX_RATE_PAGE, '欧易 OKX · 获取于'],
  [COINGATE_RATE_URL, 'CoinGate 支付换算参考 · 获取于'],
]);
type Options = {
  fetcher?: typeof fetch;
  now?: () => number;
  readStored?: () => Promise<unknown>;
  writeStored?: (quote: RateQuote) => Promise<void>;
};

function storedQuote(value: unknown, now: number): RateQuote | undefined {
  if (!value || typeof value !== 'object') return;
  const quote = value as Partial<RateQuote>;
  if (typeof quote.rate !== 'string' || rateUnits(quote.rate) === null ||
    quote.kind !== 'reference' || typeof quote.sourceUrl !== 'string' ||
    !SOURCES.has(quote.sourceUrl) || typeof quote.source !== 'string' ||
    SOURCES.get(quote.sourceUrl) !== quote.source ||
    typeof quote.updatedAt !== 'string' || typeof quote.fetchedAt !== 'string') return;
  const updated = Date.parse(quote.updatedAt);
  const fetched = Date.parse(quote.fetchedAt);
  if (!Number.isFinite(updated) || !Number.isFinite(fetched) || updated > now ||
    fetched > now || updated > fetched || now - updated > MAX_STALE_AGE ||
    now - fetched > MAX_STALE_AGE) return;
  return { rate: quote.rate, updatedAt: quote.updatedAt, fetchedAt: quote.fetchedAt,
    source: quote.source!, kind: 'reference', sourceUrl: quote.sourceUrl,
    ...(typeof quote.warning === 'string' ? { warning: quote.warning } : {}) };
}

async function deadline<T>(work: (signal: AbortSignal) => Promise<T>, milliseconds: number): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      // Promise.resolve also turns synchronous adapter errors into rejections.
      Promise.resolve().then(() => work(controller.signal)),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error('汇率服务请求超时'));
        }, milliseconds);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export function createRateService({ fetcher = fetch, now = Date.now, readStored, writeStored }: Options = {}) {
  let lastGood: RateQuote | undefined;
  let storageRead = false;
  let pending: Promise<RateQuote> | undefined;
  let forceRequested = false;

  const fetchOkx = () => deadline(async signal => {
    const response = await fetcher(OKX_RATE_PAGE, { signal, cache: 'no-store',
      headers: { Accept: 'text/html,application/xhtml+xml', 'User-Agent': 'QuickPrice/1.0' } });
    if (!response.ok) throw new Error(`欧易行情服务返回 ${response.status}`);
    const age = Number(response.headers.get('age') ?? 0);
    if (!Number.isFinite(age) || age < 0 || age > 900) throw new Error('欧易页面缓存已过期');
    return parseOkxRate(await response.text(), now());
  }, 2500);

  const fetchCoinGate = () => deadline(async signal => {
    const response = await fetcher(COINGATE_RATE_URL, { signal, cache: 'no-store',
      headers: { Accept: 'application/json', 'User-Agent': 'QuickPrice/1.0' } });
    if (!response.ok) throw new Error(`CoinGate 换算服务返回 ${response.status}`);
    const age = Number(response.headers.get('age') ?? 0);
    if (!Number.isFinite(age) || age < 0 || age > 900) throw new Error('CoinGate 换算缓存已过期');
    return { ...parseCoinGateRate(await response.json(), now()),
      warning: '欧易暂不可用，当前使用 CoinGate 支付换算参考，可能与交易所成交价略有差异。' };
  }, 4000);

  async function loadStored() {
    if (storageRead) return;
    storageRead = true;
    if (!readStored) return;
    try { lastGood = storedQuote(await deadline(() => readStored(), STORAGE_TIMEOUT), now()); }
    catch { /* Storage failure must not block fetching a current reference. */ }
  }

  async function retrieve(): Promise<RateQuote> {
    await loadStored();
    const previous = storedQuote(lastGood, now());
    if (!forceRequested && previous && now() - Date.parse(previous.fetchedAt) < CACHE_TTL) return previous;
    let quote: RateQuote;
    try {
      try { quote = await fetchOkx(); }
      catch { quote = await fetchCoinGate(); }
    } catch {
      const fallback = storedQuote(lastGood, now());
      if (fallback) return { ...fallback, kind: 'stale',
        warning: `最新汇率暂时不可用，已使用 ${fallback.source.split(' · ')[0]} 上次成功汇率（获取于 ${fallback.fetchedAt}）；点击“最新”重试。` };
      throw new Error('最新 USDT/CNY 汇率暂时不可用，请手动输入或重试。');
    }
    // Publish a successful value before storage I/O so persistence cannot drop it.
    lastGood = quote;
    if (writeStored) {
      try { await deadline(() => writeStored(quote), STORAGE_TIMEOUT); }
      catch { /* A valid current quote remains usable when persistence fails. */ }
    }
    return quote;
  }

  return {
    get({ force = false }: { force?: boolean } = {}): Promise<RateQuote> {
      const current = storedQuote(lastGood, now());
      if (!force && current && now() - Date.parse(current.fetchedAt) < CACHE_TTL) return Promise.resolve(current);
      if (pending) {
        // A forced request may arrive while a normal request is loading storage.
        if (force) forceRequested = true;
        return pending;
      }
      forceRequested = force;
      pending = retrieve().finally(() => { pending = undefined; forceRequested = false; });
      return pending;
    },
  };
}
