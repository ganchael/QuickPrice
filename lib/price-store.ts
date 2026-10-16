import { COST_ACCOUNT_ID, COST_BOOK_ID, SHARED_CATALOG_ID, accountById, type AccountUser, type PriceType } from './accounts.ts';
import { catalogVariantKey, validateCatalog, validateProduct, MAX_PRODUCTS } from './catalog.ts';
import { compareUnit, displayPrice, formatCents, parsePriceInput, specFingerprint, type CatalogView, type CostStatus, type PriceTarget } from './price-domain.ts';
import { moneyCents, type Product } from './pricing.ts';

export class PriceError extends Error {
  readonly status: number;
  readonly details: Record<string, unknown>;
  constructor(message: string, status: number, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'PriceError';
    this.status = status;
    this.details = details;
  }
}

type Bound = { first<T>(): Promise<T | null>; all<T>(): Promise<{ results: T[] }>; run(): Promise<{ meta?: { changes?: number } }> };
export interface PriceDatabase {
  prepare(query: string): { bind(...values: unknown[]): Bound };
  batch(statements: Bound[]): Promise<unknown>;
}

type CatalogRow = { products_json: string; revision: number; updated_at: string };
type CostRow = { product_id: string; cost_cents: number | null; spec_fingerprint: string; status: string; updated_at: string; updated_by: string };
type MetaRow = { product_id: string; sales_updated_at: string | null };
type BookRow = { revision: number; updated_at: string; last_request_id: string };
type BatchRow = { result: string; before_json: string };

export type PriceField = { amount?: string; baseline: number | null; clear?: boolean };
export type WriteResult = {
  ok: true;
  idempotent: boolean;
  productId?: string;
  revision: number;
  costRevision: number;
  updatedAt: string | null;
  costUpdatedAt: string | null;
  changes: number;
  batchId: string;
  costWarning?: string;
};

const REQUEST_ID = /^[A-Za-z0-9:_-]{8,80}$/;

function assertActor(actor: AccountUser, expectedActorId: string) {
  if (!accountById(actor.userId) || (actor.userId !== SHARED_CATALOG_ID && actor.userId !== COST_ACCOUNT_ID)) throw new PriceError('未知身份。', 401);
  if (actor.userId !== expectedActorId) throw new PriceError('登录账号已改变，请刷新后再保存。', 403, { code: 'actor' });
}
function assertRequest(requestId: string) {
  if (!REQUEST_ID.test(requestId)) throw new PriceError('请求标识不正确。', 400);
}
async function digest(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
}
function newId() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
}
async function one<T>(db: PriceDatabase, sql: string, ...params: unknown[]) {
  return db.prepare(sql).bind(...params).first<T>();
}
async function many<T>(db: PriceDatabase, sql: string, ...params: unknown[]) {
  return (await db.prepare(sql).bind(...params).all<T>()).results;
}

async function load(db: PriceDatabase) {
  const catalog = await one<CatalogRow>(db, 'SELECT products_json, revision, updated_at FROM catalogs WHERE user_id = ?', SHARED_CATALOG_ID);
  let costAvailable = true;
  let book: BookRow | null = null;
  let costs: CostRow[] = [];
  let metas: MetaRow[] = [];
  try {
    book = await one<BookRow>(db, 'SELECT revision, updated_at, last_request_id FROM cost_price_book_state WHERE book_id = ?', COST_BOOK_ID);
    if (!book) costAvailable = false;
    else {
      costs = await many<CostRow>(db, 'SELECT product_id, cost_cents, spec_fingerprint, status, updated_at, updated_by FROM product_cost_prices WHERE catalog_id = ?', SHARED_CATALOG_ID);
      metas = await many<MetaRow>(db, 'SELECT product_id, sales_updated_at FROM product_price_meta WHERE catalog_id = ?', SHARED_CATALOG_ID);
    }
  } catch { costAvailable = false; }
  const products = catalog ? JSON.parse(catalog.products_json) as Product[] : [];
  return { catalog, products, costAvailable, book, costs, metas };
}

function costOf(costs: CostRow[], id: string) {
  return costs.find(row => row.product_id === id);
}
function salesCents(product: Product) {
  return product.price.trim() === '' ? null : moneyCents(product.price);
}
function viewCost(cost: CostRow | undefined, available: boolean): { status: CostStatus; cents: number | null; updatedAt: string | null } {
  if (!available) return { status: 'error', cents: null, updatedAt: null };
  if (!cost || cost.cost_cents === null || cost.status === 'missing') return { status: 'missing', cents: null, updatedAt: cost?.updated_at ?? null };
  if (cost.status === 'pending') return { status: 'pending', cents: cost.cost_cents, updatedAt: cost.updated_at };
  return { status: 'confirmed', cents: cost.cost_cents, updatedAt: cost.updated_at };
}
export function presentProducts(products: Product[], costs: CostRow[], metas: MetaRow[], available: boolean, priceType: PriceType): CatalogView[] {
  return products.map(product => {
    const cost = viewCost(costOf(costs, product.id), available);
    const sales = salesCents(product);
    const view: CatalogView = {
      ...product,
      salesPrice: formatCents(sales),
      costPrice: formatCents(cost.cents),
      costStatus: cost.status,
      costUpdatedAt: cost.updatedAt,
      salesUpdatedAt: metas.find(row => row.product_id === product.id)?.sales_updated_at ?? null,
      specFingerprint: specFingerprint(product.specification, product.unit),
    };
    return { ...view, price: displayPrice(view, priceType) };
  });
}

async function replay(db: PriceDatabase, requestId: string, hash: string): Promise<WriteResult | null> {
  let row: BatchRow | null;
  try { row = await one<BatchRow>(db, 'SELECT result, before_json FROM price_change_batches WHERE request_id = ?', requestId); }
  catch { return null; }
  if (!row) return null;
  const before = JSON.parse(row.before_json) as { hash?: string };
  if (before.hash !== hash) throw new PriceError('这个请求标识已经用于另一笔操作。', 409, { code: 'request' });
  return { ...(JSON.parse(row.result) as WriteResult), idempotent: true };
}

function conflict(message: string, details: Record<string, unknown> = {}) {
  return new PriceError(message, 409, { code: 'conflict', ...details });
}

async function recover(db: PriceDatabase, requestId: string, hash: string, exists?: () => PriceError) {
  const done = await replay(db, requestId, hash);
  if (done) return done;
  if (exists) throw exists();
  throw conflict('另一台设备已更新商品库。请先同步最新数据，再重新保存；当前编辑内容仍保留。');
}

async function writeCatalogOnly(db: PriceDatabase, json: string, revision: number, updatedAt: string, previous: number | null) {
  const result = await catalogWrite(db, json, revision, updatedAt, previous).run();
  if ((result.meta?.changes ?? 0) !== 1) throw conflict('另一台设备已更新商品库。请先同步最新数据，再重新保存；当前编辑内容仍保留。');
}
function catalogWrite(db: PriceDatabase, json: string, revision: number, updatedAt: string, previous: number | null) {
  if (previous === null) {
    return db.prepare('INSERT INTO catalogs (user_id, products_json, revision, updated_at) SELECT ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM catalogs WHERE user_id = ?)').bind(SHARED_CATALOG_ID, json, revision, updatedAt, SHARED_CATALOG_ID);
  }
  return db.prepare('UPDATE catalogs SET products_json = ?, revision = ?, updated_at = ? WHERE user_id = ? AND revision = ?').bind(json, revision, updatedAt, SHARED_CATALOG_ID, previous);
}
function bookWrite(db: PriceDatabase, revision: number, updatedAt: string, requestId: string, previous: number) {
  return db.prepare('UPDATE cost_price_book_state SET revision = ?, updated_at = ?, last_request_id = ? WHERE book_id = ? AND revision = ?').bind(revision, updatedAt, requestId, COST_BOOK_ID, previous);
}
function costWrite(db: PriceDatabase, productId: string, cents: number | null, fingerprint: string, status: string, updatedAt: string, actor: string, batchId: string) {
  return db.prepare(`INSERT INTO product_cost_prices (catalog_id, product_id, cost_cents, spec_fingerprint, status, updated_at, updated_by, batch_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(catalog_id, product_id) DO UPDATE SET cost_cents = excluded.cost_cents, spec_fingerprint = excluded.spec_fingerprint, status = excluded.status, updated_at = excluded.updated_at, updated_by = excluded.updated_by, batch_id = excluded.batch_id`)
    .bind(SHARED_CATALOG_ID, productId, cents, fingerprint, status, updatedAt, actor, batchId);
}
function metaWrite(db: PriceDatabase, productId: string, updatedAt: string, actor: string) {
  return db.prepare(`INSERT INTO product_price_meta (catalog_id, product_id, sales_updated_at, sales_updated_by) VALUES (?, ?, ?, ?)
    ON CONFLICT(catalog_id, product_id) DO UPDATE SET sales_updated_at = excluded.sales_updated_at, sales_updated_by = excluded.sales_updated_by`)
    .bind(SHARED_CATALOG_ID, productId, updatedAt, actor);
}
function guardWrite(db: PriceDatabase, input: { requestId: string; batchId: string; actor: string; now: string; source: string; productIds: string[]; before: unknown; after: unknown; result: WriteResult; catalog: { revision: number; updatedAt: string | null; json: string | null }; cost: { revision: number; requestId: string } | null }) {
  const resultJson = JSON.stringify(input.result);
  if (!input.cost) {
    return db.prepare(`INSERT INTO price_change_batches (request_id, batch_id, actor, created_at, source_type, product_ids, before_json, after_json, result)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN (SELECT revision FROM catalogs WHERE user_id = ?) = ? AND (SELECT updated_at FROM catalogs WHERE user_id = ?) = ? AND (SELECT products_json FROM catalogs WHERE user_id = ?) = ? THEN ? ELSE NULL END`)
      .bind(input.requestId, input.batchId, input.actor, input.now, input.source, JSON.stringify(input.productIds), JSON.stringify(input.before), JSON.stringify(input.after), SHARED_CATALOG_ID, input.catalog.revision, SHARED_CATALOG_ID, input.catalog.updatedAt, SHARED_CATALOG_ID, input.catalog.json, resultJson);
  }
  return db.prepare(`INSERT INTO price_change_batches (request_id, batch_id, actor, created_at, source_type, product_ids, before_json, after_json, result)
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN (SELECT revision FROM catalogs WHERE user_id = ?) = ? AND (SELECT updated_at FROM catalogs WHERE user_id = ?) = ? AND (SELECT products_json FROM catalogs WHERE user_id = ?) = ? AND (SELECT revision FROM cost_price_book_state WHERE book_id = ?) = ? AND (SELECT last_request_id FROM cost_price_book_state WHERE book_id = ?) = ? THEN ? ELSE NULL END`)
    .bind(input.requestId, input.batchId, input.actor, input.now, input.source, JSON.stringify(input.productIds), JSON.stringify(input.before), JSON.stringify(input.after), SHARED_CATALOG_ID, input.catalog.revision, SHARED_CATALOG_ID, input.catalog.updatedAt, SHARED_CATALOG_ID, input.catalog.json, COST_BOOK_ID, input.cost.revision, COST_BOOK_ID, input.cost.requestId, resultJson);
}

function parseField(field: PriceField | undefined, label: string) {
  if (!field) return null;
  if (typeof field.baseline !== 'number' && field.baseline !== null) throw new PriceError(`${label}基线不正确。`, 400);
  if (field.clear) {
    if (field.amount !== undefined && String(field.amount).trim() !== '') throw new PriceError(`清空${label}时不要同时填写金额。`, 400);
    return { cents: null, clear: true, baseline: field.baseline };
  }
  if (field.amount === undefined || String(field.amount).trim() === '') throw new PriceError(`空值不能清空${label}。如需改为待录入，请使用清空。`, 400);
  const parsed = parsePriceInput(String(field.amount));
  if (parsed.kind !== 'cents') throw new PriceError(parsed.kind === 'invalid' ? parsed.message : `${label}不正确。`, 400);
  return { cents: parsed.cents, clear: false, baseline: field.baseline };
}

export async function readShared(db: PriceDatabase, actor: AccountUser) {
  if (!accountById(actor.userId)) throw new PriceError('未知身份。', 401);
  const state = await load(db);
  const products = presentProducts(state.products, state.costs, state.metas, state.costAvailable, actor.priceType);
  return {
    ownerId: SHARED_CATALOG_ID,
    actorId: actor.userId,
    displayName: actor.displayName,
    priceType: actor.priceType,
    canEditMaster: actor.canEditMaster,
    products,
    revision: state.catalog?.revision ?? 0,
    costRevision: state.book?.revision ?? 0,
    updatedAt: state.catalog?.updated_at ?? null,
    costUpdatedAt: state.book?.updated_at ?? null,
    costAvailable: state.costAvailable,
    costError: state.costAvailable ? undefined : '成本价加载失败',
  };
}

export async function readVersions(db: PriceDatabase, actor: AccountUser) {
  const state = await readShared(db, actor);
  return { actorId: state.actorId, revision: state.revision, costRevision: state.costRevision, updatedAt: state.updatedAt, costUpdatedAt: state.costUpdatedAt, costAvailable: state.costAvailable };
}

export async function readComparison(db: PriceDatabase, actor: AccountUser) {
  const state = await readShared(db, actor);
  return {
    ...state,
    comparedAt: state.costUpdatedAt && state.updatedAt ? (state.costUpdatedAt > state.updatedAt ? state.costUpdatedAt : state.updatedAt) : state.updatedAt ?? state.costUpdatedAt,
    rows: state.products.map(product => {
      const sales = product.salesPrice === null ? null : moneyCents(product.salesPrice);
      const cost = product.costStatus === 'confirmed' || product.costStatus === 'pending' ? (product.costPrice === null ? null : moneyCents(product.costPrice)) : null;
      const compared = compareUnit(sales, product.costStatus === 'pending' ? cost : product.costStatus === 'confirmed' ? cost : null, product.costStatus);
      return { product, compared, updatedAt: product.costUpdatedAt ?? product.salesUpdatedAt ?? '' };
    }),
  };
}

export async function readBatch(db: PriceDatabase, actor: AccountUser, requestId: string) {
  if (!accountById(actor.userId)) throw new PriceError('未知身份。', 401);
  assertRequest(requestId);
  const row = await one<BatchRow & { actor: string; source_type: string; created_at: string; batch_id: string }>(db, 'SELECT result, before_json, actor, source_type, created_at, batch_id FROM price_change_batches WHERE request_id = ?', requestId);
  if (!row) return null;
  const result = JSON.parse(row.result) as WriteResult;
  return { requestId, batchId: row.batch_id, actor: row.actor, source: row.source_type, createdAt: row.created_at, result };
}

export async function createProduct(db: PriceDatabase, actor: AccountUser, input: {
  requestId: string; expectedActorId: string; catalogRevision: number; costRevision: number;
  product: { shortName?: string; name?: string; specification?: string; category?: string; unit?: string; aliases?: string[] };
  salesPrice?: string | null; costPrice?: string | null;
}): Promise<WriteResult> {
  assertActor(actor, input.expectedActorId);
  assertRequest(input.requestId);
  const sales = input.salesPrice == null || String(input.salesPrice).trim() === '' ? { kind: 'missing' as const } : parsePriceInput(String(input.salesPrice));
  const cost = input.costPrice == null || String(input.costPrice).trim() === '' ? { kind: 'missing' as const } : parsePriceInput(String(input.costPrice));
  if (sales.kind === 'invalid') throw new PriceError(sales.message, 400);
  if (cost.kind === 'invalid') throw new PriceError(cost.message, 400);
  const hash = await digest({ op: 'create', actor: actor.userId, product: input.product, sales: sales.kind === 'cents' ? sales.cents : null, cost: cost.kind === 'cents' ? cost.cents : null });
  const existing = await replay(db, input.requestId, hash);
  if (existing) return existing;
  const state = await load(db);
  if (cost.kind === 'cents' && !state.costAvailable) throw new PriceError('成本价暂时不可用，商品和价格都没有写入。', 503, { code: 'cost-unavailable' });
  const currentRevision = state.catalog?.revision ?? 0;
  if (input.catalogRevision !== currentRevision) throw conflict('商品库版本已变化，请核对后重试。');
  if (state.costAvailable && state.book && input.costRevision !== state.book.revision) throw conflict('成本版本已变化，请核对后重试。');
  const id = `p-${newId()}`;
  let product: Product;
  try {
    product = validateProduct({ id, shortName: input.product.shortName ?? '', name: input.product.name ?? '', specification: input.product.specification ?? '', category: input.product.category ?? '', unit: input.product.unit ?? '', price: sales.kind === 'cents' ? formatCents(sales.cents)! : '', aliases: input.product.aliases ?? [] });
  } catch (error) { throw new PriceError(error instanceof Error ? error.message : '商品格式不正确。', 400); }
  const duplicate = state.products.find(item => catalogVariantKey(item) === catalogVariantKey(product));
  if (duplicate) throw new PriceError('商品已存在，去补录／编辑价格', 409, { code: 'exists', productId: duplicate.id });
  if (state.products.length >= MAX_PRODUCTS) throw new PriceError(`商品库最多支持 ${MAX_PRODUCTS} 条规格。`, 400);
  const now = new Date().toISOString();
  const nextProducts = [...state.products, product];
  const json = JSON.stringify(nextProducts);
  const nextRevision = currentRevision + 1;
  if (!state.costAvailable) {
    await writeCatalogOnly(db, json, nextRevision, now, state.catalog ? currentRevision : null);
    return { ok: true, idempotent: false, productId: id, revision: nextRevision, costRevision: 0, updatedAt: now, costUpdatedAt: null, changes: 1, batchId: '', costWarning: '成本价暂时不可用，只保存了商品和销售价。' };
  }
  const batchId = `b-${newId()}`;
  const touchCost = cost.kind === 'cents';
  const nextCostRevision = touchCost ? (state.book?.revision ?? 0) + 1 : (state.book?.revision ?? 0);
  const result: WriteResult = { ok: true, idempotent: false, productId: id, revision: nextRevision, costRevision: nextCostRevision, updatedAt: now, costUpdatedAt: touchCost ? now : state.book?.updated_at ?? null, changes: 1, batchId };
  const statements: Bound[] = [catalogWrite(db, json, nextRevision, now, state.catalog ? currentRevision : null)];
  if (touchCost && state.book) {
    statements.push(bookWrite(db, nextCostRevision, now, input.requestId, state.book.revision));
    statements.push(costWrite(db, id, cost.cents, specFingerprint(product.specification, product.unit), 'confirmed', now, actor.userId, batchId));
  }
  if (sales.kind === 'cents' && state.costAvailable) statements.push(metaWrite(db, id, now, actor.userId));
  statements.push(guardWrite(db, {
    requestId: input.requestId, batchId, actor: actor.userId, now, source: 'create', productIds: [id],
    before: { hash, sales: null, cost: null }, after: { sales: product.price, cost: touchCost ? formatCents(cost.cents) : null }, result,
    catalog: { revision: nextRevision, updatedAt: now, json },
    cost: state.costAvailable && state.book ? { revision: nextCostRevision, requestId: touchCost ? input.requestId : state.book.last_request_id } : null,
  }));
  try { await db.batch(statements); return result; }
  catch {
    const done = await replay(db, input.requestId, hash);
    if (done) return done;
    const again = await load(db);
    const winner = again.products.find(item => catalogVariantKey(item) === catalogVariantKey(product));
    if (winner) throw new PriceError('商品已存在，去补录／编辑价格', 409, { code: 'exists', productId: winner.id });
    throw conflict('另一台设备已更新商品库。请先同步最新数据，再重新保存；当前编辑内容仍保留。');
  }
}

export async function patchPrices(db: PriceDatabase, actor: AccountUser, productId: string, input: {
  requestId: string; expectedActorId: string; catalogRevision: number; costRevision: number; seenFingerprint?: string;
  sales?: PriceField; cost?: PriceField;
}): Promise<WriteResult> {
  assertActor(actor, input.expectedActorId);
  assertRequest(input.requestId);
  const extra = Object.keys(input).find(key => !['requestId', 'expectedActorId', 'catalogRevision', 'costRevision', 'seenFingerprint', 'sales', 'cost'].includes(key));
  if (extra) throw new PriceError('改价不能修改商品资料或删除商品。', 400);
  const sales = parseField(input.sales, '销售价');
  const cost = parseField(input.cost, '成本价');
  if (!sales && !cost) throw new PriceError('没有要保存的价格。', 400);
  const hash = await digest({ op: 'price', actor: actor.userId, productId, sales, cost, catalogRevision: input.catalogRevision, costRevision: input.costRevision, seenFingerprint: input.seenFingerprint ?? '' });
  const replayed = await replay(db, input.requestId, hash);
  if (replayed) return replayed;
  const state = await load(db);
  if (!state.catalog) throw new PriceError('商品不存在。', 404);
  if (input.catalogRevision !== state.catalog.revision) throw conflict('商品库版本已变化，请核对后重试。');
  const product = state.products.find(item => item.id === productId);
  if (!product) throw new PriceError('商品不存在。', 404);
  if (cost && !state.costAvailable) throw new PriceError('成本价加载失败，未写入销售价或成本价。', 503, { code: 'cost-unavailable' });
  if (state.book && input.costRevision !== state.book.revision) throw conflict('成本版本已变化，请核对后重试。');
  const currentSales = salesCents(product);
  const currentCost = costOf(state.costs, productId);
  const currentCostCents = currentCost && currentCost.status !== 'missing' ? currentCost.cost_cents : null;
  const conflicts: { field: string; cloud: string | null; typed: string | null }[] = [];
  if (sales && sales.baseline !== currentSales) conflicts.push({ field: 'sales', cloud: formatCents(currentSales), typed: formatCents(sales.cents) });
  if (cost && cost.baseline !== (currentCost?.status === 'pending' ? currentCost.cost_cents : currentCostCents)) conflicts.push({ field: 'cost', cloud: formatCents(currentCost?.cost_cents ?? null), typed: formatCents(cost.cents) });
  if (cost && input.seenFingerprint !== undefined && input.seenFingerprint !== specFingerprint(product.specification, product.unit)) {
    throw conflict('规格或单位已变化，请重新核对后再保存成本。', { conflicts: [{ field: 'master', cloud: specFingerprint(product.specification, product.unit), typed: input.seenFingerprint }] });
  }
  if (conflicts.length) throw conflict('云端价格已变化，请核对后再保存。', { conflicts });
  const salesChanges = !!sales && ((sales.clear && currentSales !== null) || (!sales.clear && currentSales !== sales.cents));
  const costMissing = !currentCost || currentCost.status === 'missing' || currentCost.cost_cents === null;
  const costChanges = !!cost && ((cost.clear && !costMissing) || (!cost.clear && (currentCost?.status === 'pending' || currentCostCents !== cost.cents)));
  if (!salesChanges && !costChanges) {
    return { ok: true, idempotent: false, productId, revision: state.catalog.revision, costRevision: state.book?.revision ?? 0, updatedAt: state.catalog.updated_at, costUpdatedAt: state.book?.updated_at ?? null, changes: 0, batchId: '' };
  }
  const now = new Date().toISOString();
  if (!state.costAvailable && salesChanges && !costChanges) {
    const nextProducts = state.products.map(item => item.id === productId ? { ...item, price: sales!.clear ? '' : formatCents(sales!.cents)! } : item);
    await writeCatalogOnly(db, JSON.stringify(nextProducts), state.catalog.revision + 1, now, state.catalog.revision);
    return { ok: true, idempotent: false, productId, revision: state.catalog.revision + 1, costRevision: 0, updatedAt: now, costUpdatedAt: null, changes: 1, batchId: '' };
  }
  const batchId = `b-${newId()}`;
  const nextProducts = salesChanges ? state.products.map(item => item.id === productId ? { ...item, price: sales!.clear ? '' : formatCents(sales!.cents)! } : item) : state.products;
  const json = salesChanges ? JSON.stringify(nextProducts) : state.catalog.products_json;
  const nextRevision = salesChanges ? state.catalog.revision + 1 : state.catalog.revision;
  const nextUpdated = salesChanges ? now : state.catalog.updated_at;
  const touchCost = costChanges;
  const nextCostRevision = touchCost && state.book ? state.book.revision + 1 : (state.book?.revision ?? 0);
  const result: WriteResult = { ok: true, idempotent: false, productId, revision: nextRevision, costRevision: nextCostRevision, updatedAt: nextUpdated, costUpdatedAt: touchCost ? now : state.book?.updated_at ?? null, changes: Number(salesChanges) + Number(costChanges), batchId };
  const statements: Bound[] = [];
  if (salesChanges) statements.push(catalogWrite(db, json, nextRevision, now, state.catalog.revision));
  if (touchCost && state.book && cost) {
    statements.push(bookWrite(db, nextCostRevision, now, input.requestId, state.book.revision));
    statements.push(costWrite(db, productId, cost.clear ? null : cost.cents, specFingerprint(product.specification, product.unit), cost.clear ? 'missing' : 'confirmed', now, actor.userId, batchId));
  }
  if (salesChanges && state.costAvailable) statements.push(metaWrite(db, productId, now, actor.userId));
  statements.push(guardWrite(db, {
    requestId: input.requestId, batchId, actor: actor.userId, now, source: 'price', productIds: [productId],
    before: { hash, sales: formatCents(currentSales), cost: formatCents(currentCost?.cost_cents ?? null) },
    after: { sales: salesChanges ? (sales!.clear ? null : formatCents(sales!.cents)) : formatCents(currentSales), cost: costChanges ? (cost!.clear ? null : formatCents(cost!.cents)) : formatCents(currentCost?.cost_cents ?? null) },
    result, catalog: { revision: nextRevision, updatedAt: nextUpdated, json },
    cost: state.costAvailable && state.book ? { revision: nextCostRevision, requestId: touchCost ? input.requestId : state.book.last_request_id } : null,
  }));
  try { await db.batch(statements); return result; }
  catch { return recover(db, input.requestId, hash); }
}

export async function applyMaster(db: PriceDatabase, actor: AccountUser, input: { expectedActorId: string; catalogRevision: number; costRevision: number; products: Product[]; requestId?: string }): Promise<WriteResult> {
  assertActor(actor, input.expectedActorId);
  if (!actor.canEditMaster) throw new PriceError('当前账号不能修改或删除已有商品资料。', 403);
  const products = validateCatalog(input.products);
  const state = await load(db);
  const currentRevision = state.catalog?.revision ?? 0;
  if (input.catalogRevision !== currentRevision) throw conflict('另一台设备已更新商品库。请先同步最新数据，再重新保存；当前编辑内容仍保留。');
  const invalidated = products.flatMap(next => {
    const prev = state.products.find(item => item.id === next.id);
    if (!prev || specFingerprint(prev.specification, prev.unit) === specFingerprint(next.specification, next.unit)) return [];
    const cost = costOf(state.costs, next.id);
    return cost && cost.status === 'confirmed' && cost.cost_cents !== null ? [next.id] : [];
  });
  if (invalidated.length && state.costAvailable && state.book && input.costRevision !== state.book.revision) throw conflict('成本版本已变化，规格变更没有写入。');
  const now = new Date().toISOString();
  const json = JSON.stringify(products);
  const nextRevision = currentRevision + 1;
  const batchId = `b-${newId()}`;
  const requestId = input.requestId && REQUEST_ID.test(input.requestId) ? input.requestId : `master-${batchId}`;
  const canInvalidate = invalidated.length > 0 && state.costAvailable && !!state.book;
  const nextCostRevision = canInvalidate && state.book ? state.book.revision + 1 : (state.book?.revision ?? 0);
  const warning = invalidated.length && !state.costAvailable ? '成本价加载失败，商品资料已保存，但未能把旧成本标为待确认。' : undefined;
  if (!state.costAvailable) {
    await writeCatalogOnly(db, json, nextRevision, now, state.catalog ? currentRevision : null);
    return { ok: true, idempotent: false, revision: nextRevision, costRevision: 0, updatedAt: now, costUpdatedAt: null, changes: 1, batchId, costWarning: warning };
  }
  const result: WriteResult = { ok: true, idempotent: false, revision: nextRevision, costRevision: nextCostRevision, updatedAt: now, costUpdatedAt: canInvalidate ? now : state.book?.updated_at ?? null, changes: 1, batchId, costWarning: warning };
  const statements: Bound[] = [catalogWrite(db, json, nextRevision, now, state.catalog ? currentRevision : null)];
  if (canInvalidate && state.book) {
    statements.push(bookWrite(db, nextCostRevision, now, requestId, state.book.revision));
    for (const id of invalidated) {
      const next = products.find(item => item.id === id)!;
      const cost = costOf(state.costs, id)!;
      statements.push(costWrite(db, id, cost.cost_cents, specFingerprint(next.specification, next.unit), 'pending', now, actor.userId, batchId));
    }
  }
  if (state.costAvailable) {
    for (const next of products) {
      const prev = state.products.find(item => item.id === next.id);
      if (prev && prev.price !== next.price) statements.push(metaWrite(db, next.id, now, actor.userId));
    }
  }
  statements.push(guardWrite(db, {
    requestId, batchId, actor: actor.userId, now, source: 'master', productIds: products.map(item => item.id),
    before: { revision: currentRevision, invalidated }, after: { revision: nextRevision }, result,
    catalog: { revision: nextRevision, updatedAt: now, json },
    cost: state.costAvailable && state.book ? { revision: nextCostRevision, requestId: canInvalidate ? requestId : state.book.last_request_id } : null,
  }));
  try { await db.batch(statements); return result; }
  catch { throw conflict('另一台设备已更新商品库。请先同步最新数据，再重新保存；当前编辑内容仍保留。'); }
}

export async function commitPrices(db: PriceDatabase, actor: AccountUser, input: {
  requestId: string; expectedActorId: string; catalogRevision: number; costRevision: number; target: PriceTarget; skipProblems: boolean;
  rows: { productId: string; sales?: PriceField; cost?: PriceField }[];
}): Promise<WriteResult> {
  assertActor(actor, input.expectedActorId);
  assertRequest(input.requestId);
  if (!['sales', 'cost', 'both'].includes(input.target)) throw new PriceError('请选择导入销售价、成本价或双价。', 400);
  const hash = await digest({ op: 'import', actor: actor.userId, target: input.target, rows: input.rows, skip: input.skipProblems });
  const replayed = await replay(db, input.requestId, hash);
  if (replayed) return replayed;
  const state = await load(db);
  if (!state.catalog) throw new PriceError('商品库不存在。', 404);
  if (input.catalogRevision !== state.catalog.revision || (state.book && input.costRevision !== state.book.revision)) throw conflict('版本已变化，请重新预览后再导入。');
  const wantsCost = input.rows.some(row => row.cost);
  if (wantsCost && !state.costAvailable) throw new PriceError('成本价加载失败，本次导入没有写入。', 503, { code: 'cost-unavailable' });
  const problems: string[] = [];
  const salesUpdates = new Map<string, { cents: number | null; clear: boolean }>();
  const costUpdates = new Map<string, { cents: number | null; clear: boolean }>();
  for (const row of input.rows) {
    const product = state.products.find(item => item.id === row.productId);
    if (!product) { problems.push(`${row.productId} 不存在`); continue; }
    if ((input.target === 'sales' && row.cost) || (input.target === 'cost' && row.sales)) { problems.push('导入目标与价格列不一致。'); continue; }
    try {
      const sales = input.target === 'cost' ? null : parseField(row.sales, '销售价');
      const cost = input.target === 'sales' ? null : parseField(row.cost, '成本价');
      if (sales) {
        const current = salesCents(product);
        if (sales.baseline !== current) problems.push(`${product.name} 的销售价已变化`);
        else if (sales.clear || current !== sales.cents) salesUpdates.set(product.id, { cents: sales.cents, clear: sales.clear });
      }
      if (cost) {
        const current = costOf(state.costs, product.id);
        const baseline = current && current.status !== 'missing' ? current.cost_cents : null;
        const comparable = current?.status === 'pending' ? current.cost_cents : baseline;
        if (cost.baseline !== comparable) problems.push(`${product.name} 的成本已变化`);
        else if (cost.clear || current?.status === 'pending' || comparable !== cost.cents) costUpdates.set(product.id, { cents: cost.cents, clear: cost.clear });
      }
    } catch (error) { problems.push(error instanceof Error ? error.message : '价格不正确'); }
  }
  if (problems.length && !input.skipProblems) throw new PriceError(`还有 ${problems.length} 行未处理，没有写入。`, 400, { problems });
  if (!salesUpdates.size && !costUpdates.size) {
    return { ok: true, idempotent: false, revision: state.catalog.revision, costRevision: state.book?.revision ?? 0, updatedAt: state.catalog.updated_at, costUpdatedAt: state.book?.updated_at ?? null, changes: 0, batchId: '' };
  }
  const now = new Date().toISOString();
  const batchId = `b-${newId()}`;
  const nextProducts = state.products.map(product => salesUpdates.has(product.id) ? { ...product, price: salesUpdates.get(product.id)!.clear ? '' : formatCents(salesUpdates.get(product.id)!.cents)! } : product);
  const salesTouched = salesUpdates.size > 0;
  const costTouched = costUpdates.size > 0;
  const json = salesTouched ? JSON.stringify(nextProducts) : state.catalog.products_json;
  const nextRevision = salesTouched ? state.catalog.revision + 1 : state.catalog.revision;
  const nextUpdated = salesTouched ? now : state.catalog.updated_at;
  const nextCostRevision = costTouched && state.book ? state.book.revision + 1 : (state.book?.revision ?? 0);
  const changes = salesUpdates.size + costUpdates.size;
  const result: WriteResult = { ok: true, idempotent: false, revision: nextRevision, costRevision: nextCostRevision, updatedAt: nextUpdated, costUpdatedAt: costTouched ? now : state.book?.updated_at ?? null, changes, batchId };
  const statements: Bound[] = [];
  if (salesTouched) statements.push(catalogWrite(db, json, nextRevision, now, state.catalog.revision));
  if (costTouched && state.book) statements.push(bookWrite(db, nextCostRevision, now, input.requestId, state.book.revision));
  for (const [id, update] of costUpdates) {
    const product = state.products.find(item => item.id === id)!;
    statements.push(costWrite(db, id, update.clear ? null : update.cents, specFingerprint(product.specification, product.unit), update.clear ? 'missing' : 'confirmed', now, actor.userId, batchId));
  }
  if (state.costAvailable) for (const id of salesUpdates.keys()) statements.push(metaWrite(db, id, now, actor.userId));
  statements.push(guardWrite(db, {
    requestId: input.requestId, batchId, actor: actor.userId, now, source: 'import', productIds: [...new Set([...salesUpdates.keys(), ...costUpdates.keys()])],
    before: { hash }, after: { sales: salesUpdates.size, cost: costUpdates.size }, result,
    catalog: { revision: nextRevision, updatedAt: nextUpdated, json },
    cost: state.costAvailable && state.book ? { revision: nextCostRevision, requestId: costTouched ? input.requestId : state.book.last_request_id } : null,
  }));
  try { await db.batch(statements); return result; }
  catch { return recover(db, input.requestId, hash); }
}
