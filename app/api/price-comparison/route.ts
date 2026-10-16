import { authJson, getAccountUser } from '@/app/account-auth';
import { getCatalogDatabase } from '@/db';
import { readComparison } from '@/lib/price-store';
export const dynamic = 'force-dynamic';
export async function GET() {
  const user = await getAccountUser();
  if (!user) return authJson({ error: '请先登录。' }, 401);
  try { return authJson(await readComparison(getCatalogDatabase(), user)); }
  catch { return authJson({ error: '对比数据加载失败。' }, 503); }
}
