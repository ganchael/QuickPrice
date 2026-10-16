import { moneyCents, normalize, type Product } from './pricing.ts';

export const PRICE_SYNC_INTERVAL_MS = 30_000;
export const MAX_PRICE_CENTS = 99999999;

export type CostStatus = 'missing' | 'confirmed' | 'pending' | 'error';
export type PriceTarget = 'sales' | 'cost' | 'both';

export type PriceInput = { kind: 'missing' } | { kind: 'cents'; cents: number } | { kind: 'invalid'; message: string };

export function specFingerprint(specification: string, unit: string): string {
  return `${normalize(specification)}\u001f${normalize(unit)}`;
}

export function formatCents(cents: number | null): string | null {
  if (cents === null) return null;
  return (cents / 100).toFixed(2);
}

export function parsePriceInput(value: unknown): PriceInput {
  if (value === undefined || value === null) return { kind: 'missing' };
  if (typeof value !== 'string' && typeof value !== 'number') return { kind: 'invalid', message: '价格格式不正确。' };
  const raw = String(value).trim();
  if (raw === '') return { kind: 'missing' };
  const cleaned = raw.replace(/^(?:¥|￥|RMB|CNY)\s*/i, '').replace(/元$/, '').replace(/,/g, '').trim();
  if (cleaned.startsWith('-')) return { kind: 'invalid', message: '价格不能为负数。' };
  if (!/^\d+(?:\.\d+)?$/.test(cleaned)) return { kind: 'invalid', message: '价格格式不正确。' };
  if ((cleaned.split('.')[1] ?? '').length > 2) return { kind: 'invalid', message: '价格最多两位小数，不会自动四舍五入。' };
  const cents = moneyCents(cleaned);
  if (cents === null) return { kind: 'invalid', message: '单价须为 0–999999.99，最多两位小数。' };
  return { kind: 'cents', cents };
}

export type Comparison = {
  salesCents: number | null;
  costCents: number | null;
  diffCents: number | null;
  rate: string | null;
  status: 'recorded' | 'missing_cost' | 'pending_cost' | 'missing_sales' | 'missing_both' | 'error';
  aboveSales: boolean;
};

export function compareUnit(salesCents: number | null, costCents: number | null, costStatus: CostStatus): Comparison {
  if (costStatus === 'error') return { salesCents, costCents: null, diffCents: null, rate: null, status: 'error', aboveSales: false };
  if (costStatus === 'pending') return { salesCents, costCents, diffCents: null, rate: null, status: 'pending_cost', aboveSales: false };
  if (costCents === null || costStatus === 'missing') {
    return { salesCents, costCents: null, diffCents: null, rate: null, status: salesCents === null ? 'missing_both' : 'missing_cost', aboveSales: false };
  }
  if (salesCents === null) return { salesCents: null, costCents, diffCents: null, rate: null, status: 'missing_sales', aboveSales: false };
  const diffCents = salesCents - costCents;
  return { salesCents, costCents, diffCents, rate: rateText(diffCents, salesCents), status: 'recorded', aboveSales: diffCents < 0 };
}

function rateText(diffCents: number, salesCents: number): string | null {
  if (salesCents === 0) return null;
  const negative = diffCents < 0;
  const abs = Math.abs(diffCents);
  const rounded = Math.floor((abs * 10000 + Math.floor(salesCents / 2)) / salesCents);
  const hundredths = negative ? -rounded : rounded;
  const sign = hundredths < 0 ? '-' : '';
  const value = Math.abs(hundredths);
  return `${sign}${Math.floor(value / 100)}.${String(value % 100).padStart(2, '0')}`;
}

export function comparisonStatusLabel(row: Comparison): string {
  if (row.status === 'error') return '加载失败';
  if (row.status === 'pending_cost') return '待确认';
  if (row.status === 'missing_both') return '缺销售价、缺成本';
  if (row.status === 'missing_cost') return '缺成本';
  if (row.status === 'missing_sales') return '缺销售价';
  return row.aboveSales ? '成本高于售价' : '已录入';
}

export type CatalogView = Product & {
  salesPrice: string | null;
  costPrice: string | null;
  costStatus: CostStatus;
  costUpdatedAt: string | null;
  salesUpdatedAt: string | null;
  specFingerprint: string;
};

export function displayPrice(product: Pick<CatalogView, 'salesPrice' | 'costPrice' | 'costStatus'>, priceType: 'sales' | 'cost'): string {
  if (priceType === 'cost') return product.costStatus === 'confirmed' && product.costPrice ? product.costPrice : '';
  return product.salesPrice ?? '';
}

export type RawPriceRow = {
  sheet: string;
  row: number;
  productId?: string;
  shortName?: string;
  name?: string;
  specification?: string;
  unit?: string;
  salesRaw?: string;
  costRaw?: string;
  currency?: string;
};

function productLabel(product: { shortName: string; name: string; specification: string }): string {
  const short = product.shortName.trim() && normalize(product.shortName) !== normalize(product.name) ? product.shortName.trim() : '';
  return [short, product.name, product.specification].filter(Boolean).join(' · ');
}

export type KnownProduct = {
  id: string;
  shortName: string;
  name: string;
  specification: string;
  unit: string;
  aliases: string[];
  salesCents: number | null;
  costCents: number | null;
  costStatus: CostStatus;
};

export type PreviewRow = {
  sheet: string;
  row: number;
  productId: string;
  status: 'ready' | 'skip' | 'invalid' | 'conflict' | 'unmatched' | 'review';
  reason: string;
  suggestions: { id: string; label: string }[];
  sales?: { before: string | null; after: string | null; zero?: boolean };
  cost?: { before: string | null; after: string | null; zero?: boolean; reconfirm?: boolean };
  writeSales: boolean;
  writeCost: boolean;
};

const blank = (value: string | undefined) => value === undefined || value.trim() === '';

function sameText(a: string | undefined, b: string): boolean {
  if (a === undefined || a.trim() === '') return true;
  return normalize(a) === normalize(b);
}

function fieldChange(before: number | null, after: number, status: CostStatus, field: 'sales' | 'cost') {
  const reconfirm = field === 'cost' && status === 'pending';
  if (!reconfirm && before === after) return null;
  return { before: formatCents(before), after: formatCents(after), zero: after === 0, reconfirm };
}

export function previewPriceRows(products: KnownProduct[], rows: RawPriceRow[], target: PriceTarget): PreviewRow[] {
  const byId = new Map(products.map(p => [p.id, p]));
  const preliminary: PreviewRow[] = rows.map(row => classifyRow(products, byId, row, target));
  const groups = new Map<string, number[]>();
  preliminary.forEach((row, index) => {
    if (!row.productId || (row.status !== 'ready' && row.status !== 'skip')) return;
    groups.set(row.productId, [...(groups.get(row.productId) ?? []), index]);
  });
  for (const indexes of groups.values()) {
    if (indexes.length < 2) continue;
    const ready = indexes.filter(i => preliminary[i].status === 'ready');
    if (ready.length < 2) continue;
    const salesValues = new Set(ready.map(i => preliminary[i].sales?.after ?? ''));
    const costValues = new Set(ready.map(i => preliminary[i].cost?.after ?? ''));
    const salesConflict = ready.some(i => preliminary[i].writeSales) && salesValues.size > 1;
    const costConflict = ready.some(i => preliminary[i].writeCost) && costValues.size > 1;
    if (salesConflict || costConflict) {
      for (const i of ready) preliminary[i] = { ...preliminary[i], status: 'conflict', reason: '同一商品出现不同价格，请选择保留哪一行。', writeSales: false, writeCost: false };
      continue;
    }
    const [keep, ...rest] = ready;
    preliminary[keep] = { ...preliminary[keep], reason: rest.length ? `${preliminary[keep].reason} 相同价格已去重。`.trim() : preliminary[keep].reason };
    for (const i of rest) preliminary[i] = { ...preliminary[i], status: 'skip', reason: '与另一行价格相同，已去重，只提交一次。', writeSales: false, writeCost: false, sales: undefined, cost: undefined };
  }
  return preliminary;
}

function classifyRow(products: KnownProduct[], byId: Map<string, KnownProduct>, row: RawPriceRow, target: PriceTarget): PreviewRow {
  const currency = (row.currency ?? '').trim();
  const base = { sheet: row.sheet, row: row.row, productId: '', suggestions: [] as { id: string; label: string }[], writeSales: false, writeCost: false };
  if (currency && !/^(CNY|RMB|人民币|元|¥|￥)$/i.test(currency)) {
    return { ...base, status: 'invalid', reason: '币种不是人民币，未写入。' };
  }
  const id = (row.productId ?? '').trim().replace(/^'+/, '');
  let product: KnownProduct | undefined;
  if (id) {
    product = byId.get(id);
    if (!product) return { ...base, status: 'review', reason: '未知商品 ID，没有改用名称匹配。' };
    const conflict = !sameText(row.shortName, product.shortName) || !sameText(row.name, product.name) || !sameText(row.specification, product.specification) || !sameText(row.unit, product.unit);
    if (conflict) return { ...base, productId: product.id, status: 'review', reason: '商品 ID 与描述不一致，请确认后再提交。' };
  } else {
    const spec = row.specification ?? '';
    const unit = row.unit ?? '';
    if (blank(row.shortName) && blank(row.name)) {
      return { ...base, status: 'unmatched', reason: '缺少商品 ID、简称或名称。', suggestions: suggestionsFor(products, row) };
    }
    const pool = blank(row.shortName)
      ? products.filter(p => normalize(p.name) === normalize(row.name ?? '') && normalize(p.specification) === normalize(spec) && normalize(p.unit) === normalize(unit))
      : products.filter(p => normalize(p.shortName) === normalize(row.shortName ?? '') && normalize(p.specification) === normalize(spec) && normalize(p.unit) === normalize(unit) && sameText(row.name, p.name));
    if (pool.length !== 1) {
      return { ...base, status: 'unmatched', reason: pool.length > 1 ? '匹配到多个商品，请手动选择。' : '没有唯一匹配的商品。', suggestions: pool.length ? pool.map(p => ({ id: p.id, label: productLabel(p) })) : suggestionsFor(products, row) };
    }
    product = pool[0];
  }
  if (row.unit && row.unit.trim() && normalize(row.unit) !== normalize(product.unit)) {
    return { ...base, productId: product.id, status: 'review', reason: '单位与商品库不一致，本期不换算。' };
  }
  const wantSales = target === 'sales' || target === 'both';
  const wantCost = target === 'cost' || target === 'both';
  const salesParsed = wantSales && row.salesRaw !== undefined ? parsePriceInput(row.salesRaw) : null;
  const costParsed = wantCost && row.costRaw !== undefined ? parsePriceInput(row.costRaw) : null;
  if (salesParsed?.kind === 'invalid') return { ...base, productId: product.id, status: 'invalid', reason: `销售价${salesParsed.message}` };
  if (costParsed?.kind === 'invalid') return { ...base, productId: product.id, status: 'invalid', reason: `成本价${costParsed.message}` };
  const result: PreviewRow = { ...base, productId: product.id, status: 'ready', reason: '将更新已确认的价格。' };
  if (salesParsed?.kind === 'cents') {
    const change = fieldChange(product.salesCents, salesParsed.cents, 'confirmed', 'sales');
    if (change) { result.sales = change; result.writeSales = true; }
  }
  if (costParsed?.kind === 'cents') {
    const change = fieldChange(product.costCents, costParsed.cents, product.costStatus, 'cost');
    if (change) { result.cost = change; result.writeCost = true; if (change.reconfirm) result.reason = '将按当前规格和单位重新确认成本。'; }
  }
  if (!result.writeSales && !result.writeCost) {
    result.status = 'skip';
    result.reason = '价格为空或与当前值相同，保留原价。';
  }
  return result;
}

function suggestionsFor(products: KnownProduct[], row: RawPriceRow) {
  const needle = normalize([row.shortName, row.name, row.specification].filter(Boolean).join(' '));
  if (!needle) return [];
  return products.filter(p => {
    const hay = normalize([p.shortName, p.name, p.specification, ...p.aliases].join(' '));
    return hay.includes(needle) || needle.includes(normalize(p.shortName || p.name));
  }).slice(0, 5).map(p => ({ id: p.id, label: productLabel(p) }));
}

export function previewCounts(rows: PreviewRow[]) {
  return {
    total: rows.length,
    ready: rows.filter(r => r.status === 'ready').length,
    unmatched: rows.filter(r => r.status === 'unmatched' || r.status === 'review').length,
    conflict: rows.filter(r => r.status === 'conflict').length,
    invalid: rows.filter(r => r.status === 'invalid').length,
    skipped: rows.filter(r => r.status === 'skip').length,
    salesChanges: rows.filter(r => r.writeSales).length,
    costChanges: rows.filter(r => r.writeCost).length,
  };
}

export function mapPriceHeaders(headers: string[], target: PriceTarget): { fields: Record<string, number | undefined>; error?: string } {
  const norm = (value: string) => value.normalize('NFKC').trim().toUpperCase().replace(/[\s_（）()]/g, '');
  const find = (pattern: RegExp) => headers.findIndex(h => pattern.test(norm(h)));
  const fields = {
    productId: find(/^(商品ID|产品ID|ID)$/),
    shortName: find(/^(简称|产品简称|商品简称|SKU|CODE|SHORTNAME)$/),
    name: find(/^(产品名称|商品名称|名称|品名|NAME)$/),
    specification: find(/^(规格|产品规格|包装规格|SPEC|SPECIFICATION)$/),
    unit: find(/^(单位|计价单位|UNIT)$/),
    sales: find(/^(销售价|销售单价|售价|批发价|批发价格)(元)?$/),
    cost: find(/^(成本价|成本单价|进价|采购价)(元)?$|^COST$/),
    generic: find(/^(价格|单价|PRICE|UNITPRICE)$/),
    currency: find(/^(币种|货币|CURRENCY)$/),
  };
  const index = (value: number) => value >= 0 ? value : undefined;
  const mapped = {
    productId: index(fields.productId),
    shortName: index(fields.shortName),
    name: index(fields.name),
    specification: index(fields.specification),
    unit: index(fields.unit),
    currency: index(fields.currency),
    sales: index(fields.sales),
    cost: index(fields.cost),
  };
  if (target === 'both' && mapped.sales === undefined && mapped.cost === undefined && fields.generic >= 0) {
    return { fields: mapped, error: '只有一列“价格／单价”。请明确它是销售价还是成本价，不能同时当作双价。' };
  }
  if ((target === 'sales' || target === 'both') && mapped.sales === undefined && fields.generic >= 0) mapped.sales = fields.generic;
  if (target === 'cost' && mapped.cost === undefined && fields.generic >= 0) mapped.cost = fields.generic;
  if (target === 'sales' && mapped.sales === undefined) return { fields: mapped, error: '没有找到销售价列。' };
  if (target === 'cost' && mapped.cost === undefined) return { fields: mapped, error: '没有找到成本价列。' };
  if (target === 'both' && mapped.sales === undefined && mapped.cost === undefined) return { fields: mapped, error: '没有找到销售价或成本价列。' };
  return { fields: mapped };
}

export function sheetCell(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const cents = Math.round(value * 100);
    if (Math.abs(value * 100 - cents) > 1e-6) return String(value);
    return (cents / 100).toFixed(2);
  }
  return value == null ? '' : String(value).trim();
}

export function rowsFromMatrix(matrix: string[][], target: PriceTarget, sheet = 'CSV'): { rows: RawPriceRow[]; error?: string } {
  let headerAt = -1;
  for (let i = 0; i < Math.min(matrix.length, 30); i++) {
    const mapped = mapPriceHeaders(matrix[i] ?? [], target);
    if (!mapped.error || mapped.fields.name !== undefined || mapped.fields.productId !== undefined || mapped.fields.shortName !== undefined) {
      if (mapped.fields.name !== undefined || mapped.fields.productId !== undefined || mapped.fields.shortName !== undefined) { headerAt = i; break; }
    }
  }
  if (headerAt < 0) return { rows: [], error: '没有识别到表头。' };
  const mapped = mapPriceHeaders(matrix[headerAt], target);
  if (mapped.error) return { rows: [], error: mapped.error };
  const cell = (row: string[], key: keyof typeof mapped.fields) => {
    const index = mapped.fields[key];
    return index === undefined ? undefined : (row[index] ?? '').trim();
  };
  const rows: RawPriceRow[] = [];
  for (let r = headerAt + 1; r < matrix.length; r++) {
    const line = matrix[r] ?? [];
    if (line.every(value => (value ?? '').trim() === '')) continue;
    rows.push({
      sheet, row: r + 1,
      productId: cell(line, 'productId'),
      shortName: cell(line, 'shortName'),
      name: cell(line, 'name'),
      specification: cell(line, 'specification'),
      unit: cell(line, 'unit'),
      currency: cell(line, 'currency'),
      salesRaw: mapped.fields.sales === undefined ? undefined : (line[mapped.fields.sales] ?? '').trim(),
      costRaw: mapped.fields.cost === undefined ? undefined : (line[mapped.fields.cost] ?? '').trim(),
    });
  }
  return { rows };
}

export function rowsFromSheet(matrix: string[][], target: PriceTarget, sheet = 'Sheet'): { rows: RawPriceRow[]; error?: string } {
  let headerAt = -1;
  for (let i = 0; i < Math.min(matrix.length, 30); i++) {
    const cells = matrix[i] ?? [];
    if (cells.some(cell => /商品ID|产品名称|商品名称|简称|名称/.test(cell.normalize('NFKC').replace(/\s/g, '')))) { headerAt = i; break; }
  }
  if (headerAt < 0) return rowsFromMatrix(matrix, target, sheet);
  const header = matrix[headerAt] ?? [];
  const kind = (cell: string) => {
    const text = cell.normalize('NFKC').trim();
    if (/商品ID|产品ID/.test(text)) return 'id';
    if (/产品名称|商品名称|^名称$|品名/.test(text)) return 'name';
    return '';
  };
  const ids = header.map((cell, index) => kind(cell) === 'id' ? index : -1).filter(index => index >= 0);
  const names = header.map((cell, index) => kind(cell) === 'name' ? index : -1).filter(index => index >= 0);
  const anchors = names.length > 1 ? names : ids.length > 1 ? ids : [];
  if (anchors.length <= 1) return rowsFromMatrix(matrix, target, sheet);
  const rows: RawPriceRow[] = [];
  for (let block = 0; block < anchors.length; block++) {
    const start = Math.max(0, anchors[block] - 1);
    const end = anchors[block + 1] ?? header.length;
    const sliced = matrix.map(line => (line ?? []).slice(start, end));
    const parsed = rowsFromMatrix(sliced, target, sheet);
    if (parsed.error && !parsed.rows.length) return parsed;
    rows.push(...parsed.rows);
  }
  return { rows };
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const source = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += char;
      continue;
    }
    if (char === '"') { quoted = true; continue; }
    if (char === ',') { row.push(cell); cell = ''; continue; }
    if (char === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; continue; }
    if (char !== '\r') cell += char;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(line => line.some(value => value.trim() !== ''));
}

function csvCell(value: string | number) {
  let text = String(value);
  if (/^[\s]*[=+@-]/.test(text) || text.startsWith("'")) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function priceTemplateCsv(products: Pick<KnownProduct, 'id' | 'shortName' | 'name' | 'specification' | 'unit' | 'salesCents' | 'costCents'>[], target: PriceTarget, includePrices = false): string {
  const headers = ['商品ID', '简称', '产品名称', '规格', '单位'];
  if (target === 'sales' || target === 'both') headers.push('销售价（元）');
  if (target === 'cost' || target === 'both') headers.push('成本价（元）');
  const lines = [headers, ...products.map(product => {
    const row = [`'${product.id}`, product.shortName, product.name, product.specification, product.unit];
    if (target === 'sales' || target === 'both') row.push(includePrices ? formatCents(product.salesCents) ?? '' : '');
    if (target === 'cost' || target === 'both') row.push(includePrices ? formatCents(product.costCents) ?? '' : '');
    return row;
  })];
  return `\uFEFF${lines.map(line => line.map(csvCell).join(',')).join('\r\n')}`;
}

export function comparisonCsv(rows: { id: string; shortName: string; name: string; specification: string; unit: string; sales: string | null; cost: string | null; diff: string | null; rate: string | null; status: string; updatedAt: string }[]): string {
  const header = ['商品ID', '简称', '名称', '规格', '单位', '销售价', '成本价', '单位价差', '价差率', '状态', '数据更新时间'];
  const body = rows.map(row => [row.id, row.shortName, row.name, row.specification, row.unit, row.sales ?? '', row.cost ?? '', row.diff ?? '', row.rate ?? '', row.status, row.updatedAt]);
  return `\uFEFF${[header, ...body].map(line => line.map(csvCell).join(',')).join('\r\n')}`;
}

export function nextQueueId(queue: string[], currentId: string): string | null {
  const index = queue.indexOf(currentId);
  if (index < 0) return null;
  return queue[index + 1] ?? null;
}

export type SwitchPlan = {
  phase: 'quote' | 'draft' | 'password' | 'stay' | 'reload';
  clearLocal: boolean;
};

export function planAccountSwitch(input: {
  hasQuote: boolean;
  quoteConfirmed: boolean;
  draftDirty: boolean;
  draftChoice: 'none' | 'save' | 'discard' | 'cancel';
  saveOk: boolean | null;
  password: 'none' | 'ok' | 'bad' | 'cancel' | 'lost';
  liveActor: string | null;
  previousActor: string;
  targetActor: string;
}): SwitchPlan {
  if (input.hasQuote && !input.quoteConfirmed) return { phase: 'quote', clearLocal: false };
  if (input.draftDirty && input.draftChoice === 'none') return { phase: 'draft', clearLocal: false };
  if (input.draftChoice === 'cancel') return { phase: 'stay', clearLocal: false };
  if (input.draftChoice === 'save' && input.saveOk !== true) return { phase: 'stay', clearLocal: false };
  if (input.password === 'none') return { phase: 'password', clearLocal: false };
  if (input.password === 'bad' || input.password === 'cancel') return { phase: 'stay', clearLocal: false };
  if (input.password === 'lost') {
    if (input.liveActor === input.targetActor) return { phase: 'reload', clearLocal: true };
    return { phase: 'stay', clearLocal: false };
  }
  if (input.password === 'ok' && input.liveActor && input.liveActor !== input.targetActor) return { phase: 'stay', clearLocal: false };
  return { phase: 'reload', clearLocal: true };
}

export function acceptLateResponse(input: { epoch: number; currentEpoch: number; actorId: string; expectedActorId: string; visible: boolean }): boolean {
  return input.visible && input.epoch === input.currentEpoch && input.actorId === input.expectedActorId;
}
