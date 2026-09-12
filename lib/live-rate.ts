import { rateUnits } from './quote-export.ts';

export const OKX_RATE_PAGE = 'https://www.okx.com/zh-hans/convert/usdt-to-cny';

export function parseOkxRate(html: string, now = Date.now()) {
  const script = html.match(/<script\b[^>]*\bid=["']appState["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!script) throw new Error('欧易行情页面缺少数据');
  const props = JSON.parse(script[1])?.appContext?.serverSideProps;
  const pair = props?.detail?.currencyPairInfo;
  const value = props?.detail?.convertInfo?.rate;
  if (props?.fetchParams?.fromCurrency !== 'USDT' || props?.fetchParams?.toCurrency !== 'CNY' || pair?.crypto?.currency !== 'USDT' || pair?.fiat?.currency !== 'CNY' || pair?.pair !== 'usdt-to-cny') throw new Error('欧易行情币种不匹配');
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) throw new Error('欧易报价无效');
  const rate = value.toFixed(6);
  if (rateUnits(rate) === null) throw new Error('欧易汇率无效');
  // The page supplies no market timestamp. Label this as retrieval time, never quote time.
  return { rate, updatedAt: new Date(now).toISOString(), fetchedAt: new Date(now).toISOString(), source: '欧易 OKX · 获取于', kind: 'reference', sourceUrl: OKX_RATE_PAGE };
}
