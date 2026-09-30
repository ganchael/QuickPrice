import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { utils, write } from 'xlsx';
import { importWorkbook } from '../lib/import-workbook.ts';
import { catalogKey, mergeCatalog, validateCatalog } from '../lib/catalog.ts';
import { parseQuote, searchProducts, quoteText, quoteCsv, summarize, productDisplayName, productSecondaryName, productLabel } from '../lib/pricing.ts';

function workbook(rows, merges = []) {
  const sheet = utils.aoa_to_sheet(rows); sheet['!merges'] = merges.map(utils.decode_range);
  const book = utils.book_new(); utils.book_append_sheet(book, sheet, '商品');
  return write(book, { type: 'array', bookType: 'xlsx' });
}
test('HTTP entry point imports products without secure-context randomUUID', (t) => {
  const descriptor = Object.getOwnPropertyDescriptor(crypto, 'randomUUID');
  Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: undefined });
  t.after(() => descriptor ? Object.defineProperty(crypto, 'randomUUID', descriptor) : delete crypto.randomUUID);
  assert.equal(crypto.randomUUID, undefined);
  const r = importWorkbook(workbook([['名称', '规格', '价格'], ['Test A', '5mg', 20], ['Test B', '10mg', 30]]));
  assert.equal(r.products.length, 2);
  assert.notEqual(r.products[0].id, r.products[1].id);
  assert.ok(r.products.every(p => /^import-[a-f0-9]{32}$/.test(p.id)));
});
test('parallel tables, merged names/codes, unmerged continuation and merged SKU extension', () => {
  const r = importWorkbook(workbook([
    ['九月价目表'], ['', '名称', '规格', '元/盒', '', '', '名称', '规格', '元/盒'],
    ['AX', 'Adamax', '5mg*10vials', 200, '', 'KP', 'KPV', '5mg*10vials', 70],
    ['', '', '10mg*10vials', 330, '', '', '', '10mg*10vials', 105],
    ['', 'New product', '1mg', 50, '', '', 'Orexin B', '5mg', 280],
    ['', '', '', '', '', '', '', '10mg', 530],
  ], ['A1:I1', 'A3:A4', 'B3:B4', 'C5:C6', 'D5:D6']));
  assert.equal(r.products.length, 7);
  assert.equal(r.products.find(p => p.name === 'Adamax' && p.price === '330.00').shortName, 'AX');
  assert.equal(r.products.find(p => p.name === 'New product').shortName, '');
  assert.equal(r.products.find(p => p.name === 'KPV' && p.price === '105.00').shortName, 'KP');
  assert.equal(r.products.filter(p => p.name === 'Orexin B').length, 2);
  assert.ok(r.products.every(p => p.unit === '盒'));
});
test('ordinary table imports explicit code, category, units and formatted prices', () => {
  const r = importWorkbook(workbook([['产品简称', '产品名称', '规格', '单价', '品类', '单位'], ['Z1', '测试产品', '20g', '￥1,250.50', '配件', '袋']]));
  assert.deepEqual({ ...r.products[0], id: '' }, { id: '', shortName: 'Z1', name: '测试产品', specification: '20g', price: '1250.50', category: '配件', unit: '袋', aliases: [] });
});
test('invalid prices remain unpriced and duplicate rows are reported', () => {
  const r = importWorkbook(workbook([['简称', '名称', '规格', '价格'], ['T1', '测试', '5mg', '询价'], ['T1', '测试', '5mg', 20]]));
  assert.equal(r.products.length, 1); assert.equal(r.products[0].price, ''); assert.equal(r.skipped, 1); assert.equal(r.issues.length, 2);
  assert.equal(summarize(parseQuote('T1×20', r.products)).pending, 1);
});
test('malformed comma prices are never silently inflated', () => {
  const r = importWorkbook(workbook([['简称', '名称', '规格', '价格'], ['A', 'Product A', '5mg', '12,50'], ['B', 'Product B', '5mg', '1,2,3'], ['C', 'Product C', '5mg', '1,250.50']]));
  assert.equal(r.products[0].price, ''); assert.equal(r.products[1].price, ''); assert.equal(r.products[2].price, '1250.50'); assert.equal(r.issues.length, 2);
});
test('repeat import updates stable IDs; distinct specifications remain distinct', () => {
  const r = importWorkbook(workbook([['简称', '名称', '规格', '价格'], ['T', 'Test', '5mg', 20], ['T', 'Test', '10mg', 30]]));
  const updated = r.products.map(p => ({ ...p, id: crypto.randomUUID(), price: '40.00', shortName: 'NEW' }));
  const m = mergeCatalog(r.products, updated);
  assert.equal(m.added, 0); assert.equal(m.updated, 2); assert.equal(m.products[0].id, r.products[0].id); assert.equal(m.products[1].price, '40.00');
  assert.throws(() => validateCatalog([...m.products, { ...m.products[0], id: crypto.randomUUID() }]));
});
test('different abbreviations preserve separate prices for identical names and specifications', () => {
  const incoming = importWorkbook(workbook([
    ['简称', '名称', '规格', '价格'],
    ['BT10', 'TB500', '10mg*10vials', 373],
    ['TB10(BT)', 'TB500', '10mg*10vials', 390],
  ]));
  assert.equal(incoming.products.length, 2);
  assert.equal(incoming.issues.length, 0);
  assert.equal(validateCatalog(incoming.products).length, 2);
  const old = { ...incoming.products[1], id: 'stable-tb', price: '400.00' };
  const first = mergeCatalog([old], incoming.products);
  assert.equal(first.added, 1);
  assert.equal(first.updated, 1);
  assert.equal(first.products.find(p => p.shortName === 'TB10(BT)').id, old.id);
  assert.deepEqual(first.products.map(p => p.price).sort(), ['373.00', '390.00']);
  const again = mergeCatalog(first.products, incoming.products.map(p => ({ ...p, id: crypto.randomUUID() })));
  assert.equal(again.added, 0);
  assert.deepEqual(again.products, first.products);
  assert.equal(summarize(parseQuote('TB500 10mg*10vials × 1', first.products)).pending, 1);
  assert.equal(summarize(parseQuote('BT10 × 1', first.products)).cents, 37300);
  assert.equal(summarize(parseQuote('TB10(BT) × 1', first.products)).cents, 39000);
});
test('short names and full names are both searchable, displayed in exports, and ambiguity is blocked', () => {
  const r = importWorkbook(workbook([['简称', '名称', '规格', '价格'], ['SM5', 'Semaglutide', '5mg', 105], ['SM10', 'Semaglutide', '10mg', 180], ['AX', 'Adamax', '5mg', 200], ['AX', 'Adamax', '10mg', 330], ['SX', 'Semax', '5mg', 80]]));
  assert.equal(searchProducts(r.products, 'sm5').length, 1); assert.equal(searchProducts(r.products, 'semaglutide').length, 2);
  assert.equal(summarize(parseQuote('SM5×20', r.products)).cents, 210000);
  assert.equal(summarize(parseQuote('Semax 20', r.products)).cents, 160000);
  assert.equal(summarize(parseQuote('Semaglutide×20', r.products)).pending, 1);
  assert.equal(summarize(parseQuote('AX×20', r.products)).pending, 1);
  const lines = parseQuote('Semaglutide 5mg×20', r.products);
  assert.equal(summarize(lines).cents, 210000);
  assert.match(quoteText(lines, r.products), /SM5 · Semaglutide · 5mg/);
  assert.match(quoteCsv(lines, r.products), /产品简称.*产品名称.*规格/);
});
test('rejects unsupported schema and malformed catalogue fields', () => {
  assert.throws(() => importWorkbook(workbook([['random'], ['not a catalog']])));
  assert.throws(() => validateCatalog([{ name: 'incomplete' } ]));
});
test('user reference: all 192 SKUs, 92 names, 39 blank abbreviations and exact box prices', { skip: !process.env.QUICKPRICE_REFERENCE_XLSX }, () => {
  const bytes = readFileSync(process.env.QUICKPRICE_REFERENCE_XLSX);
  const r = importWorkbook(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  assert.equal(r.products.length, 192); assert.equal(new Set(r.products.map(p => p.name)).size, 92); assert.equal(r.missingShortNames, 39);
  assert.equal(r.issues.length, 0); assert.equal(new Set(r.products.map(catalogKey)).size, 192); assert.equal(r.products.reduce((sum,p) => sum + Number(p.price), 0), 53192);
  assert.equal(r.products.find(p => p.shortName === 'H36').specification, '36iu*11vials');
  assert.equal(r.products.find(p => p.name === 'KPV' && p.specification === '10mg*10vials').shortName, 'KP');
  assert.equal(r.products.find(p => p.name === 'Adipotide/FTTP').shortName, '');
  assert.ok(r.products.every(p => p.unit === '盒'));
});

test('missing abbreviations use full names in product labels and quote exports', () => {
  const r = importWorkbook(workbook([['简称', '名称', '规格', '价格'], ['', 'Adipotide/FTTP', '2mg', 130]]));
  const p = r.products[0];
  assert.equal(productDisplayName(p), 'Adipotide/FTTP');
  assert.equal(productSecondaryName(p), '');
  assert.equal(productDisplayName({ ...p, shortName: '  ' }), 'Adipotide/FTTP');
  assert.equal(productLabel(p), 'Adipotide/FTTP · 2mg');
  assert.equal(productSecondaryName({ ...p, shortName: 'AD' }), 'Adipotide/FTTP');
  const lines = parseQuote('Adipotide/FTTP 2mg × 5盒', r.products);
  assert.equal(summarize(lines).cents, 65000);
  assert.match(quoteCsv(lines, r.products), /"Adipotide\/FTTP","Adipotide\/FTTP","2mg"/);
  assert.equal(p.shortName, '');
});
