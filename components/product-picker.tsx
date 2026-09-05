'use client';
import { Combobox, ComboboxInput, ComboboxContent, ComboboxList, ComboboxItem, ComboboxEmpty } from '@/components/ui/combobox';
import { productLabel, type Product } from '@/lib/pricing';

export function ProductPicker({ products, value, onChange, label, compact = false }: { products: Product[]; value: string; onChange: (id: string) => void; label: string; compact?: boolean }) {
  return <Combobox items={products} value={products.find(p => p.id === value) ?? null} onValueChange={p => onChange(p?.id ?? '')} itemToStringLabel={p => productLabel(p)} itemToStringValue={p => p.id}>
    <ComboboxInput className={compact ? 'product-picker compact' : 'product-picker'} aria-label={label} placeholder="搜索简称、名称或规格" showClear />
    <ComboboxContent className="product-picker-popup"><ComboboxEmpty>没有匹配的商品</ComboboxEmpty><ComboboxList>{(p: Product) => <ComboboxItem key={p.id} value={p}><div className="picker-product"><strong>{p.shortName || '未填简称'}<span>¥{p.price || '待定'} / {p.unit}</span></strong><span>{p.name}</span>{p.specification && <small>{p.specification}</small>}</div></ComboboxItem>}</ComboboxList></ComboboxContent>
  </Combobox>;
}
