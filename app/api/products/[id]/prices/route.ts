import { authJson, getAccountUser, isSameOrigin } from '@/app/account-auth';
import { getCatalogDatabase } from '@/db';
import { PriceError, patchPrices, type PriceField } from '@/lib/price-store';
export const dynamic = 'force-dynamic';
const allowed = new Set(['requestId', 'expectedActorId', 'catalogRevision', 'costRevision', 'seenFingerprint', 'sales', 'cost']);
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> | { id: string } }) {
  const user = await getAccountUser();
  if (!user) return authJson({ error: '请先登录。' }, 401);
  if (!isSameOrigin(request)) return authJson({ error: '请从本站保存价格。' }, 403);
  if (!request.headers.get('content-type')?.includes('application/json')) return authJson({ error: '请求格式不正确。' }, 415);
  const { id } = await context.params;
  try {
    const payload = await request.json() as Record<string, unknown>;
    if (Object.keys(payload).some(key => !allowed.has(key))) return authJson({ error: '改价不能修改商品资料或删除商品。' }, 400);
    const saved = await patchPrices(getCatalogDatabase(), user, id, {
      requestId: String(payload.requestId ?? ''),
      expectedActorId: String(payload.expectedActorId ?? ''),
      catalogRevision: Number(payload.catalogRevision),
      costRevision: Number(payload.costRevision),
      seenFingerprint: typeof payload.seenFingerprint === 'string' ? payload.seenFingerprint : undefined,
      sales: payload.sales as PriceField | undefined,
      cost: payload.cost as PriceField | undefined,
    });
    return authJson(saved);
  } catch (error) {
    if (error instanceof PriceError) return authJson({ error: error.message, ...error.details }, error.status);
    console.error('Price update failed');
    return authJson({ error: '保存失败，价格没有写入。' }, 503);
  }
}
