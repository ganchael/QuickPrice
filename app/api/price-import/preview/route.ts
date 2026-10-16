import { authJson, getAccountUser, isSameOrigin } from '@/app/account-auth';
import { getCatalogDatabase } from '@/db';
import { previewCounts, previewPriceRows, type PriceTarget, type RawPriceRow } from '@/lib/price-domain';
import { readShared } from '@/lib/price-store';
import { moneyCents } from '@/lib/pricing';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  const user = await getAccountUser();
  if (!user) return authJson({ error: '请先登录。' }, 401);
  if (!isSameOrigin(request)) return authJson({ error: '请从本站预览导入。' }, 403);
  try {
    const payload = await request.json() as { target?: PriceTarget; rows?: RawPriceRow[]; expectedActorId?: string };
    if (payload.expectedActorId !== user.userId) return authJson({ error: '登录账号已改变，请刷新后再导入。' }, 403);
    if (payload.target !== 'sales' && payload.target !== 'cost' && payload.target !== 'both') return authJson({ error: '请先选择导入销售价、成本价或双价。' }, 400);
    const rows = Array.isArray(payload.rows) ? payload.rows.slice(0, 2000) : [];
    const state = await readShared(getCatalogDatabase(), user);
    const known = state.products.map(product => ({
      id: product.id, shortName: product.shortName, name: product.name, specification: product.specification, unit: product.unit, aliases: product.aliases,
      salesCents: product.salesPrice === null ? null : moneyCents(product.salesPrice),
      costCents: product.costStatus === 'error' ? null : product.costPrice === null ? null : moneyCents(product.costPrice),
      costStatus: product.costStatus,
    }));
    const preview = previewPriceRows(known, rows, payload.target);
    return authJson({ target: payload.target, actorId: user.userId, revision: state.revision, costRevision: state.costRevision, counts: previewCounts(preview), rows: preview });
  } catch { return authJson({ error: '预览失败，没有写入价格。' }, 400); }
}
