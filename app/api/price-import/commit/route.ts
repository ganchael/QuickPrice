import { authJson, getAccountUser, isSameOrigin } from '@/app/account-auth';
import { getCatalogDatabase } from '@/db';
import { PriceError, commitPrices, type PriceField } from '@/lib/price-store';
import type { PriceTarget } from '@/lib/price-domain';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  const user = await getAccountUser();
  if (!user) return authJson({ error: '请先登录。' }, 401);
  if (!isSameOrigin(request)) return authJson({ error: '请从本站确认导入。' }, 403);
  try {
    const payload = await request.json() as { requestId?: string; expectedActorId?: string; catalogRevision?: number; costRevision?: number; target?: PriceTarget; skipProblems?: boolean; rows?: { productId: string; sales?: PriceField; cost?: PriceField }[] };
    const saved = await commitPrices(getCatalogDatabase(), user, {
      requestId: String(payload.requestId ?? ''),
      expectedActorId: String(payload.expectedActorId ?? ''),
      catalogRevision: Number(payload.catalogRevision),
      costRevision: Number(payload.costRevision),
      target: payload.target ?? 'cost',
      skipProblems: payload.skipProblems === true,
      rows: Array.isArray(payload.rows) ? payload.rows : [],
    });
    return authJson(saved);
  } catch (error) {
    if (error instanceof PriceError) return authJson({ error: error.message, ...error.details }, error.status);
    console.error('Price import failed');
    return authJson({ error: '导入失败，价格没有写入。' }, 503);
  }
}
