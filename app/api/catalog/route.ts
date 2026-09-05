import { getChatGPTUser } from '@/app/chatgpt-auth';
import { getCatalogDatabase } from '@/db';
import { validateCatalog } from '@/lib/catalog';

export const dynamic = 'force-dynamic';
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie' } });
type CatalogRecord = { products_json: string; revision: number; updated_at: string };

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return json({ error: '请先登录后管理商品库。' }, 401);
  try {
    const record = await getCatalogDatabase().prepare('SELECT products_json, revision, updated_at FROM catalogs WHERE user_id = ?').bind(user.userId).first<CatalogRecord>();
    return json(record ? { ownerId: user.userId, products: JSON.parse(record.products_json), revision: record.revision, updatedAt: record.updated_at } : { ownerId: user.userId, products: [], revision: 0, updatedAt: null });
  } catch (error) { console.error('Catalog read failed', error); return json({ error: '商品库加载失败，请稍后重试。' }, 503); }
}

export async function PUT(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return json({ error: '登录已失效，请重新登录。' }, 401);
  const origin = request.headers.get('origin');
  if ((origin && origin !== new URL(request.url).origin) || request.headers.get('sec-fetch-site') === 'cross-site') return json({ error: '请从本站保存商品库。' }, 403);
  if (!request.headers.get('content-type')?.includes('application/json')) return json({ error: '请求格式不正确。' }, 415);
  let payload: { products?: unknown; revision?: unknown; ownerId?: unknown };
  let products;
  try {
    const text = await request.text();
    if (text.length > 1500000) return json({ error: '商品库过大，请减少商品数量。' }, 413);
    payload = JSON.parse(text);
    if (payload.ownerId !== user.userId) return json({ error: '登录账号已改变，请刷新页面后重新加载对应商品库。' }, 403);
    if (!Number.isSafeInteger(payload.revision) || Number(payload.revision) < 0) throw new Error('商品库版本无效，请重新加载。');
    products = validateCatalog(payload.products);
  } catch (error) { return json({ error: error instanceof Error ? error.message : '商品格式不正确。' }, 400); }
  try {
    const db = getCatalogDatabase(), now = new Date().toISOString();
    const revision = Number(payload.revision);
    const result = revision === 0
      ? await db.prepare('INSERT INTO catalogs (user_id, products_json, revision, updated_at) VALUES (?, ?, 1, ?) ON CONFLICT(user_id) DO NOTHING').bind(user.userId, JSON.stringify(products), now).run()
      : await db.prepare('UPDATE catalogs SET products_json = ?, revision = revision + 1, updated_at = ? WHERE user_id = ? AND revision = ?').bind(JSON.stringify(products), now, user.userId, revision).run();
    if (result.meta.changes !== 1) return json({ error: '另一台设备已更新商品库。请先同步最新数据，再重新保存；当前编辑内容仍保留。' }, 409);
    return json({ ownerId: user.userId, products, revision: revision + 1, updatedAt: now });
  } catch (error) { console.error('Catalog save failed', error); return json({ error: '保存失败，改动尚未写入云端，请重试。' }, 503); }
}
