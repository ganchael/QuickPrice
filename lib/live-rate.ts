import { rateUnits } from './quote-export.ts';

export const OKX_RATE_PAGE = 'https://www.okx.com/zh-hans/convert/usdt-to-cny';
export const KUCOIN_RATE_URL = 'https://api.kucoin.eu/api/v1/prices?base=CNY&currencies=USDT';
export const KUCOIN_RATE_PAGE = 'https://www.kucoin.com/zh-hant/price/USDT';
export const OKX_FEED_URL = 'https://raw.githubusercontent.com/ganchael/QuickPrice/rate-feed/okx-usdt-cny.json';
export const OKX_FEED_API_URL = 'https://api.github.com/repos/ganchael/QuickPrice/contents/okx-usdt-cny.json?ref=rate-feed';
export type RateQuote = {
  rate: string;
  updatedAt: string;
  fetchedAt: string;
  source: string;
  kind: 'reference' | 'stale';
  sourceUrl: string;
  delivery?: 'scheduled';
  warning?: string;
};

function formatRate(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value >= 1000000) throw new Error('USDT/CNY 报价无效');
  const rate = value.toFixed(6);
  if (rateUnits(rate) === null) throw new Error('USDT/CNY 汇率无效');
  return rate;
}

function result(rate: string, now: number, source: string, sourceUrl = OKX_RATE_PAGE): RateQuote {
  // These sources supply no market timestamp. Label retrieval time, never quote time.
  return { rate, updatedAt: new Date(now).toISOString(), fetchedAt: new Date(now).toISOString(), source, kind: 'reference', sourceUrl };
}

export function parseOkxRate(html: string, now = Date.now(), sourceUrl = OKX_RATE_PAGE) {
  const script = html.match(/<script\b[^>]*\bid=["']appState["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!script) throw new Error('欧易行情页面缺少数据');
  const props = JSON.parse(script[1])?.appContext?.serverSideProps;
  const pair = props?.detail?.currencyPairInfo;
  const value = props?.detail?.convertInfo?.rate;
  if (props?.fetchParams?.fromCurrency !== 'USDT' || props?.fetchParams?.toCurrency !== 'CNY' || pair?.crypto?.currency !== 'USDT' || pair?.fiat?.currency !== 'CNY' || pair?.pair !== 'usdt-to-cny') throw new Error('欧易行情币种不匹配');
  return result(formatRate(value), now, '欧易 OKX · 获取于', sourceUrl);
}

export function parseKuCoinRate(payload: unknown, now = Date.now()): RateQuote {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('KuCoin USDT/CNY 行情无效');
  const response = payload as { code?: unknown; data?: unknown };
  if (response.code !== '200000' || !response.data || typeof response.data !== 'object' || Array.isArray(response.data)) throw new Error('KuCoin USDT/CNY 行情无效');
  let value = (response.data as Record<string, unknown>).USDT;
  if (typeof value === 'string' && /^\d{1,6}(?:\.\d+)?$/.test(value)) value = Number(value);
  if (typeof value !== 'number') throw new Error('KuCoin USDT/CNY 行情缺少有效 USDT 价格');
  return result(formatRate(value), now, 'KuCoin 市场参考 · 获取于', KUCOIN_RATE_URL);
}
