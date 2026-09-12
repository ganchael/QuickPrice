import { rateUnits } from './quote-export.ts';

export const BINANCE_RATE_PAGE = 'https://www.binance.com/zh-CN/price/tether/CNY';
type Quote = { timestamp?: string; quote?: { USD?: { price?: number } } };

export function parseBinanceRate(currencies: unknown, history: unknown, now = Date.now()) {
  const fx = currencies as { code?: string; success?: boolean; data?: { pair?: string; rate?: number }[] };
  const prices = history as { code?: string; success?: boolean; data?: { body?: { data?: { id?: number; symbol?: string; quotes?: Quote[] }; status?: { error_code?: number } } } };
  const asset = prices?.data?.body?.data;
  if (fx?.code !== '000000' || fx.success !== true || !Array.isArray(fx.data) || prices?.code !== '000000' || prices.success !== true || prices.data?.body?.status?.error_code !== 0 || asset?.id !== 825 || asset.symbol !== 'USDT' || !Array.isArray(asset.quotes)) throw new Error('币安行情格式无效');
  const cny = fx.data.find(item => item.pair === 'CNY_USD')?.rate;
  const latest = [...asset.quotes].sort((a, b) => Date.parse(b.timestamp ?? '') - Date.parse(a.timestamp ?? ''))[0];
  const timestamp = Date.parse(latest?.timestamp ?? '');
  const usd = latest?.quote?.USD?.price;
  if (typeof cny !== 'number' || !Number.isFinite(cny) || cny <= 0 || typeof usd !== 'number' || !Number.isFinite(usd) || usd <= 0) throw new Error('币安报价无效');
  if (!Number.isFinite(timestamp) || now - timestamp > 15 * 60000 || timestamp > now + 60000) throw new Error('币安行情已过期');
  // Binance price converter: coin.quote.USD.price * currencyData.rate.
  const rate = (usd * cny).toFixed(6);
  if (rateUnits(rate) === null) throw new Error('币安汇率无效');
  return { rate, updatedAt: new Date(timestamp).toISOString(), fetchedAt: new Date(now).toISOString(), source: '币安 · 5分钟行情', kind: 'market', sourceUrl: BINANCE_RATE_PAGE };
}
