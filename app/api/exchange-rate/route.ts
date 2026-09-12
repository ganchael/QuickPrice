import { getAccountUser } from '@/app/account-auth';
import { parseOkxRate, OKX_RATE_PAGE } from '@/lib/live-rate';

export const dynamic = 'force-dynamic';
let cached: { value: ReturnType<typeof parseOkxRate>; expires: number } | undefined;
let pending: Promise<ReturnType<typeof parseOkxRate>> | undefined;
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie' } });
export async function GET() {
  if (!await getAccountUser()) return json({ error: '请先登录。' }, 401);
  try {
    if (cached && Date.now() < cached.expires) return json(cached.value);
    if (!pending) pending = (async () => {
      const response = await fetch(OKX_RATE_PAGE, { signal: AbortSignal.timeout(8000), cache: 'no-store' });
      if (!response.ok) throw new Error(`欧易行情服务返回 ${response.status}`);
      const age = Number(response.headers.get('age') ?? 0);
      if (age > 900) throw new Error('欧易页面缓存已过期');
      const value = parseOkxRate(await response.text());
      cached = { value, expires: Date.now() + 60000 };
      return value;
    })().finally(() => { pending = undefined; });
    return json(await pending);
  } catch (error) {
    console.warn('OKX exchange rate unavailable:', error instanceof Error ? error.message : 'unknown error');
    return json({ error: '欧易汇率获取失败，请手动输入或重试。' }, 503);
  }
}
