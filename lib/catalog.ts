import { moneyCents, normalize, type Product } from './pricing.ts';

export const MAX_PRODUCTS = 2000;
export function catalogKey(p: Product): string {
  return [p.name, p.specification, p.unit].map(normalize).join('\u001f');
}
export function validateProduct(value: unknown): Product {
  if (!value || typeof value !== 'object') throw new Error('商品格式不正确。');
  const p = value as Record<string, unknown>;
  const field = (key: string, max: number, required = false) => {
    if (typeof p[key] !== 'string') throw new Error(`商品字段 ${key} 格式不正确。`);
    const v = (p[key] as string).trim();
    if ((required && !v) || v.length > max) throw new Error(`商品字段 ${key} 为空或过长。`);
    return v;
  };
  const price = field('price', 16);
  if (price !== '' && moneyCents(price) === null) throw new Error('单价须为 0–999999.99，最多两位小数。');
  if (!Array.isArray(p.aliases) || p.aliases.length > 20 || p.aliases.some(a => typeof a !== 'string' || a.length > 240)) throw new Error('商品别名格式不正确。');
  return { id: field('id', 100, true), shortName: field('shortName', 80), name: field('name', 240, true), specification: field('specification', 160), category: field('category', 80, true), unit: field('unit', 16, true), price: price === '' ? '' : (moneyCents(price)! / 100).toFixed(2), aliases: p.aliases.map(a => String(a).trim()).filter(Boolean) };
}
export function validateCatalog(value: unknown): Product[] {
  if (!Array.isArray(value) || value.length > MAX_PRODUCTS) throw new Error(`商品库最多支持 ${MAX_PRODUCTS} 条规格。`);
  const products = value.map(validateProduct);
  if (new Set(products.map(p => p.id)).size !== products.length) throw new Error('商品标识重复。');
  if (new Set(products.map(catalogKey)).size !== products.length) throw new Error('存在相同名称、规格和单位的商品，请先合并。');
  return products;
}
export function mergeCatalog(existing: Product[], incoming: Product[]) {
  const result = existing.map(p => ({ ...p }));
  const positions = new Map(result.map((p, i) => [catalogKey(p), i]));
  let added = 0, updated = 0;
  for (const p of incoming) {
    const key = catalogKey(p), position = positions.get(key);
    if (position === undefined) { positions.set(key, result.length); result.push(p); added++; }
    else { result[position] = { ...p, id: result[position].id }; updated++; }
  }
  return { products: validateCatalog(result), added, updated };
}
