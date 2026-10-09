import { writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const OKX_RATE_PAGE = 'https://www.okx.com/zh-hans/convert/usdt-to-cny';
export const OKX_UPSTREAM_URL = 'https://www.okx.com/priapi/v3/growth/convert/detail?baseCurrency=USDT&quoteCurrency=CNY';
const MAX_CACHE_AGE_SECONDS = 300;
const CLOCK_TOLERANCE_MS = 30_000;
const MAX_BODY_BYTES = 128 * 1024;
const DEFAULT_DEADLINE_MS = 8000;

export function parseOkxFeed(payload, fetchedAt = Date.now(), headers = new Headers()) {
  if (!Number.isFinite(fetchedAt) || fetchedAt <= 0) throw new Error('获取时间无效');
  const data = payload?.data;
  if (payload?.code !== 0 || data?.baseCurrencyInfo?.currency !== 'USDT' ||
      data?.baseCurrencyInfo?.type !== 'CRYPTO' || data?.quoteCurrencyInfo?.currency !== 'CNY' ||
      data?.quoteCurrencyInfo?.type !== 'FIAT') throw new Error('欧易返回的币对不是 USDT/CNY');
  const price = data?.convertInfo?.currentPrice;
  const rawRate = typeof price === 'number' ? String(price) : price;
  if (typeof rawRate !== 'string' || !/^\d{1,6}(?:\.\d+)?$/.test(rawRate)) throw new Error('欧易报价格式无效');
  const numericRate = Number(rawRate);
  if (!Number.isFinite(numericRate) || numericRate <= 0 || numericRate >= 1_000_000) throw new Error('欧易报价无效');
  const rate = numericRate.toFixed(6);
  if (Number(rate) <= 0) throw new Error('欧易报价过小');

  const ageHeader = headers.get('age');
  const age = ageHeader === null ? 0 : Number(ageHeader);
  if (ageHeader !== null && !/^\d+$/.test(ageHeader) || !Number.isSafeInteger(age) || age > MAX_CACHE_AGE_SECONDS) {
    throw new Error('欧易上游缓存已过期');
  }
  const dateHeader = headers.get('date');
  if (dateHeader !== null) {
    const upstreamTime = Date.parse(dateHeader);
    if (!Number.isFinite(upstreamTime) || upstreamTime > fetchedAt + CLOCK_TOLERANCE_MS ||
        fetchedAt - upstreamTime > MAX_CACHE_AGE_SECONDS * 1000 + CLOCK_TOLERANCE_MS) {
      throw new Error('欧易上游时间异常或过期');
    }
  }

  const timestamp = new Date(fetchedAt).toISOString();
  // The endpoint supplies no market timestamp: these times mean successful retrieval.
  return {
    schemaVersion: 1, baseCurrency: 'USDT', quoteCurrency: 'CNY', delivery: 'scheduled',
    rate, rawRate, fetchedAt: timestamp, updatedAt: timestamp,
    source: '欧易 OKX · 获取于', kind: 'reference', sourceUrl: OKX_RATE_PAGE,
  };
}

export async function fetchOkxFeed({ fetcher = fetch, now = Date.now, deadlineMs = DEFAULT_DEADLINE_MS,
  attempts = 3, wait = milliseconds => new Promise(resolveWait => setTimeout(resolveWait, milliseconds)) } = {}) {
  if (!Number.isFinite(deadlineMs) || deadlineMs <= 0 || deadlineMs > DEFAULT_DEADLINE_MS ||
      !Number.isInteger(attempts) || attempts < 1 || attempts > 3) throw new Error('取数重试或超时配置无效');
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const controller = new AbortController();
    let timeout;
    try {
      return await Promise.race([
        Promise.resolve().then(async () => {
          const response = await fetcher(OKX_UPSTREAM_URL, {
            method: 'GET', cache: 'no-store', redirect: 'error', signal: controller.signal,
            headers: { Accept: 'application/json', 'User-Agent': 'QuickPrice-OKX-Feed/1.0' },
          });
          if (!response.ok) throw new Error(`欧易请求失败（HTTP ${response.status}）`);
          const length = response.headers.get('content-length');
          if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_BODY_BYTES)) throw new Error('欧易响应过大');
          const content = await response.text();
          if (Buffer.byteLength(content, 'utf8') > MAX_BODY_BYTES) throw new Error('欧易响应过大');
          return parseOkxFeed(JSON.parse(content), now(), response.headers);
        }),
        new Promise((_, reject) => {
          timeout = setTimeout(() => {
            controller.abort();
            reject(new Error('欧易请求超时'));
          }, deadlineMs);
        }),
      ]);
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timeout);
    }
    if (attempt + 1 < attempts) await wait((attempt + 1) * 1000);
  }
  throw new Error(`未获取到有效欧易 USDT/CNY 汇率，保留原有报价：${lastError?.message ?? '未知错误'}`);
}

export async function writeOkxFeed(path, options = {}) {
  // Fetch and validate first: failures must not touch a previous successful quote.
  const quote = await fetchOkxFeed(options);
  const destination = resolve(path);
  await mkdir(dirname(destination), { recursive: true });
  const temporary = `${destination}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(quote, null, 2)}\n`, { mode: 0o644 });
  await rename(temporary, destination);
  return quote;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const destination = process.argv[2];
  if (!destination || process.argv.length !== 3) {
    console.error('Usage: node scripts/fetch-okx-rate.mjs <output.json>');
    process.exitCode = 1;
  } else {
    try {
      const quote = await writeOkxFeed(destination);
      console.log(`OKX USDT/CNY ${quote.rawRate}; successfully fetched at ${quote.fetchedAt}`);
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}
