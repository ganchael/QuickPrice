import { getAccountUser } from '@/app/account-auth';
import { parseLiveRate, parseDailyRate } from '@/lib/live-rate';

export const dynamic = 'force-dynamic';
let cached: { value: ReturnType<typeof parseLiveRate>; expires: number } | undefined;
let pending: Promise<ReturnType<typeof parseLiveRate>> | undefined;
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie' } });
export async function GET() {
  if (!await getAccountUser()) return json({ error: '请先登录。' }, 401);
  try {
    if (cached && Date.now() < cached.expires) return json(cached.value);
    if (!pending) pending = (async () => {
      let value;
      try {
        const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=tether&vs_currencies=cny&include_last_updated_at=true&precision=6', { signal: AbortSignal.timeout(4000) });
        if (!response.ok) throw new Error('行情服务暂不可用');
        value = parseLiveRate(await response.json());
      } catch {
        for (const url of ['https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usdt.json', 'https://latest.currency-api.pages.dev/v1/currencies/usdt.json']) {
          try {
            const response = await fetch(url, { signal: AbortSignal.timeout(2500) });
            if (!response.ok) continue;
            value = parseDailyRate(await response.json()); break;
          } catch { /* Try the alternate daily source. */ }
        }
      }
      if (!value) throw new Error('行情来源均不可用');
      cached = { value, expires: Date.now() + 60000 };
      return value;
    })().finally(() => { pending = undefined; });
    return json(await pending);
  } catch (error) {
    console.warn('Exchange rate unavailable:', error instanceof Error ? error.message : 'unknown error');
    return json({ error: '最新汇率获取失败，请手动输入或重试。' }, 503);
  }
}
