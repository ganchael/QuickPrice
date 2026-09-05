'use client';
import { useRef, useState } from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import { Combobox, ComboboxInput, ComboboxContent, ComboboxList, ComboboxItem, ComboboxEmpty } from '@/components/ui/combobox';
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogClose, DialogTrigger } from '@/components/ui/dialog';
import { productLabel, productDisplayName, productSecondaryName, searchProducts, type Product } from '@/lib/pricing';

function ProductDetails({ product }: { product: Product }) {
  const secondary = productSecondaryName(product);
  return <div className="picker-product"><div className="picker-product-heading"><strong>{productDisplayName(product)}</strong><span className="picker-price">{product.price ? `¥${product.price} / ${product.unit}` : '价格待定'}</span></div>{secondary && <span>{secondary}</span>}{product.specification && <small>{product.specification}</small>}</div>;
}
export function ProductPicker({ products, value, onChange, label, compact = false }: { products: Product[]; value: string; onChange: (id: string) => void; label: string; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const selected = products.find(p => p.id === value) ?? null;
  const filtered = searchProducts(products, query);
  return <>
    <div className="desktop-product-picker"><Combobox items={products} value={selected} onValueChange={p => onChange(p?.id ?? '')} itemToStringLabel={p => productLabel(p)} itemToStringValue={p => p.id}>
      <ComboboxInput className={compact ? 'product-picker compact' : 'product-picker'} aria-label={label} placeholder="搜索简称、名称或规格" showClear />
      <ComboboxContent className="product-picker-popup"><ComboboxEmpty>没有匹配的商品</ComboboxEmpty><ComboboxList>{(p: Product) => <ComboboxItem key={p.id} value={p}><ProductDetails product={p} /></ComboboxItem>}</ComboboxList></ComboboxContent>
    </Combobox></div>
    <Dialog open={open} onOpenChange={next => { setOpen(next); if (next) setQuery(''); }}>
      <DialogTrigger className={`mobile-product-trigger ${compact ? 'compact' : ''}`} aria-label={`${label}${selected ? `，当前 ${productLabel(selected)}` : ''}`}>
        <span>{selected ? <><strong>{productDisplayName(selected)}</strong>{productSecondaryName(selected) && <span>{productSecondaryName(selected)}</span>}<small>{selected.specification || selected.category}</small></> : <span className="picker-placeholder"><Search size={18} />搜索并选择商品</span>}</span><ChevronDown size={18} />
      </DialogTrigger>
      <DialogContent className="mobile-product-dialog" showCloseButton={false} initialFocus={closeButtonRef}>
        <div className="mobile-picker-header"><div className="dialog-heading"><div><DialogTitle>选择商品</DialogTitle><DialogDescription>搜索简称、完整名称或规格</DialogDescription></div><DialogClose ref={closeButtonRef} className="icon-button" aria-label="关闭商品选择"><X size={22} /></DialogClose></div><label className="mobile-picker-search"><Search size={19} /><input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="输入商品名称或规格" aria-label="搜索商品" autoComplete="off" autoCapitalize="none" spellCheck={false} />{query && <button type="button" className="icon-button" onClick={() => setQuery('')} aria-label="清空商品搜索"><X size={18} /></button>}</label><div className="mobile-picker-count"><span>{query ? `找到 ${filtered.length} 条规格` : `共 ${products.length} 条规格`}</span>{selected && <button type="button" className="text-button" onClick={() => { onChange(''); setOpen(false); }}>清除选择</button>}</div></div>
        <div className="mobile-picker-results">{filtered.length ? filtered.map(p => <button className="mobile-picker-option" key={p.id} type="button" aria-pressed={p.id === value} onClick={() => { onChange(p.id); setOpen(false); }}><ProductDetails product={p} /><span className="picker-selection-mark">{p.id === value && <Check size={19} />}</span></button>) : <div className="catalog-empty"><Search size={28} /><h3>没有找到商品</h3><p>换一个名称、简称或规格试试。</p></div>}</div>
      </DialogContent>
    </Dialog>
  </>;
}
