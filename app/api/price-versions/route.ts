import { authJson, getAccountUser } from '@/app/account-auth';
import { getCatalogDatabase } from '@/db';
import { readVersions } from '@/lib/price-store';
export const dynamic = 'force-dynamic';
export async function GET() {
  const user = await getAccountUser();
  if (!user) return authJson({ error: '请先登录。' }, 401);
  try { return authJson(await readVersions(getCatalogDatabase(), user)); }
  catch { return authJson({ error: '同步失败／数据截至' }, 503); }
}
