import { rateUnits, usdtAmount } from './quote-export.ts';
export type Product = { id: string; shortName: string; name: string; specification: string; unit: string; category: string; price: string; aliases: string[] };
export type QuoteLine = { id: string; source: string; parsed: string; productId: string; quantity: string; price: string; match: 'exact' | 'manual' | 'none' };
export const productsSeed: Product[] = [
  { id: 'gnd10', name: 'GND10', shortName: 'GND10', specification: '', unit: '件', category: 'GND 系列', price: '75.00', aliases: [] },
  { id: 'tsm5', name: 'TSM5', shortName: 'TSM5', specification: '', unit: '件', category: 'TSM 系列', price: '240.00', aliases: [] },
  { id: 'ml10', name: 'ML10/MT2', shortName: 'ML10/MT2', specification: '', unit: '件', category: 'ML 系列', price: '90.00', aliases: ['ML10', 'MT2'] },
  { id: 'nj100', name: 'NJ100', shortName: 'NJ100', specification: '', unit: '件', category: 'NJ 系列', price: '60.00', aliases: [] },
  { id: 'ad20', name: 'AD20', shortName: 'AD20', specification: '', unit: '件', category: '其他配件', price: '70.00', aliases: [] },
];
export const sampleText = 'GND10 × 20\nGND10 × 30\nTSM5 × 20\nML10 × 5\nNJ100 × 15\nAD20 × 20';
export const MAX_LINES = 200;
export function normalize(value: string) { return value.normalize('NFKC').trim().toUpperCase(); }
export function quantityValue(value: string): number | null {
  const s = value.trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) && n > 0 && n <= 999999 ? n : null;
}
export function moneyCents(value: string): number | null {
  const s = value.trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(s)) return null;
  const [whole, fraction = ''] = s.split('.');
  const n = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(n) && n >= 0 && n <= 99999999 ? n : null;
}
export function lineTotal(line: QuoteLine): number | null {
  const qty = quantityValue(line.quantity), cents = moneyCents(line.price);
  if (!line.productId || qty === null || cents === null) return null;
  const result = qty * cents;
  return Number.isSafeInteger(result) ? result : null;
}
export function parseQuote(text: string, products: Product[]): QuoteLine[] {
  const entries = text.split(/[\n\r;；,，]+/).map(x => x.trim()).filter(Boolean);
  if (entries.length > MAX_LINES) throw new Error('每次最多支持 200 项，请分批计价。');
  return entries.map((source, index) => {
    const clean = normalize(source);
    const explicit = clean.match(/^(.+?)\s*[×X*]\s*([^×X*]*)$/);
    const spaced = clean.match(/^(.+?)\s+(\d+(?:\.\d+)?)(?:\s*(?:个|件|套|支|只|盒|瓶))?$/);
    const choices = [spaced, explicit].filter((m): m is RegExpMatchArray => m !== null);
    const match = choices.find(m => products.some(p => productTerms(p).some(term => normalize(term) === m[1].trim()))) ?? explicit ?? spaced;
    const parsed = (match?.[1] ?? clean).trim();
    const quantity = (match?.[2] ?? '').replace(/\s*(个|件|套|支|只|盒|瓶)$/, '').trim();
    const candidates = products.filter(p => productTerms(p).some(n => normalize(n) === parsed));
    const product = candidates.length === 1 ? candidates[0] : undefined;
    return { id: `parsed-${index}`, source, parsed, productId: product?.id ?? '', quantity, price: product?.price ?? '', match: product ? 'exact' : 'none' };
  });
}
export function summarize(lines: QuoteLine[]) {
  const valid = lines.filter(l => lineTotal(l) !== null);
  const cents = valid.reduce((sum, line) => sum + lineTotal(line)!, 0);
  return { cents, count: lines.length, matched: lines.filter(l => l.productId).length, exact: lines.filter(l => l.match === 'exact').length, quantity: valid.reduce((n, l) => n + quantityValue(l.quantity)!, 0), pending: lines.length - valid.length, safe: Number.isSafeInteger(cents) };
}
export function money(cents: number) { return (cents / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
export function issue(line: QuoteLine): string {
  if (!line.productId) return '请选择产品，暂未计入';
  if (quantityValue(line.quantity) === null) return '数量需为 1–999999 的整数';
  if (moneyCents(line.price) === null) return '单价需为 0–999999.99，最多两位小数';
  return '';
}
export function productTerms(product: Product): string[] {
  const base = [product.shortName, product.name, ...product.aliases].filter(Boolean);
  return product.specification ? [...base, ...base.map(term => `${term} ${product.specification}`)] : base;
}
export function productDisplayName(p: Product): string { return p.shortName.trim() || p.name; }
export function productSecondaryName(p: Product): string {
  return p.shortName.trim() && normalize(p.shortName) !== normalize(p.name) ? p.name : '';
}
export function productLabel(p: Product): string {
  return [p.shortName.trim() && normalize(p.shortName) !== normalize(p.name) ? p.shortName.trim() : '', p.name, p.specification].filter(Boolean).join(' · ');
}
export function searchProducts(products: Product[], query: string): Product[] {
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  return products.filter(p => terms.every(t => normalize([p.shortName, p.name, p.specification, p.category, ...p.aliases].join(' ')).includes(t)));
}
export function quoteText(lines: QuoteLine[], products: Product[], rate?: string, rateSource = '手动设置') {
  if (rate !== undefined && rateUnits(rate) === null) throw new Error('请填写有效汇率：1 USDT 对应的人民币金额，最多 6 位小数。');
  const s = summarize(lines);
  return ['多肽报价清单', ...lines.map((l, i) => {
    const p = products.find(p => p.id === l.productId);
    const total = lineTotal(l);
    return `${i + 1}. ${p ? productLabel(p) : l.source}\n   ${l.quantity || '待补充'} ${p?.unit || '件'} × ¥${moneyCents(l.price) === null ? '待补充' : money(moneyCents(l.price)!)} = ${total === null ? '待完善（未计入）' : '¥' + money(total)}${rate !== undefined && total !== null ? `\n   折合：${usdtAmount(total, rate)} USDT` : ''}`;
  }), '', `${s.pending ? '已确认项目合计' : '合计'}：¥${money(s.cents)}`, ...(rate !== undefined ? [`折合${s.pending ? '已确认' : ''}合计：${usdtAmount(s.cents, rate) ?? '金额超限'} USDT`, `汇率：1 USDT = ¥${rate.trim()}（${rateSource}）`, 'USDT 合计按人民币总额换算，保留两位小数。'] : []), `${s.count} 项 · 已计价数量 ${s.quantity}${s.pending ? ` · ${s.pending} 项待完善` : ''}`].join('\n');
}
export function quoteCsv(lines: QuoteLine[], products: Product[], rate?: string, rateSource = '手动设置') {
  if (rate !== undefined && rateUnits(rate) === null) throw new Error('请填写有效汇率。');
  const cell = (v: string | number) => { let s = String(v); if (/^[\s]*[=+@-]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
  const s = summarize(lines);
  const rows: (string | number)[][] = [['序号', '原始描述', '产品简称', '产品名称', '规格', '品类', '单位', '数量', '单价（元）', '金额（元）', '状态'], ...lines.map((l, i) => { const p = products.find(p => p.id === l.productId); return [i + 1, l.source, p ? productDisplayName(p) : '', p?.name ?? '', p?.specification ?? '', p?.category ?? '', p?.unit ?? '', l.quantity, l.price, lineTotal(l) === null ? '' : (lineTotal(l)! / 100).toFixed(2), issue(l) || '已计价']; }), ['', '', '', '已确认合计', '', '', '', s.quantity, '', (s.cents / 100).toFixed(2), s.pending ? `${s.pending} 项未计入` : '全部已计价']];
  if (rate !== undefined) {
    rows[0].push('单价（USDT）', '金额（USDT）', '汇率（人民币/USDT）');
    lines.forEach((line, i) => {
      const unit = moneyCents(line.price), total = lineTotal(line);
      rows[i + 1].push(unit === null ? '' : (usdtAmount(unit, rate) ?? '').replace(/,/g, ''), total === null ? '' : (usdtAmount(total, rate) ?? '').replace(/,/g, ''), rate.trim());
    });
    rows[rows.length - 1].push('', (usdtAmount(s.cents, rate) ?? '').replace(/,/g, ''), rate.trim());
    rows.push(['汇率来源', rateSource], ['换算说明', '1 USDT = ' + rate.trim() + ' 人民币；金额和合计按对应人民币金额换算，保留两位小数。']);
  }
  return '\uFEFF' + rows.map(row => row.map(cell).join(',')).join('\r\n');
}
