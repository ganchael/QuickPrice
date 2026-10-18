import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { accountById, loginDecision } from '../lib/accounts.ts';
import { acceptLateResponse, compareUnit, comparisonCsv, comparisonStatusLabel, formatCents, mapPriceHeaders, nextQueueId, parseCsv, planAccountSwitch, previewPriceRows, PRICE_SYNC_INTERVAL_MS, priceTemplateCsv, rowsFromMatrix, specFingerprint } from '../lib/price-domain.ts';
import { clearManualRate, MANUAL_RATE_KEY, manualRateStorageKey, readManualRate, writeManualRate } from '../lib/manual-rate.ts';
import { lineSnapshot, parseQuote, quoteCsv, quoteText, summarize } from '../lib/pricing.ts';
import { quoteFilename } from '../lib/quote-export.ts';
import { applyMaster, commitPrices, createProduct, patchPrices, readComparison, readShared } from '../lib/price-store.ts';

const salesUser = { userId: 'account:888', displayName: '888', priceType: 'sales', canEditMaster: true };
const costUser = { userId: 'account:111', displayName: '111', priceType: 'cost', canEditMaster: false };
const updatedAt = '2026-01-01T00:00:00.000Z';
let request = 0;
const req = () => `req-${String(++request).padStart(8, '0')}`;

function adapt(db) {
  return {
    raw: db,
    exec(sql) { db.exec(sql); },
    prepare(sql) {
      return { bind(...params) {
        return {
          __sql: sql, __params: params,
          async first() { return db.prepare(sql).get(...params) ?? null; },
          async all() { return { results: db.prepare(sql).all(...params) }; },
          async run() { return { meta: { changes: Number(db.prepare(sql).run(...params).changes) } }; },
        };
      } };
    },
    async batch(statements) {
      db.exec('BEGIN');
      try {
        for (const statement of statements) db.prepare(statement.__sql).run(...statement.__params);
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
  };
}
function catalogTable(db) {
  db.exec(`CREATE TABLE catalogs (user_id TEXT PRIMARY KEY NOT NULL, products_json TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL)`);
}
function migrate(db) {
  db.exec(readFileSync(new URL('../drizzle/0004_cost_prices.sql', import.meta.url), 'utf8'));
}
function openDb() {
  const db = new DatabaseSync(':memory:');
  catalogTable(db);
  migrate(db);
  return adapt(db);
}
function putCatalog(db, products, revision = 4) {
  db.raw.prepare('INSERT INTO catalogs (user_id, products_json, revision, updated_at) VALUES (?, ?, ?, ?)').run('account:888', JSON.stringify(products), revision, updatedAt);
}
const item = (id, extra = {}) => ({ id, shortName: extra.shortName ?? id, name: extra.name ?? `商品${id}`, specification: extra.specification ?? '5mg', unit: extra.unit ?? '盒', category: '测试', price: extra.price ?? '10.00', aliases: extra.aliases ?? [] });

test('A01 migration keeps the shared sales catalog and does not seed costs', () => {
  const db = new DatabaseSync(':memory:');
  catalogTable(db);
  const products = [item('keep-1', { price: '75.50' }), item('keep-2', { price: '0.00' })];
  db.prepare('INSERT INTO catalogs (user_id, products_json, revision, updated_at) VALUES (?, ?, ?, ?)').run('account:888', JSON.stringify(products), 8, updatedAt);
  const before = db.prepare('SELECT products_json, revision, updated_at FROM catalogs').get();
  migrate(db); migrate(db);
  const after = db.prepare('SELECT products_json, revision, updated_at FROM catalogs').get();
  assert.deepEqual(after, before);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM product_cost_prices').get().n, 0);
  assert.equal(db.prepare('SELECT revision FROM cost_price_book_state').get().revision, 0);
});

test('A02 login decisions and unknown sessions', () => {
  assert.equal(loginDecision('888', true, true), 'ok');
  assert.equal(loginDecision('111', true, true), 'ok');
  assert.equal(loginDecision('888', true, false), 'bad');
  assert.equal(loginDecision('111', true, false), 'bad');
  assert.equal(loginDecision('111', false, false), 'unconfigured');
  assert.equal(loginDecision('stranger', false, true), 'unknown');
  assert.equal(accountById('account:888')?.priceType, 'sales');
  assert.equal(accountById('account:111')?.priceType, 'cost');
  assert.equal(accountById('account:other'), null);
  assert.match(readFileSync(new URL('../app/account-auth.ts', import.meta.url), 'utf8'), /expires_at > \?/);
});

test('A03 missing costs stay blank for both accounts', async () => {
  const db = openDb();
  putCatalog(db, [item('a', { price: '18.00' }), item('b', { price: '0.00' })]);
  const asSales = await readShared(db, salesUser);
  const asCost = await readShared(db, costUser);
  assert.deepEqual(asCost.products.map(p => p.id), asSales.products.map(p => p.id));
  assert.ok(asCost.products.every(p => p.costStatus === 'missing' && p.costPrice === null && p.price === ''));
  assert.equal(asCost.products[0].salesPrice, '18.00');
  assert.notEqual(asCost.products[0].costPrice, asCost.products[0].salesPrice);
  const lines = parseQuote('商品a × 2', asCost.products, { priceType: 'cost' });
  assert.equal(summarize(lines).pending, 1);
  assert.equal(summarize(lines).cents, 0);
});

test('A04 A05 shared price edits and rename keep the other price', async () => {
  const db = openDb();
  putCatalog(db, [item('a', { price: '10.00' })]);
  const first = await readShared(db, salesUser);
  const costWrite = await patchPrices(db, costUser, 'a', { requestId: req(), expectedActorId: costUser.userId, catalogRevision: first.revision, costRevision: first.costRevision, seenFingerprint: first.products[0].specFingerprint, cost: { amount: '4.50', baseline: null } });
  const afterCost = await readShared(db, salesUser);
  assert.equal(afterCost.products[0].costPrice, '4.50');
  assert.equal(afterCost.products[0].salesPrice, '10.00');
  assert.equal(afterCost.revision, first.revision);
  assert.equal(afterCost.updatedAt, updatedAt);
  assert.equal(costWrite.costRevision, first.costRevision + 1);
  await patchPrices(db, salesUser, 'a', { requestId: req(), expectedActorId: salesUser.userId, catalogRevision: afterCost.revision, costRevision: afterCost.costRevision, sales: { amount: '12.00', baseline: 1000 } });
  const renamed = (await readShared(db, costUser)).products[0];
  assert.equal(renamed.salesPrice, '12.00');
  assert.equal(renamed.costPrice, '4.50');
  const master = await readShared(db, salesUser);
  await applyMaster(db, salesUser, { expectedActorId: salesUser.userId, catalogRevision: master.revision, costRevision: master.costRevision, products: [{ ...item('a', { price: '12.00', name: '新名称' }) }] });
  const named = await readShared(db, costUser);
  assert.equal(named.products[0].name, '新名称');
  assert.equal(named.products[0].costPrice, '4.50');
  assert.equal(named.products[0].costStatus, 'confirmed');
});

test('A06 spec change, reconfirm, delete and recreate do not revive cost', async () => {
  const db = openDb();
  putCatalog(db, [item('a', { price: '10.00', specification: '5mg', unit: '瓶' })]);
  let state = await readShared(db, salesUser);
  await patchPrices(db, salesUser, 'a', { requestId: req(), expectedActorId: salesUser.userId, catalogRevision: state.revision, costRevision: state.costRevision, seenFingerprint: state.products[0].specFingerprint, cost: { amount: '3.00', baseline: null } });
  state = await readShared(db, salesUser);
  await applyMaster(db, salesUser, { expectedActorId: salesUser.userId, catalogRevision: state.revision, costRevision: state.costRevision, products: [item('a', { price: '10.00', specification: '10mg', unit: '盒' })] });
  state = await readShared(db, costUser);
  assert.equal(state.products[0].costStatus, 'pending');
  assert.ok(state.costRevision > 0);
  await patchPrices(db, costUser, 'a', { requestId: req(), expectedActorId: costUser.userId, catalogRevision: state.revision, costRevision: state.costRevision, seenFingerprint: state.products[0].specFingerprint, cost: { amount: '3.00', baseline: 300 } });
  state = await readShared(db, salesUser);
  assert.equal(state.products[0].costStatus, 'confirmed');
  await applyMaster(db, salesUser, { expectedActorId: salesUser.userId, catalogRevision: state.revision, costRevision: state.costRevision, products: [] });
  state = await readShared(db, costUser);
  assert.equal(state.products.length, 0);
  assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM product_cost_prices').get().n, 1);
  const created = await createProduct(db, costUser, { requestId: req(), expectedActorId: costUser.userId, catalogRevision: state.revision, costRevision: state.costRevision, product: { shortName: 'a', name: '商品a', specification: '10mg', unit: '盒', category: '测试' }, salesPrice: '', costPrice: '' });
  state = await readShared(db, salesUser);
  assert.notEqual(created.productId, 'a');
  assert.equal(state.products[0].costStatus, 'missing');
  assert.equal(state.products[0].salesPrice, null);
});

test('A07 A08 A09 A10 price import mapping, matches, blanks and conflicts', () => {
  const products = [
    { id: 'bt', shortName: 'BT10', name: 'TB500', specification: '10mg×10瓶', unit: '盒', aliases: ['别名'], salesCents: 20000, costCents: 1000, costStatus: 'confirmed' },
    { id: 'tb', shortName: 'TB10(BT)', name: 'TB500', specification: '10mg×10瓶', unit: '盒', aliases: [], salesCents: 18000, costCents: null, costStatus: 'missing' },
    { id: 'other', shortName: 'OT', name: '其他', specification: '1mg', unit: '瓶', aliases: [], salesCents: null, costCents: 100, costStatus: 'confirmed' },
  ];
  assert.equal(mapPriceHeaders(['商品ID', '成本价（元）', '销售价（元）'], 'both').fields.cost !== mapPriceHeaders(['商品ID', '成本价（元）', '销售价（元）'], 'both').fields.sales, true);
  assert.ok(mapPriceHeaders(['价格'], 'both').error);
  assert.equal(mapPriceHeaders(['价格'], 'cost').fields.cost, 0);
  const headers = ['商品ID', '简称', '产品名称', '规格', '单位', '销售价（元）', '成本价（元）', '币种'];
  const matrix = [headers, ['bt', 'BT10', 'TB500', '10mg×10瓶', '盒', '', '8.00', 'CNY'], ['missing', 'BT10', 'TB500', '10mg×10瓶', '盒', '1', '1', 'CNY'], ['', 'TB500', '', '10mg×10瓶', '盒', '', '9', ''], ['', 'BT10', 'TB500', '10mg×10瓶', '瓶', '', '7', 'USD'], ['', '', '其他', '1mg', '瓶', '', '', ''], ['nope', '', '', '', '', '', '-1', '']];
  const parsed = rowsFromMatrix(matrix, 'both');
  const preview = previewPriceRows(products, parsed.rows, 'both');
  assert.equal(preview.find(row => row.row === 2).status, 'ready');
  assert.equal(preview.find(row => row.row === 2).writeSales, false);
  assert.equal(preview.find(row => row.row === 3).status, 'review');
  assert.equal(preview.find(row => row.row === 4).status, 'unmatched');
  assert.equal(preview.find(row => row.row === 5).status, 'invalid');
  assert.equal(preview.find(row => row.row === 6).status, 'skip');
  assert.equal(preview.find(row => row.row === 7).status, 'review');
  const dupes = previewPriceRows(products, [
    { sheet: 'S', row: 2, productId: 'bt', costRaw: '1.00' },
    { sheet: 'S', row: 3, productId: 'bt', costRaw: '2.00' },
    { sheet: 'S', row: 4, productId: 'other', costRaw: '5.00' },
    { sheet: 'S', row: 5, productId: 'other', costRaw: '5.00' },
  ], 'cost');
  assert.equal(dupes.filter(row => row.productId === 'bt' && row.status === 'conflict').length, 2);
  assert.equal(dupes.filter(row => row.status === 'ready').length, 1);
  assert.equal(previewPriceRows(products, [{ sheet: 'S', row: 1, shortName: 'BT10', specification: '10mg×10瓶', unit: '盒', costRaw: '0' }], 'cost')[0].cost.zero, true);
  for (const bad of ['-1', '1000000', '1.234']) assert.equal(previewPriceRows(products, [{ sheet: 'S', row: 1, productId: 'bt', costRaw: bad }], 'cost')[0].status, 'invalid');
  const template = priceTemplateCsv(products, 'cost', false);
  assert.match(template, /成本价/);
  assert.doesNotMatch(parseCsv(template)[1].join(','), /200\.00|18\.00/);
  const withCost = parseCsv(priceTemplateCsv(products, 'cost', true));
  assert.match(withCost[1].join(','), /10\.00/);
  assert.equal(specFingerprint('５ｍｇ', '盒'), specFingerprint('5mg', '盒'));
  assert.notEqual(specFingerprint('5mg', '瓶'), specFingerprint('5mg', '盒'));
});

test('A11 A12 A27 A28 A29 revisions, permissions and idempotent creates', async () => {
  const db = openDb();
  putCatalog(db, [item('a', { price: '10.00' })]);
  let state = await readShared(db, salesUser);
  await patchPrices(db, costUser, 'a', { requestId: req(), expectedActorId: costUser.userId, catalogRevision: state.revision, costRevision: state.costRevision, seenFingerprint: state.products[0].specFingerprint, cost: { amount: '5.00', baseline: null } });
  state = await readShared(db, salesUser);
  await assert.rejects(() => patchPrices(db, salesUser, 'a', { requestId: req(), expectedActorId: salesUser.userId, catalogRevision: state.revision, costRevision: state.costRevision, sales: { amount: '11.00', baseline: 999 } }), /核对/);
  assert.equal((await readShared(db, salesUser)).products[0].salesPrice, '10.00');
  const salesOnly = await patchPrices(db, salesUser, 'a', { requestId: req(), expectedActorId: salesUser.userId, catalogRevision: state.revision, costRevision: state.costRevision, sales: { amount: '11.00', baseline: 1000 } });
  await assert.rejects(() => patchPrices(db, costUser, 'a', { requestId: req(), expectedActorId: costUser.userId, catalogRevision: state.revision, costRevision: state.costRevision, seenFingerprint: state.products[0].specFingerprint, cost: { amount: '6.00', baseline: 500 } }), /版本|核对/);
  const retried = await patchPrices(db, costUser, 'a', { requestId: req(), expectedActorId: costUser.userId, catalogRevision: salesOnly.revision, costRevision: state.costRevision, seenFingerprint: state.products[0].specFingerprint, cost: { amount: '6.00', baseline: 500 } });
  state = await readShared(db, salesUser);
  assert.equal(state.products[0].salesPrice, '11.00');
  assert.equal(state.products[0].costPrice, '6.00');
  await assert.rejects(() => patchPrices(db, salesUser, 'a', { requestId: req(), expectedActorId: salesUser.userId, catalogRevision: retried.revision, costRevision: 0, seenFingerprint: state.products[0].specFingerprint, sales: { amount: '12.00', baseline: 1100 }, cost: { amount: '7.00', baseline: 500 } }), /版本|核对/);
  state = await readShared(db, costUser);
  assert.equal(state.products[0].salesPrice, '11.00');
  assert.equal(state.products[0].costPrice, '6.00');
  await assert.rejects(() => applyMaster(db, costUser, { expectedActorId: costUser.userId, catalogRevision: state.revision, costRevision: state.costRevision, products: [] }), /不能修改或删除/);
  await assert.rejects(() => patchPrices(db, costUser, 'a', { requestId: req(), expectedActorId: costUser.userId, catalogRevision: state.revision, costRevision: state.costRevision, name: '改名' }), /商品资料/);
  const body = { shortName: 'NX', name: '并发新品', specification: '1mg', unit: '盒', category: '测试' };
  const firstRequest = req();
  const secondRequest = req();
  const [winner, loser] = await Promise.allSettled([
    createProduct(db, salesUser, { requestId: firstRequest, expectedActorId: salesUser.userId, catalogRevision: state.revision, costRevision: state.costRevision, product: body, salesPrice: '9.00', costPrice: '4.00' }),
    createProduct(db, costUser, { requestId: secondRequest, expectedActorId: costUser.userId, catalogRevision: state.revision, costRevision: state.costRevision, product: body, salesPrice: '9.00', costPrice: '4.00' }),
  ]);
  const ok = [winner, loser].find(item => item.status === 'fulfilled');
  const rejected = [winner, loser].find(item => item.status === 'rejected');
  assert.ok(ok && rejected);
  assert.match(rejected.reason.message, /已存在|版本|核对/);
  state = await readShared(db, costUser);
  const created = state.products.find(product => product.shortName === 'NX');
  assert.ok(created);
  assert.equal(state.products.filter(product => product.shortName === 'NX').length, 1);
  assert.equal(created.salesPrice, '9.00');
  assert.equal(created.costPrice, '4.00');
  const winningRequest = winner.status === 'fulfilled' ? firstRequest : secondRequest;
  const winningActor = winner.status === 'fulfilled' ? salesUser : costUser;
  const again = await createProduct(db, winningActor, { requestId: winningRequest, expectedActorId: winningActor.userId, catalogRevision: state.revision, costRevision: state.costRevision, product: body, salesPrice: '9.00', costPrice: '4.00' });
  assert.equal(again.productId, created.id);
  assert.equal((await readShared(db, salesUser)).products.filter(product => product.shortName === 'NX').length, 1);
  const zero = await createProduct(db, salesUser, { requestId: req(), expectedActorId: salesUser.userId, catalogRevision: (await readShared(db, salesUser)).revision, costRevision: (await readShared(db, salesUser)).costRevision, product: { shortName: 'Z', name: '零元', specification: '1mg', unit: '盒', category: '测试' }, salesPrice: '0', costPrice: '' });
  const blank = await createProduct(db, costUser, { requestId: req(), expectedActorId: costUser.userId, catalogRevision: zero.revision, costRevision: zero.costRevision, product: { shortName: 'B', name: '留空', specification: '1mg', unit: '盒', category: '测试' }, salesPrice: '', costPrice: '' });
  state = await readShared(db, salesUser);
  assert.equal(state.products.find(product => product.id === zero.productId).salesPrice, '0.00');
  assert.equal(state.products.find(product => product.id === blank.productId).salesPrice, null);
  assert.equal(state.products.find(product => product.id === blank.productId).costStatus, 'missing');
  const beforeFailed = state.products.length;
  await assert.rejects(() => createProduct(db, salesUser, { requestId: req(), expectedActorId: salesUser.userId, catalogRevision: state.revision, costRevision: state.costRevision, product: { shortName: 'BAD', name: '坏价格', specification: '1', unit: '盒', category: '测试' }, salesPrice: '1.00', costPrice: '-2' }));
  assert.equal((await readShared(db, salesUser)).products.length, beforeFailed);
});

test('A13 A16 A17 A18 A20 A22 A23 A26 quote type, snapshots, rates and switch plan', () => {
  const product = { id: 'pep', shortName: '甲', name: '多肽甲', specification: '5mg', unit: '瓶', category: '测试', price: '75.50', aliases: [], salesPrice: '75.50', costPrice: '40.00', costStatus: 'confirmed' };
  const salesLine = parseQuote('多肽甲 × 2', [product], { priceType: 'sales' })[0];
  const costLine = parseQuote('多肽甲 × 2', [product], { priceType: 'cost' })[0];
  assert.equal(salesLine.price, '75.50');
  assert.equal(costLine.price, '40.00');
  assert.equal(salesLine.snapshot.unit, '瓶');
  product.unit = '盒'; product.price = '1.00'; product.salesPrice = '1.00';
  const salesText = quoteText([salesLine], [product], '7.2', '手动设置', { priceType: 'sales' });
  const salesCsv = quoteCsv([salesLine], [product], '7.2', '手动设置', { priceType: 'sales' });
  assert.match(salesText, /多肽报价清单/);
  assert.match(salesText, /20\.98/);
  assert.match(salesCsv, /10\.49/);
  assert.match(salesCsv, /20\.98/);
  assert.doesNotMatch(salesCsv, /成本/);
  assert.match(quoteText([costLine], [product], '7.2', '手动设置', { priceType: 'cost' }), /内部成本清单/);
  assert.match(quoteCsv([costLine], [product], '7.2', '手动设置', { priceType: 'cost' }), /成本单价/);
  assert.match(quoteFilename(new Date(2026, 0, 2, 3, 4), 'cost'), /^内部成本清单_2026年01月02日_03时04分\.csv$/);
  assert.match(quoteFilename(new Date(2026, 0, 2, 3, 4), 'comparison'), /^内部售价成本对比_/);
  const changed = { ...salesLine, snapshot: { ...salesLine.snapshot, unit: '瓶' } };
  assert.match(quoteCsv([changed], [product]), /瓶/);
  assert.doesNotMatch(quoteCsv([changed], [product]), /盒/);
  const incomplete = { ...salesLine, snapshot: null };
  assert.equal(summarize([incomplete]).pending, 1);
  assert.throws(() => quoteText([salesLine, costLine], [product], '7.2', '手动', { priceType: 'sales' }), /混用/);
  const manual = { ...salesLine, price: '80.00', manualPrice: true };
  assert.match(quoteText([manual], [product]), /80\.00/);
  assert.deepEqual(lineSnapshot(product, 'sales').priceType, 'sales');
  const store = new Map();
  const memory = { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, String(value)), removeItem: key => store.delete(key) };
  memory.setItem(MANUAL_RATE_KEY, '7.2');
  assert.equal(readManualRate(memory, 'account:111'), null);
  assert.equal(memory.getItem(MANUAL_RATE_KEY), '7.2');
  assert.equal(readManualRate(memory, 'account:888'), '7.2');
  assert.equal(memory.getItem(MANUAL_RATE_KEY), null);
  writeManualRate('6.5', memory, 'account:111');
  assert.equal(readManualRate(memory, 'account:888'), '7.2');
  assert.equal(readManualRate(memory, 'account:111'), '6.5');
  clearManualRate(memory, 'account:111');
  assert.equal(readManualRate(memory, 'account:888'), '7.2');
  assert.equal(manualRateStorageKey('account:888').includes('account:888'), true);
  assert.equal(planAccountSwitch({ hasQuote: true, quoteConfirmed: false, draftDirty: false, draftChoice: 'none', saveOk: null, password: 'none', liveActor: 'account:888', previousActor: 'account:888', targetActor: 'account:111' }).clearLocal, false);
  assert.equal(planAccountSwitch({ hasQuote: true, quoteConfirmed: true, draftDirty: true, draftChoice: 'save', saveOk: false, password: 'none', liveActor: 'account:888', previousActor: 'account:888', targetActor: 'account:111' }).phase, 'stay');
  assert.equal(planAccountSwitch({ hasQuote: false, quoteConfirmed: true, draftDirty: false, draftChoice: 'none', saveOk: null, password: 'bad', liveActor: 'account:888', previousActor: 'account:888', targetActor: 'account:111' }).phase, 'stay');
  assert.equal(planAccountSwitch({ hasQuote: true, quoteConfirmed: true, draftDirty: true, draftChoice: 'discard', saveOk: null, password: 'ok', liveActor: 'account:111', previousActor: 'account:888', targetActor: 'account:111' }).clearLocal, true);
  assert.equal(planAccountSwitch({ hasQuote: true, quoteConfirmed: true, draftDirty: false, draftChoice: 'none', saveOk: null, password: 'lost', liveActor: 'account:111', previousActor: 'account:888', targetActor: 'account:111' }).phase, 'reload');
  assert.equal(planAccountSwitch({ hasQuote: true, quoteConfirmed: true, draftDirty: false, draftChoice: 'none', saveOk: null, password: 'lost', liveActor: 'account:888', previousActor: 'account:888', targetActor: 'account:111' }).clearLocal, false);
  assert.equal(acceptLateResponse({ epoch: 1, currentEpoch: 2, actorId: 'account:888', expectedActorId: 'account:888', visible: true }), false);
  assert.equal(PRICE_SYNC_INTERVAL_MS <= 30000, true);
  const app = readFileSync(new URL('../app/quickprice-app.tsx', import.meta.url), 'utf8');
  const catalog = readFileSync(new URL('../components/catalog-manager.tsx', import.meta.url), 'utf8');
  assert.match(app, /切换账号/);
  assert.match(app, /复制报价/);
  assert.match(app, /导出报价/);
  assert.match(app, /恢复自动/);
  assert.match(app, /inputMode="numeric"/);
  assert.match(app, /inputMode="decimal"/);
  assert.match(catalog, /清空成本/);
  assert.match(catalog, /删除商品/);
  assert.match(catalog, /保存并下一条/);
  assert.match(readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8'), /z-index: 41/);
});

test('A14 A15 comparison math, blanks and internal csv', () => {
  const low = compareUnit(20000, 12000, 'confirmed');
  const high = compareUnit(20000, 22000, 'confirmed');
  const free = compareUnit(0, 5000, 'confirmed');
  assert.equal(formatCents(low.diffCents), '80.00');
  assert.equal(low.rate, '40.00');
  assert.equal(formatCents(high.diffCents), '-20.00');
  assert.equal(high.rate, '-10.00');
  assert.equal(high.aboveSales, true);
  assert.equal(formatCents(free.diffCents), '-50.00');
  assert.equal(free.rate, null);
  for (const row of [compareUnit(null, 100, 'confirmed'), compareUnit(100, null, 'missing'), compareUnit(100, 100, 'pending')]) {
    assert.equal(row.diffCents, null);
    assert.equal(row.rate, null);
  }
  const zeroCost = compareUnit(1000, 0, 'confirmed');
  assert.equal(zeroCost.diffCents, 1000);
  assert.notEqual(comparisonStatusLabel(zeroCost), comparisonStatusLabel(compareUnit(1000, null, 'missing')));
  const csv = comparisonCsv([{ id: '=1', shortName: '甲', name: '商品', specification: '5mg', unit: '盒', sales: null, cost: '0.00', diff: null, rate: null, status: '缺销售价', updatedAt: updatedAt }]);
  assert.ok(csv.startsWith('\uFEFF'));
  assert.match(csv, /'=1/);
  assert.match(csv, /缺销售价/);
  assert.match(csv, /2026-01-01T00:00:00\.000Z/);
});

test('A21 cost failure does not block sales, and migration rollback keeps the catalog', async () => {
  const bare = adapt(new DatabaseSync(':memory:'));
  catalogTable(bare.raw);
  putCatalog(bare, [item('a', { price: '10.00' })]);
  const readable = await readShared(bare, salesUser);
  assert.equal(readable.costAvailable, false);
  assert.equal(readable.products[0].costStatus, 'error');
  assert.equal(readable.products[0].salesPrice, '10.00');
  const saved = await patchPrices(bare, salesUser, 'a', { requestId: req(), expectedActorId: salesUser.userId, catalogRevision: readable.revision, costRevision: 0, sales: { amount: '12.00', baseline: 1000 } });
  assert.equal((await readShared(bare, salesUser)).products[0].salesPrice, '12.00');
  assert.equal(saved.revision, readable.revision + 1);
  await assert.rejects(() => createProduct(bare, salesUser, { requestId: req(), expectedActorId: salesUser.userId, catalogRevision: saved.revision, costRevision: 0, product: { shortName: 'C', name: '带成本', specification: '1', unit: '盒', category: '测试' }, salesPrice: '1', costPrice: '1' }), /没有写入/);
  assert.equal((await readShared(bare, salesUser)).products.length, 1);
  const db = new DatabaseSync(':memory:');
  catalogTable(db);
  db.prepare('INSERT INTO catalogs (user_id, products_json, revision, updated_at) VALUES (?, ?, ?, ?)').run('account:888', JSON.stringify([item('a')]), 2, updatedAt);
  migrate(db);
  db.prepare(`INSERT INTO product_cost_prices (catalog_id, product_id, cost_cents, spec_fingerprint, status, updated_at, updated_by) VALUES ('account:888', 'a', 250, 'fp', 'confirmed', ?, 'account:111')`).run(updatedAt);
  const before = db.prepare('SELECT products_json, revision, updated_at FROM catalogs').get();
  migrate(db);
  assert.deepEqual(db.prepare('SELECT products_json, revision, updated_at FROM catalogs').get(), before);
  assert.equal(db.prepare('SELECT cost_cents FROM product_cost_prices').get().cost_cents, 250);
  db.exec(readFileSync(new URL('../drizzle/0004_cost_prices_rollback.sql', import.meta.url), 'utf8'));
  assert.deepEqual(db.prepare('SELECT products_json, revision, updated_at FROM catalogs').get(), before);
  assert.throws(() => db.prepare('SELECT * FROM product_cost_prices').all());
});

test('cost read failure rejects specification, unit and deletion changes without blocking sales or rename', async () => {
  const db = openDb();
  const product = item('a', { specification: '5mg', unit: '瓶' });
  putCatalog(db, [product]);
  let state = await readShared(db, salesUser);
  await patchPrices(db, costUser, 'a', { requestId: req(), expectedActorId: costUser.userId, catalogRevision: state.revision, costRevision: state.costRevision, seenFingerprint: state.products[0].specFingerprint, cost: { amount: '3.00', baseline: null } });
  state = await readShared(db, salesUser);
  const failingDb = {
    ...db,
    prepare(sql) {
      if (sql.includes('FROM product_cost_prices')) throw new Error('temporary cost read failure');
      return db.prepare(sql);
    },
  };
  const before = {
    catalog: db.raw.prepare('SELECT * FROM catalogs').all(),
    costs: db.raw.prepare('SELECT * FROM product_cost_prices').all(),
    book: db.raw.prepare('SELECT * FROM cost_price_book_state').all(),
    batches: db.raw.prepare('SELECT * FROM price_change_batches').all(),
  };
  for (const products of [[{ ...product, specification: '10mg' }], [{ ...product, unit: '盒' }], []]) {
    await assert.rejects(() => applyMaster(failingDb, salesUser, { expectedActorId: salesUser.userId, catalogRevision: state.revision, costRevision: state.costRevision, products }), error => error.status === 503 && error.details.code === 'cost-unavailable' && /同步后重试/.test(error.message));
    assert.deepEqual(db.raw.prepare('SELECT * FROM catalogs').all(), before.catalog);
    assert.deepEqual(db.raw.prepare('SELECT * FROM product_cost_prices').all(), before.costs);
    assert.deepEqual(db.raw.prepare('SELECT * FROM cost_price_book_state').all(), before.book);
    assert.deepEqual(db.raw.prepare('SELECT * FROM price_change_batches').all(), before.batches);
  }
  const sales = await applyMaster(failingDb, salesUser, { expectedActorId: salesUser.userId, catalogRevision: state.revision, costRevision: state.costRevision, products: [{ ...product, price: '12.00' }] });
  assert.equal(sales.revision, state.revision + 1);
  const renamed = await applyMaster(failingDb, salesUser, { expectedActorId: salesUser.userId, catalogRevision: sales.revision, costRevision: state.costRevision, products: [{ ...product, price: '12.00', name: '新名称' }] });
  state = await readShared(db, costUser);
  assert.equal(state.revision, renamed.revision);
  assert.equal(state.products[0].salesPrice, '12.00');
  assert.equal(state.products[0].name, '新名称');
  assert.equal(state.products[0].costPrice, '3.00');
  assert.equal(state.products[0].costStatus, 'confirmed');
  assert.deepEqual(db.raw.prepare('SELECT * FROM product_cost_prices').all(), before.costs);
});

test('mismatched cost fingerprints stay pending and can be reconfirmed at the same price', async () => {
  const db = openDb();
  putCatalog(db, [item('a', { specification: '10mg', unit: '盒' })]);
  const oldFingerprint = specFingerprint('5mg', '瓶');
  db.raw.prepare('INSERT INTO product_cost_prices (catalog_id, product_id, cost_cents, spec_fingerprint, status, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?)').run('account:888', 'a', 300, oldFingerprint, 'confirmed', updatedAt, costUser.userId);
  let state = await readShared(db, costUser);
  assert.equal(state.products[0].costStatus, 'pending');
  assert.equal(state.products[0].costPrice, '3.00');
  assert.equal(state.products[0].price, '');
  const quote = parseQuote('商品a × 2', state.products, { priceType: 'cost' });
  assert.equal(summarize(quote).pending, 1);
  assert.equal(summarize(quote).cents, 0);
  const comparison = await readComparison(db, salesUser);
  assert.equal(comparison.rows[0].compared.diffCents, null);
  assert.equal(comparison.rows[0].compared.rate, null);
  await patchPrices(db, costUser, 'a', { requestId: req(), expectedActorId: costUser.userId, catalogRevision: state.revision, costRevision: state.costRevision, seenFingerprint: state.products[0].specFingerprint, cost: { amount: '3.00', baseline: 300 } });
  state = await readShared(db, costUser);
  assert.equal(state.products[0].costStatus, 'confirmed');
  assert.equal(state.products[0].price, '3.00');
  assert.equal(db.raw.prepare('SELECT spec_fingerprint FROM product_cost_prices').get().spec_fingerprint, state.products[0].specFingerprint);
  db.raw.prepare('UPDATE product_cost_prices SET spec_fingerprint = ?').run(oldFingerprint);
  state = await readShared(db, costUser);
  const imported = await commitPrices(db, costUser, { requestId: req(), expectedActorId: costUser.userId, catalogRevision: state.revision, costRevision: state.costRevision, target: 'cost', skipProblems: false, rows: [{ productId: 'a', cost: { amount: '3.00', baseline: 300 } }] });
  assert.equal(imported.changes, 1);
  state = await readShared(db, costUser);
  assert.equal(state.products[0].costStatus, 'confirmed');
  assert.equal(state.products[0].price, '3.00');
  assert.equal(db.raw.prepare('SELECT spec_fingerprint FROM product_cost_prices').get().spec_fingerprint, state.products[0].specFingerprint);
});

test('A24 A25 A30 A31 create, queues, sync interval and import cancel boundary', async () => {
  const db = openDb();
  putCatalog(db, [item('old', { price: '10.00' })], 2);
  let state = await readShared(db, salesUser);
  const created = await createProduct(db, salesUser, { requestId: req(), expectedActorId: salesUser.userId, catalogRevision: state.revision, costRevision: state.costRevision, product: { shortName: '新', name: '新品', specification: '2mg', unit: '盒', category: '测试' }, salesPrice: '8.00', costPrice: '3.00' });
  state = await readShared(db, costUser);
  const found = state.products.find(product => product.id === created.productId);
  assert.equal(found.salesPrice, '8.00');
  assert.equal(found.costPrice, '3.00');
  const partial = await createProduct(db, costUser, { requestId: req(), expectedActorId: costUser.userId, catalogRevision: state.revision, costRevision: state.costRevision, product: { shortName: '半', name: '半价', specification: '2mg', unit: '盒', category: '测试' }, salesPrice: '', costPrice: '1.50' });
  state = await readShared(db, salesUser);
  assert.equal(state.products.find(product => product.id === partial.productId).salesPrice, null);
  assert.equal(state.products.find(product => product.id === partial.productId).costPrice, '1.50');
  const queue = ['a', 'b', 'c'];
  assert.equal(nextQueueId(queue, 'a'), 'b');
  assert.equal(nextQueueId(queue.filter(id => id !== 'a'), 'b'), 'c');
  const versions = { revision: state.revision, costRevision: state.costRevision };
  await patchPrices(db, costUser, 'old', { requestId: req(), expectedActorId: costUser.userId, catalogRevision: state.revision, costRevision: state.costRevision, seenFingerprint: state.products.find(product => product.id === 'old').specFingerprint, cost: { amount: '2.00', baseline: null } });
  const seen = await readShared(db, salesUser);
  assert.notDeepEqual({ revision: seen.revision, costRevision: seen.costRevision }, versions);
  assert.equal(seen.products.find(product => product.id === 'old').costPrice, '2.00');
  assert.equal(PRICE_SYNC_INTERVAL_MS, 30000);
  const imported = await commitPrices(db, salesUser, { requestId: req(), expectedActorId: salesUser.userId, catalogRevision: seen.revision, costRevision: seen.costRevision, target: 'both', skipProblems: false, rows: [] });
  assert.equal(imported.changes, 0);
  assert.equal((await readShared(db, costUser)).products.find(product => product.id === 'old').salesPrice, '10.00');
  const requestId = req();
  const fresh = await readShared(db, salesUser);
  const importRows = [{ productId: 'old', cost: { amount: '2.50', baseline: 200 } }, { productId: 'missing', cost: { amount: '9', baseline: null } }];
  await commitPrices(db, costUser, { requestId, expectedActorId: costUser.userId, catalogRevision: fresh.revision, costRevision: fresh.costRevision, target: 'cost', skipProblems: true, rows: importRows });
  const finalState = await readShared(db, salesUser);
  assert.equal(finalState.products.find(product => product.id === 'old').costPrice, '2.50');
  assert.equal(finalState.products.find(product => product.id === created.productId).costPrice, '3.00');
  const replayed = await commitPrices(db, costUser, { requestId, expectedActorId: costUser.userId, catalogRevision: finalState.revision, costRevision: finalState.costRevision, target: 'cost', skipProblems: true, rows: importRows });
  assert.equal(replayed.idempotent, true);
});
