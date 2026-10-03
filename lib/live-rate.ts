import { rateUnits } from './quote-export.ts';

export const OKX_RATE_PAGE = 'https://www.okx.com/zh-hans/convert/usdt-to-cny';
export const COINGATE_RATE_URL = 'https://api.coingate.com/v2/rates/merchant/USDT/CNY';
export type RateQuote = {
  rate: string;
  updatedAt: string;
  fetchedAt: string;
  source: string;
  kind: 'reference' | 'stale';
  sourceUrl: string;
  warning?: string;
};

function formatRate(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value >= 1000000) throw new Error('欧易报价无效');
  const rate = value.toFixed(6);
  if (rateUnits(rate) === null) throw new Error('欧易汇率无效');
  return rate;
}

function result(rate: string, now: number, source: string, sourceUrl = OKX_RATE_PAGE): RateQuote {
  // The page supplies no market timestamp. Label this as retrieval time, never quote time.
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

export function parseCoinGateRate(value: unknown, now = Date.now()): RateQuote {
  // This endpoint returns a scalar, not an order-book price or a USD/CNY quote.
  if (typeof value === 'string' && /^\d{1,6}(?:\.\d+)?$/.test(value)) value = Number(value);
  if (typeof value !== 'number') throw new Error('CoinGate USDT/CNY 换算参考无效');
  return result(formatRate(value), now, 'CoinGate 支付换算参考 · 获取于', COINGATE_RATE_URL);
}
