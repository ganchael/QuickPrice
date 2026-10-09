import { KUCOIN_RATE_URL, OKX_RATE_PAGE, OKX_FEED_URL, OKX_FEED_API_URL, parseKuCoinRate, parseOkxRate, type RateQuote } from './live-rate.ts';
import { rateUnits } from './quote-export.ts';

const CACHE_TTL = 60_000;
const MAX_STALE_AGE = 24 * 60 * 60 * 1000;
const STORAGE_TIMEOUT = 150;
const SCHEDULED_FRESH_AGE = 15 * 60 * 1000;
const SOURCES = new Map([
  [OKX_RATE_PAGE, '欧易 OKX · 获取于'],
  [KUCOIN_RATE_URL, 'KuCoin 市场参考 · 获取于'],
]);
type Options = {
  fetcher?: typeof fetch;
  now?: () => number;
  readStored?: () => Promise<unknown>;
  writeStored?: (quote: RateQuote) => Promise<void>;
  scheduled?: boolean;
};

function storedQuote(value: unknown, now: number): RateQuote | undefined {
  if (!value || typeof value !== 'object') return;
  const quote = value as Partial<RateQuote>;
  if (typeof quote.rate !== 'string' || rateUnits(quote.rate) === null ||
    quote.kind !== 'reference' || typeof quote.sourceUrl !== 'string' ||
    !SOURCES.has(quote.sourceUrl) || typeof quote.source !== 'string' ||
    SOURCES.get(quote.sourceUrl) !== quote.source ||
    (quote.delivery !== undefined && (quote.delivery !== 'scheduled' || quote.sourceUrl !== OKX_RATE_PAGE)) ||
    typeof quote.updatedAt !== 'string' || typeof quote.fetchedAt !== 'string') return;
  const updated = Date.parse(quote.updatedAt);
  const fetched = Date.parse(quote.fetchedAt);
  if (!Number.isFinite(updated) || !Number.isFinite(fetched) || updated > now ||
    fetched > now || updated > fetched || now - updated > MAX_STALE_AGE ||
    now - fetched > MAX_STALE_AGE) return;
  return { rate: quote.rate, updatedAt: quote.updatedAt, fetchedAt: quote.fetchedAt,
    source: quote.source!, kind: 'reference', sourceUrl: quote.sourceUrl,
    ...(quote.delivery === 'scheduled' ? { delivery: 'scheduled' as const } : {}),
    ...(typeof quote.warning === 'string' ? { warning: quote.warning } : {}) };
}

export function parseScheduledOkxFeed(value: unknown, now = Date.now()): RateQuote {
  if (!value || typeof value !== 'object') throw new Error('欧易定时报价无效');
  const feed = value as Partial<RateQuote> & { schemaVersion?: unknown; baseCurrency?: unknown; quoteCurrency?: unknown; rawRate?: unknown };
  const quote = storedQuote(feed, now);
  if (!quote || feed.schemaVersion !== 1 || feed.baseCurrency !== 'USDT' || feed.quoteCurrency !== 'CNY' ||
    quote.sourceUrl !== OKX_RATE_PAGE || quote.delivery !== 'scheduled' || quote.updatedAt !== quote.fetchedAt ||
    !/^\d{1,6}(?:\.\d+)?$/.test(String(feed.rawRate)) ||
    !Number.isFinite(Number(feed.rawRate)) || Number(feed.rawRate).toFixed(6) !== quote.rate) {
    throw new Error('欧易定时报价币对、数值或时间无效');
  }
  return quote;
}

function scheduledStatus(quote: RateQuote, now: number): RateQuote {
  if (quote.delivery !== 'scheduled') return quote;
  if (now - Date.parse(quote.fetchedAt) > SCHEDULED_FRESH_AGE) return { ...quote, kind: 'stale',
    warning: '欧易定时取数已超过 15 分钟未更新，当前使用最近成功报价；获取时间保持不变，可手动修改汇率。' };
  return { ...quote, kind: 'reference' };
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

export function createRateService({ fetcher = fetch, now = Date.now, readStored, writeStored, scheduled = false }: Options = {}) {
  let lastGood: RateQuote | undefined;
  let lastCheckedAt: number | undefined;
  let storageRead = false;
  let pending: Promise<RateQuote> | undefined;
  let forceRequested = false;

  const fetchScheduled = async () => {
    // These two GitHub domains have different network paths from Shanghai.
    // Both return the same fixed feed, and neither changes its acquisition time.
    let failure: unknown;
    for (const [url, accept] of [
      [`${OKX_FEED_URL}?t=${now()}`, 'application/json'],
      [`${OKX_FEED_API_URL}&t=${now()}`, 'application/vnd.github.raw+json'],
    ]) {
      try {
        return await deadline(async signal => {
          const response = await fetcher(url, { signal, cache: 'no-store', redirect: 'manual',
            headers: { Accept: accept, 'User-Agent': 'QuickPrice/1.0' } });
          if (!response.ok) throw new Error(`欧易定时报价读取失败 ${response.status}`);
          const quote = parseScheduledOkxFeed(await response.json(), now());
          const previous = storedQuote(lastGood, now());
          if (previous?.delivery === 'scheduled' && Date.parse(quote.fetchedAt) < Date.parse(previous.fetchedAt)) {
            throw new Error('欧易定时报价返回了更早的数据');
          }
          return quote;
        }, 1800);
      } catch (error) { failure = error; }
    }
    throw failure;
  };

  const fetchOkx = () => deadline(async signal => {
    const response = await fetcher(OKX_RATE_PAGE, { signal, cache: 'no-store',
      headers: { Accept: 'text/html,application/xhtml+xml', 'User-Agent': 'QuickPrice/1.0' } });
    if (!response.ok) throw new Error(`欧易行情服务返回 ${response.status}`);
    const age = Number(response.headers.get('age') ?? 0);
    if (!Number.isFinite(age) || age < 0 || age > 900) throw new Error('欧易页面缓存已过期');
    return parseOkxRate(await response.text(), now());
  }, 2500);

  const fetchKuCoin = () => deadline(async signal => {
    const response = await fetcher(KUCOIN_RATE_URL, { signal, cache: 'no-store',
      headers: { Accept: 'application/json', 'User-Agent': 'QuickPrice/1.0' } });
    if (!response.ok) throw new Error(`KuCoin 行情服务返回 ${response.status}`);
    const age = Number(response.headers.get('age') ?? 0);
    if (!Number.isFinite(age) || age < 0 || age > 900) throw new Error('KuCoin 行情缓存已过期');
    return parseKuCoinRate(await response.json(), now());
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
    if (!forceRequested && previous && cacheIsFresh(previous)) return scheduledStatus(previous, now());
    let quote: RateQuote;
    try {
      if (scheduled) {
        try {
          quote = await fetchScheduled();
          if (previous?.delivery === 'scheduled' && Date.parse(quote.fetchedAt) < Date.parse(previous.fetchedAt)) {
            return { ...previous, kind: 'stale', warning: '欧易定时报价返回了更早的数据，已保留上次成功报价与原获取时间。' };
          }
        } catch {
          if (previous?.delivery === 'scheduled') return { ...previous, kind: 'stale',
            warning: '欧易定时报价暂时读取失败，已保留最近成功报价与原获取时间；可点击“最新”重试或手动修改。' };
          quote = { ...await fetchKuCoin(), warning: '欧易定时报价暂时不可用，当前使用 KuCoin 市场参考；可稍后重新读取欧易报价。' };
        }
      } else {
        try { quote = await fetchKuCoin(); }
        catch { quote = { ...await fetchOkx(), warning: 'KuCoin 暂时不可用，当前使用欧易 OKX USDT/CNY 市场参考。' }; }
      }
    } catch {
      const fallback = storedQuote(lastGood, now());
      if (fallback) return { ...fallback, kind: 'stale',
        warning: `最新汇率暂时不可用，已使用 ${fallback.source.split(' · ')[0]} 上次成功汇率（获取于 ${fallback.fetchedAt}）；点击“最新”重试。` };
      throw new Error('最新 USDT/CNY 汇率暂时不可用，请手动输入或重试。');
    }
    // Publish a successful value before storage I/O so persistence cannot drop it.
    lastGood = quote;
    lastCheckedAt = now();
    if (writeStored) {
      try { await deadline(() => writeStored(quote), STORAGE_TIMEOUT); }
      catch { /* A valid current quote remains usable when persistence fails. */ }
    }
    return scheduledStatus(quote, now());
  }

  function cacheIsFresh(quote: RateQuote) {
    // Local cache timing is separate from the original OKX acquisition time.
    const time = quote.delivery === 'scheduled' ? lastCheckedAt : Date.parse(quote.fetchedAt);
    return time !== undefined && now() >= time && now() - time < CACHE_TTL;
  }

  return {
    get({ force = false }: { force?: boolean } = {}): Promise<RateQuote> {
      const current = storedQuote(lastGood, now());
      if (!force && current && cacheIsFresh(current)) return Promise.resolve(scheduledStatus(current, now()));
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
