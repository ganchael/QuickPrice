import { authJson, getAccountUser } from '@/app/account-auth';
import { getCatalogDatabase } from '@/db';
import { readBatch } from '@/lib/price-store';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const user = await getAccountUser();
  if (!user) return authJson({ error: '请先登录。' }, 401);
  const requestId = new URL(request.url).searchParams.get('requestId') ?? '';
  try {
    const batch = await readBatch(getCatalogDatabase(), user, requestId);
    if (!batch) return authJson({ error: '没有找到这笔操作。' }, 404);
    return authJson(batch);
  } catch { return authJson({ error: '暂时无法核对这笔操作。' }, 400); }
}
