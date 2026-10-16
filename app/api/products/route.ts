import { authJson, getAccountUser, isSameOrigin } from '@/app/account-auth';
import { getCatalogDatabase } from '@/db';
import { PriceError, createProduct } from '@/lib/price-store';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  const user = await getAccountUser();
  if (!user) return authJson({ error: '请先登录。' }, 401);
  if (!isSameOrigin(request)) return authJson({ error: '请从本站保存商品。' }, 403);
  if (!request.headers.get('content-type')?.includes('application/json')) return authJson({ error: '请求格式不正确。' }, 415);
  try {
    const payload = await request.json() as Record<string, unknown>;
    if ('userId' in payload || 'role' in payload || 'ownerId' in payload) return authJson({ error: '不能指定身份或商品库所有者。' }, 403);
    const saved = await createProduct(getCatalogDatabase(), user, {
      requestId: String(payload.requestId ?? ''),
      expectedActorId: String(payload.expectedActorId ?? ''),
      catalogRevision: Number(payload.catalogRevision),
      costRevision: Number(payload.costRevision),
      product: (payload.product ?? {}) as { shortName?: string; name?: string; specification?: string; category?: string; unit?: string; aliases?: string[] },
      salesPrice: payload.salesPrice as string | null | undefined,
      costPrice: payload.costPrice as string | null | undefined,
    });
    return authJson(saved, 200);
  } catch (error) {
    if (error instanceof PriceError) return authJson({ error: error.message, ...error.details }, error.status);
    console.error('Product create failed');
    return authJson({ error: '保存失败，商品和价格都没有写入。' }, 503);
  }
}
