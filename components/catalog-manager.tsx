'use client';
import { useRef, useState } from 'react';
import { ArrowLeft, Check, Cloud, FileSpreadsheet, LoaderCircle, Pencil, Plus, RefreshCw, Search, Upload, X } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogClose } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from '@/components/ui/toast';
import { moneyCents, productDisplayName, productSecondaryName, searchProducts, type Product } from '@/lib/pricing';
import { catalogVariantKey, mergeCatalog, validateProduct } from '@/lib/catalog';
import type { ImportResult } from '@/lib/import-workbook';

type Props = { open: boolean; onOpenChange: (open: boolean) => void; products: Product[]; ready: boolean; saving: boolean; cloudError: string; updatedAt: string | null; onRefresh: () => Promise<Product[] | undefined>; onSave: (products: Product[]) => Promise<void> };
export function CatalogManager(props: Props) {
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Product | null>(null);
  const [editingBase, setEditingBase] = useState<Product | null>(null);
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [fileName, setFileName] = useState('');
  const [reading, setReading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const visible = searchProducts(props.products, query);
  const canEdit = props.ready && !props.saving && !reading && !syncing;
  const commit = async (products: Product[]) => {
    try { await props.onSave(products); setError(''); return true; }
    catch (e) { setError(e instanceof Error ? e.message : '保存失败，请重试。'); return false; }
  };
  const readFile = async (file?: File) => {
    if (!file) return;
    setError('');
    if (!/\.(xlsx|xls|csv)$/i.test(file.name)) { setError('请选择 Excel（.xlsx / .xls）或 CSV 表格。'); return; }
    if (file.size > 5 * 1024 * 1024) { setError('请选择不超过 5 MB 的表格。'); return; }
    setReading(true);
    try { const { importWorkbook } = await import('@/lib/import-workbook'); const result = importWorkbook(await file.arrayBuffer()); setPreview(result); setFileName(file.name); }
    catch (e) { setError(e instanceof Error ? e.message : '表格读取失败，请检查文件。'); }
    finally { setReading(false); if (fileInput.current) fileInput.current.value = ''; }
  };
  const saveEditor = async () => {
    if (!editing) return;
    try {
      const product = validateProduct(editing);
      if (props.products.some(p => p.id !== product.id && catalogVariantKey(p) === catalogVariantKey(product))) throw new Error('相同简称、名称、规格和单位的商品已存在。');
      const next = props.products.some(p => p.id === product.id) ? props.products.map(p => p.id === product.id ? product : p) : [...props.products, product];
      if (await commit(next)) { setEditing(null); toast.add({ title: '商品已保存到云端', type: 'success' }); }
    } catch (e) { setError((e as Error).message); }
  };
  const confirmImport = async () => {
    if (!preview) return;
    try { const merged = mergeCatalog(props.products, preview.products); if (await commit(merged.products)) { setPreview(null); toast.add({ title: `已导入云端：新增 ${merged.added} 项，更新 ${merged.updated} 项`, type: 'success' }); } }
    catch (e) { setError((e as Error).message); }
  };
  const sync = async () => {
    setSyncing(true);
    try {
    const latest = await props.onRefresh();
    if (!latest) return;
    const updated = editing && latest.find(p => p.id === editing.id);
    if (updated && editing && editingBase) {
      const keys = ['shortName', 'name', 'specification', 'category', 'unit', 'price'] as const;
      const changes = Object.fromEntries(keys.filter(key => editing[key] !== editingBase[key]).map(key => [key, editing[key]]));
      setEditing({ ...updated, ...changes }); setEditingBase(updated);
    }
    setError('');
    if (editing || preview) toast.add({ title: '已同步，保留了你的输入，请核对后保存', type: 'info' });
    } finally { setSyncing(false); }
  };
  const close = (open: boolean) => { if (!open && props.saving) return; props.onOpenChange(open); };

  return <Dialog open={props.open} onOpenChange={close}><DialogContent className="catalog-manager" showCloseButton={false}>
    <div className="dialog-heading"><div><DialogTitle>商品价格库</DialogTitle><DialogDescription>导入表格、编辑商品，通过简称或名称快速检索。</DialogDescription></div><DialogClose className="icon-button" aria-label="关闭商品价格库" disabled={props.saving || syncing}><X size={20} /></DialogClose></div>
    <div className="catalog-body">
      <div className="cloud-status"><span><Cloud size={15} />{props.saving ? '正在保存到云端…' : !props.ready ? '正在加载商品库…' : props.updatedAt ? `已同步 · ${new Date(props.updatedAt).toLocaleString('zh-CN', { hour12: false })}` : '云端商品库已就绪'}</span><button className="text-button" onClick={() => void sync()} disabled={props.saving || reading || syncing}><RefreshCw size={14} />{syncing ? '正在同步…' : editing || preview ? '同步，保留输入' : '同步云端'}</button></div>
      {props.cloudError && <p role="alert" className="field-error">{props.cloudError}</p>}
      {editing ? <section className="product-editor"><button className="text-button" onClick={() => { setEditing(null); setError(''); }} disabled={props.saving || syncing}><ArrowLeft size={15} />返回商品列表（放弃未保存改动）</button><fieldset className="product-editor-grid" disabled={props.saving || syncing}>
        <label>产品简称<input className="field-input" value={editing.shortName} onChange={e => setEditing({ ...editing, shortName: e.target.value })} placeholder="留空时显示完整名称" maxLength={80} /></label>
        <label className="editor-name">产品名称<input className="field-input" value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} maxLength={240} placeholder="完整产品名称" /></label>
        <label>规格<input className="field-input" value={editing.specification} onChange={e => setEditing({ ...editing, specification: e.target.value })} placeholder="例如 5mg*10vials" maxLength={160} /></label>
        <label>品类<input className="field-input" value={editing.category} onChange={e => setEditing({ ...editing, category: e.target.value })} maxLength={80} /></label>
        <label>计价单位<input className="field-input" value={editing.unit} onChange={e => setEditing({ ...editing, unit: e.target.value })} placeholder="例如 盒" maxLength={16} /></label>
        <label>单价（元 / {editing.unit || '单位'}）<input className="field-input" value={editing.price} onChange={e => setEditing({ ...editing, price: e.target.value })} inputMode="decimal" placeholder="留空为待定" /></label>
      </fieldset><p className="quiet-note">目录单价用于后续计价；已生成的报价保留当前单价。未填写价格的商品不会自动计入金额。</p></section>
      : preview ? <section className="import-preview"><div className="import-result-heading"><FileSpreadsheet size={27} /><div><h3>{fileName}</h3><p>识别 {preview.products.length} 条规格 · {new Set(preview.products.map(p => p.name)).size} 个产品名称 · {preview.sheetCount} 个工作表</p></div></div>
        <p className="import-notice">简称与完整名称同时保留。{preview.missingShortNames > 0 ? `${preview.missingShortNames} 项没有简称，将直接显示完整名称。` : ''}同名同规格有不同简称时分别保留。再次导入相同商品会更新价格，其余商品保留。</p>
        <div className="catalog-table-scroll preview-scroll"><Table><TableHeader><TableRow><TableHead>商品</TableHead><TableHead>规格</TableHead><TableHead>单价</TableHead></TableRow></TableHeader><TableBody>{preview.products.map(p => <TableRow key={p.id}><TableCell><div className="catalog-product-name"><strong>{productDisplayName(p)}</strong>{productSecondaryName(p) && <span>{productSecondaryName(p)}</span>}</div></TableCell><TableCell>{p.specification || '未填写规格'}</TableCell><TableCell className="catalog-price">{p.price ? `¥${p.price}/${p.unit}` : '待定'}</TableCell></TableRow>)}</TableBody></Table></div>
        {preview.issues.length > 0 && <details className="import-issues"><summary>{preview.issues.length} 条提示{preview.skipped ? `，${preview.skipped} 行未导入` : ''}</summary><ul>{preview.issues.map((i, n) => <li key={n}>{i.sheet} · 第 {i.row} 行：{i.message}</li>)}</ul></details>}
      </section> : <>
        <div className="catalog-toolbar"><label className="catalog-search"><Search size={18} /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索简称、名称或规格" aria-label="搜索商品简称、名称或规格" /></label><button className="secondary-button" onClick={() => { setEditingBase(null); setEditing({ id: crypto.randomUUID(), shortName: '', name: '', specification: '', category: '未分类', unit: '盒', price: '', aliases: [] }); setError(''); }} disabled={!canEdit}><Plus size={16} />新增</button><button className="primary-button" onClick={() => fileInput.current?.click()} disabled={!canEdit}>{reading ? <LoaderCircle className="animate-spin" size={16} /> : <Upload size={16} />}{reading ? '正在读取' : '导入表格'}</button></div>
        <input type="file" accept=".xlsx,.xls,.csv" ref={fileInput} hidden aria-label="选择商品价格表" onChange={e => void readFile(e.target.files?.[0])} />
        <p className="catalog-count">{query ? `找到 ${visible.length} 条规格` : `共 ${props.products.length} 条规格`}<span>支持 Excel / CSV，自动识别左右并排表格和合并单元格</span></p>
        {!props.ready && !props.cloudError ? <div className="catalog-loading"><LoaderCircle className="animate-spin" />加载云端商品库</div> : visible.length === 0 ? <div className="catalog-empty"><FileSpreadsheet size={32} /><h3>{query ? '没有找到相关商品' : '把商品表格带进来'}</h3><p>{query ? '试试产品简称、完整名称或规格中的关键词。' : '选择你的价格表，核对识别结果后即可一键导入。'}</p></div> : <div className="catalog-table-scroll"><Table><TableHeader><TableRow><TableHead>简称 / 名称</TableHead><TableHead>规格 / 品类</TableHead><TableHead className="catalog-price">单价</TableHead><TableHead><span className="sr-only">编辑</span></TableHead></TableRow></TableHeader><TableBody>{visible.map(p => <TableRow key={p.id}><TableCell><button type="button" className="catalog-product-name catalog-edit-name" aria-label={`编辑 ${productDisplayName(p)} ${p.specification}`} onClick={() => { setEditing({ ...p }); setEditingBase({ ...p }); setError(''); }} disabled={!canEdit}><strong>{productDisplayName(p)}</strong>{productSecondaryName(p) && <span>{productSecondaryName(p)}</span>}</button></TableCell><TableCell><div className="catalog-product-spec"><span>{p.specification || '未填规格'}</span><small>{p.category}</small></div></TableCell><TableCell className="catalog-price"><strong>{moneyCents(p.price) === null ? '待定' : `¥${p.price}`}</strong><small> / {p.unit}</small></TableCell><TableCell><button className="icon-button" aria-label={`编辑 ${productDisplayName(p)} ${p.specification}`} onClick={() => { setEditing({ ...p }); setEditingBase({ ...p }); setError(''); }} disabled={!canEdit}><Pencil size={16} /></button></TableCell></TableRow>)}</TableBody></Table></div>}
      </>}
      {error && <p role="alert" className="field-error">{error}</p>}
    </div>
    {(editing || preview) && <div className="catalog-footer">{editing ? <button className="primary-button editor-save" onClick={saveEditor} disabled={!canEdit}><Check size={17} />{props.saving ? '正在保存…' : '保存商品到云端'}</button> : preview && <div className="import-actions"><button className="secondary-button" onClick={() => { setPreview(null); setError(''); }} disabled={props.saving || syncing}>取消</button><button className="primary-button" onClick={confirmImport} disabled={!canEdit}><Upload size={17} />{props.saving ? '正在保存…' : `导入 ${preview.products.length} 项`}</button></div>}</div>}
  </DialogContent></Dialog>;
}
