import { getAccountUser } from '@/app/account-auth';
import { parseBinanceRate } from '@/lib/live-rate';

export const dynamic = 'force-dynamic';
let cached: { value: ReturnType<typeof parseBinanceRate>; expires: number } | undefined;
let pending: Promise<ReturnType<typeof parseBinanceRate>> | undefined;
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie' } });
export async function GET() {
  if (!await getAccountUser()) return json({ error: '请先登录。' }, 401);
  try {
    if (cached && Date.now() < cached.expires) return json(cached.value);
    if (!pending) pending = (async () => {
      const start = Math.floor(Date.now() / 300000) * 300 - 86400;
      const urls = [
        'https://www.binance.com/bapi/asset/v1/public/asset-service/product/currency',
        `https://www.binance.com/bapi/composite/v1/public/promo/cmc/cryptocurrency/quotes/historical?id=825&time_start=${start}&interval=5m&count=288`,
      ];
      const [currencies, history] = await Promise.all(urls.map(async url => {
        const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
        if (!response.ok) throw new Error(`币安行情服务返回 ${response.status}`);
        return response.json();
      }));
      const value = parseBinanceRate(currencies, history);
      cached = { value, expires: Date.now() + 60000 };
      return value;
    })().finally(() => { pending = undefined; });
    return json(await pending);
  } catch (error) {
    console.warn('Binance exchange rate unavailable:', error instanceof Error ? error.message : 'unknown error');
    return json({ error: '币安汇率获取失败，请手动输入或重试。' }, 503);
  }
}
