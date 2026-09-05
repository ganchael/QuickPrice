import { read, utils, type WorkSheet, type Range } from 'xlsx';
import { moneyCents, normalize, type Product } from './pricing.ts';
import { catalogKey, MAX_PRODUCTS } from './catalog.ts';

export type ImportIssue = { sheet: string; row: number; message: string };
export type ImportResult = { products: Product[]; issues: ImportIssue[]; sheetCount: number; missingShortNames: number; skipped: number };
type Cell = string | number | boolean | null;
type Block = { row: number; name: number; code: number; spec: number; price: number; category: number; unit: number; defaultUnit: string };
const str = (value: Cell | undefined) => value == null ? '' : String(value).trim();
const header = (value: Cell | undefined) => normalize(str(value)).replace(/[\s_（）()]/g, '');
const isName = (value: Cell | undefined) => /^(名称|产品名称|商品名称|品名|NAME|PRODUCTNAME)$/.test(header(value));
const isCode = (value: Cell | undefined) => /^(简称|产品简称|商品简称|产品缩写|缩写|型号|货号|编码|SKU|CODE|SHORTNAME)$/.test(header(value));
const isSpec = (value: Cell | undefined) => /^(规格|产品规格|包装规格|SPEC|SPECIFICATION|SIZE)$/.test(header(value));
const isPrice = (value: Cell | undefined) => /^(?:单价|价格|批发价|批发价格|售价|元[/／]|PRICE|UNITPRICE)/.test(header(value));
function blocksAt(rows: Cell[][], row: number): Block[] {
  const cells = rows[row], names = cells.map((v, i) => isName(v) ? i : -1).filter(i => i >= 0);
  return names.flatMap((name, n) => {
    const end = names[n + 1] ?? Math.min(cells.length, name + 10);
    const index = (test: (v: Cell | undefined) => boolean) => cells.findIndex((v, i) => i >= Math.max(0, name - 1) && i < end && test(v));
    const price = index(isPrice);
    if (price < 0) return [];
    const explicitCode = index(isCode);
    return [{ row, name, code: explicitCode >= 0 ? explicitCode : name > 0 && !str(cells[name - 1]) ? name - 1 : -1, spec: index(isSpec), price, category: index(v => /^(品类|分类|类别|CATEGORY)$/.test(header(v))), unit: index(v => /^(单位|计价单位|UNIT)$/.test(header(v))), defaultUnit: str(cells[price]).match(/[/／]\s*([^\s）)]+)/)?.[1] ?? '件' }];
  });
}
function mergedText(rows: Cell[][], merges: Range[], r: number, c: number): string {
  if (c < 0) return '';
  const direct = str(rows[r]?.[c]);
  if (direct) return direct;
  const merge = merges.find(m => m.s.c === c && m.e.c === c && r >= m.s.r && r <= m.e.r);
  return merge ? str(rows[merge.s.r]?.[c]) : '';
}
function parseSheet(sheet: WorkSheet, sheetName: string, result: ImportResult) {
  const range = utils.decode_range(sheet['!ref'] ?? 'A1');
  if (range.e.r > 10000 || range.e.c > 100) throw new Error('表格过大，每个工作表最多支持 10000 行、100 列。');
  const rows = utils.sheet_to_json<Cell[]>(sheet, { header: 1, defval: '', raw: true, blankrows: true });
  let blocks: Block[] = [];
  for (let i = 0; i < Math.min(rows.length, 30); i++) { blocks = blocksAt(rows, i); if (blocks.length) break; }
  if (!blocks.length) { result.issues.push({ sheet: sheetName, row: 1, message: '未识别名称和价格表头，已跳过此工作表。' }); return; }
  result.sheetCount++;
  const merges = sheet['!merges'] ?? [];
  for (const b of blocks) {
    let currentName = '', currentShortName = '';
    for (let r = b.row + 1; r < rows.length; r++) {
      const cells = rows[r];
      if (isName(cells[b.name]) && isPrice(cells[b.price])) { currentName = ''; currentShortName = ''; continue; }
      const explicitName = str(cells[b.name]);
      if (explicitName) { currentName = explicitName; currentShortName = str(cells[b.code]); }
      const rawSpec = b.spec >= 0 ? str(cells[b.spec]) : '';
      const rawPrice = str(cells[b.price]);
      // A merged specification/price spanning extra visual rows is one SKU.
      if (!rawSpec && !rawPrice) continue;
      if (!currentName) { result.skipped++; result.issues.push({ sheet: sheetName, row: r + 1, message: '缺少产品名称，未导入该行。' }); continue; }
      const name = mergedText(rows, merges, r, b.name) || currentName;
      const shortName = mergedText(rows, merges, r, b.code) || currentShortName;
      currentShortName = shortName;
      const specification = mergedText(rows, merges, r, b.spec);
      const cleanedPrice = (mergedText(rows, merges, r, b.price) || rawPrice).replace(/^(?:¥|￥|RMB|CNY)\s*/i, '').replace(/元(?:\s*[/／].*)?$/, '').trim();
      const validGrouping = !cleanedPrice.includes(',') || /^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(cleanedPrice);
      const cents = validGrouping ? moneyCents(cleanedPrice.replace(/,/g, '')) : null;
      if (cents === null) result.issues.push({ sheet: sheetName, row: r + 1, message: `${shortName || name} 的价格为空或无效，已留空，需补充后计价。` });
      const product: Product = { id: `import-${crypto.randomUUID()}`, name, shortName, specification, price: cents === null ? '' : (cents / 100).toFixed(2), category: mergedText(rows, merges, r, b.category) || '未分类', unit: mergedText(rows, merges, r, b.unit) || b.defaultUnit, aliases: [] };
      if (result.products.some(p => catalogKey(p) === catalogKey(product))) { result.skipped++; result.issues.push({ sheet: sheetName, row: r + 1, message: `${name} ${specification} 重复，保留首次出现的记录。` }); continue; }
      result.products.push(product);
      if (result.products.length > MAX_PRODUCTS) throw new Error(`每次最多导入 ${MAX_PRODUCTS} 条规格，请拆分文件。`);
    }
  }
}
export function importWorkbook(buffer: ArrayBuffer): ImportResult {
  if (buffer.byteLength > 5 * 1024 * 1024) throw new Error('请选择不超过 5 MB 的表格。');
  const workbook = read(buffer, { type: 'array', cellFormula: false, cellDates: false, sheetRows: 10002 });
  if (workbook.SheetNames.length > 30) throw new Error('每次最多读取 30 个工作表。');
  const result: ImportResult = { products: [], issues: [], sheetCount: 0, missingShortNames: 0, skipped: 0 };
  for (const name of workbook.SheetNames) parseSheet(workbook.Sheets[name], name, result);
  if (!result.products.length) throw new Error('没有识别到商品。请检查是否包含“名称”“规格”“价格”表头，简称列可以在名称前方。');
  result.missingShortNames = result.products.filter(p => !p.shortName).length;
  return result;
}
