import { authJson, getAccountUser, isSameOrigin } from '@/app/account-auth';
import { getCatalogDatabase } from '@/db';
import { validateCatalog } from '@/lib/catalog';
import { PriceError, applyMaster, readShared } from '@/lib/price-store';

export const dynamic = 'force-dynamic';
const fail = (error: unknown, fallback: string) => {
  if (error instanceof PriceError) return authJson({ error: error.message, ...error.details }, error.status);
  console.error(fallback);
  return authJson({ error: fallback }, 503);
};

export async function GET() {
  const user = await getAccountUser();
  if (!user) return authJson({ error: '请先登录后管理商品库。' }, 401);
  try { return authJson(await readShared(getCatalogDatabase(), user)); }
  catch (error) { return fail(error, '商品库加载失败，请稍后重试。'); }
}

export async function PUT(request: Request) {
  const user = await getAccountUser();
  if (!user) return authJson({ error: '登录已失效，请重新登录。' }, 401);
  if (!user.canEditMaster) return authJson({ error: '当前账号不能修改或删除已有商品资料。' }, 403);
  if (!isSameOrigin(request)) return authJson({ error: '请从本站保存商品库。' }, 403);
  if (!request.headers.get('content-type')?.includes('application/json')) return authJson({ error: '请求格式不正确。' }, 415);
  try {
    const text = await request.text();
    if (text.length > 1500000) return authJson({ error: '商品库过大，请减少商品数量。' }, 413);
    const payload = JSON.parse(text) as { products?: unknown; revision?: unknown; costRevision?: unknown; ownerId?: unknown; expectedActorId?: unknown; requestId?: unknown };
    if (payload.ownerId !== undefined && payload.ownerId !== 'account:888') return authJson({ error: '不能指定商品库所有者。' }, 403);
    if (payload.expectedActorId !== undefined && payload.expectedActorId !== user.userId) return authJson({ error: '登录账号已改变，请刷新页面后重新加载对应商品库。' }, 403);
    if (!Number.isSafeInteger(payload.revision) || Number(payload.revision) < 0) return authJson({ error: '商品库版本无效，请重新加载。' }, 400);
    const products = validateCatalog(payload.products);
    const saved = await applyMaster(getCatalogDatabase(), user, {
      expectedActorId: user.userId,
      catalogRevision: Number(payload.revision),
      costRevision: Number.isSafeInteger(payload.costRevision) ? Number(payload.costRevision) : 0,
      products,
      requestId: typeof payload.requestId === 'string' ? payload.requestId : undefined,
    });
    const state = await readShared(getCatalogDatabase(), user);
    return authJson({ ...state, costWarning: saved.costWarning });
  } catch (error) { return fail(error, '保存失败，改动尚未写入云端，请重试。'); }
}
