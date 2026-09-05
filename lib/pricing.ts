export type Product = { id: string; name: string; category: string; price: string; aliases: string[] };
export type QuoteLine = { id: string; source: string; parsed: string; productId: string; quantity: string; price: string; match: 'exact' | 'manual' | 'none' };
export const productsSeed: Product[] = [
  { id: 'gnd10', name: 'GND10', category: 'GND 系列', price: '75.00', aliases: [] },
  { id: 'tsm5', name: 'TSM5', category: 'TSM 系列', price: '240.00', aliases: [] },
  { id: 'ml10', name: 'ML10/MT2', category: 'ML 系列', price: '90.00', aliases: ['ML10', 'MT2'] },
  { id: 'nj100', name: 'NJ100', category: 'NJ 系列', price: '60.00', aliases: [] },
  { id: 'ad20', name: 'AD20', category: '其他配件', price: '70.00', aliases: [] },
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
    const spaced = clean.match(/^(.+?)\s+(\d+(?:\.\d+)?)(?:\s*(?:个|件|套|支|只))?$/);
    const match = explicit ?? spaced;
    const parsed = (match?.[1] ?? clean).trim();
    const quantity = (match?.[2] ?? '').replace(/\s*(个|件|套|支|只)$/, '').trim();
    const candidates = products.filter(p => [p.name, ...p.aliases].some(n => normalize(n) === parsed));
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
export function quoteText(lines: QuoteLine[], products: Product[]) {
  const s = summarize(lines);
  return ['QuickPrice 报价清单', ...lines.map((l, i) => `${i + 1}. ${products.find(p => p.id === l.productId)?.name ?? l.source}\n   ${l.quantity || '待补充'} 件 × ¥${moneyCents(l.price) === null ? '待补充' : money(moneyCents(l.price)!)} = ${lineTotal(l) === null ? '待完善（未计入）' : '¥' + money(lineTotal(l)!)}`), '', `${s.pending ? '已确认项目合计' : '合计'}：¥${money(s.cents)}`, `${s.count} 项 · 已计价 ${s.quantity} 件${s.pending ? ` · ${s.pending} 项待完善` : ''}`].join('\n');
}
export function quoteCsv(lines: QuoteLine[], products: Product[]) {
  const cell = (v: string | number) => { let s = String(v); if (/^[\s]*[=+@-]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
  const s = summarize(lines);
  const rows: (string | number)[][] = [['序号', '原始描述', '产品', '品类', '数量', '单价（元）', '金额（元）', '状态'], ...lines.map((l, i) => { const p = products.find(p => p.id === l.productId); return [i + 1, l.source, p?.name ?? '', p?.category ?? '', l.quantity, l.price, lineTotal(l) === null ? '' : (lineTotal(l)! / 100).toFixed(2), issue(l) || '已计价']; }), ['', '', '已确认合计', '', s.quantity, '', (s.cents / 100).toFixed(2), s.pending ? `${s.pending} 项未计入` : '全部已计价']];
  return '\uFEFF' + rows.map(row => row.map(cell).join(',')).join('\r\n');
}
