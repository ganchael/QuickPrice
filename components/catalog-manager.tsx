'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Check, Cloud, FileSpreadsheet, LoaderCircle, Pencil, Plus, RefreshCw, Search, Trash2, Upload, X } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogClose } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogContent, AlertDialogTitle, AlertDialogDescription, AlertDialogCancel, AlertDialogAction, AlertDialogFooter } from '@/components/ui/alert-dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from '@/components/ui/toast';
import { productDisplayName, productSecondaryName, searchProducts, type Product } from '@/lib/pricing';
import { catalogVariantKey, mergeCatalog, removeProduct, validateProduct } from '@/lib/catalog';
import { comparisonCsv, comparisonStatusLabel, compareUnit, formatCents, nextQueueId, parseCsv, previewPriceRows, priceTemplateCsv, rowsFromSheet, sheetCell, type PreviewRow, type PriceTarget, type RawPriceRow } from '@/lib/price-domain';
import { quoteFilename } from '@/lib/quote-export';
import { moneyCents } from '@/lib/pricing';
import type { ImportResult } from '@/lib/import-workbook';

type Row = Product & { salesPrice?: string | null; costPrice?: string | null; costStatus?: 'missing' | 'confirmed' | 'pending' | 'error'; costUpdatedAt?: string | null; salesUpdatedAt?: string | null; specFingerprint?: string };
type SaveResult = { ok?: boolean; error?: string; code?: string; productId?: string; conflicts?: { field: string; cloud: string | null; typed: string | null }[]; changes?: number };
type Props = {
  open: boolean; onOpenChange: (open: boolean) => void; products: Row[]; ready: boolean; saving: boolean; cloudError: string; updatedAt: string | null;
  actorId: string; priceType: 'sales' | 'cost'; canEditMaster: boolean; costRevision: number; revision: number; costAvailable: boolean;
  onRefresh: () => Promise<Product[] | undefined>; onSave: (products: Product[]) => Promise<void>;
  onCreate: (body: Record<string, unknown>) => Promise<SaveResult>; onPatch: (id: string, body: Record<string, unknown>) => Promise<SaveResult>;
  onCommitImport: (body: Record<string, unknown>) => Promise<SaveResult>;
  onActivity: (activity: { dirty: boolean; kind: string; save: () => Promise<boolean> }) => void;
};
type Filter = 'all' | 'sales-missing' | 'cost-missing' | 'pending';

function requestId() {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === 'function') return cryptoApi.randomUUID();
  return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
function salesText(product: Row) { return product.salesPrice ? `¥${product.salesPrice}` : '待录入'; }
function costText(product: Row) {
  if (product.costStatus === 'error') return '加载失败';
  if (product.costStatus === 'pending') return '待确认';
  return product.costPrice ? `¥${product.costPrice}` : '待录入';
}
function downloadText(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export function CatalogManager(props: Props) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [editing, setEditing] = useState<Product | null>(null);
  const [editingBase, setEditingBase] = useState<Product | null>(null);
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [fileName, setFileName] = useState('');
  const [reading, setReading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');
  const [pendingDelete, setPendingDelete] = useState<Product | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ shortName: '', name: '', specification: '', category: '未分类', unit: '盒', salesPrice: '', costPrice: '' });
  const [draftBase, setDraftBase] = useState(draft);
  const [priceRow, setPriceRow] = useState<Row | null>(null);
  const [priceBase, setPriceBase] = useState({ sales: '', cost: '' });
  const [priceDraft, setPriceDraft] = useState({ sales: '', cost: '' });
  const [priceFocus, setPriceFocus] = useState<'sales' | 'cost'>('sales');
  const [queue, setQueue] = useState<string[]>([]);
  const [conflicts, setConflicts] = useState<{ field: string; cloud: string | null; typed: string | null }[]>([]);
  const [clearing, setClearing] = useState<'sales' | 'cost' | null>(null);
  const [highlight, setHighlight] = useState('');
  const [showHidden, setShowHidden] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importTarget, setImportTarget] = useState<PriceTarget>('cost');
  const [rawRows, setRawRows] = useState<RawPriceRow[] | null>(null);
  const [skipProblems, setSkipProblems] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [compareFilter, setCompareFilter] = useState('all');
  const [includePrices, setIncludePrices] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const priceRequest = useRef('');
  const createRequest = useRef('');
  const importRequest = useRef('');
  const canEdit = props.ready && !props.saving && !reading && !syncing;
  const searched = searchProducts(props.products, query) as Row[];
  const visible = searched.filter(product => filter === 'all' || (filter === 'sales-missing' && !product.salesPrice) || (filter === 'cost-missing' && product.costStatus === 'missing') || (filter === 'pending' && product.costStatus === 'pending'));
  const known = props.products.map(product => ({ id: product.id, shortName: product.shortName, name: product.name, specification: product.specification, unit: product.unit, aliases: product.aliases, salesCents: product.salesPrice ? moneyCents(product.salesPrice) : null, costCents: product.costPrice && product.costStatus !== 'error' ? moneyCents(product.costPrice) : null, costStatus: product.costStatus === 'error' ? 'error' as const : product.costStatus ?? 'missing' }));
  const importRows = useMemo(() => rawRows ? previewPriceRows(known, rawRows, importTarget) : [], [rawRows, importTarget, props.products]);
  const priceDirty = !!priceRow && (priceDraft.sales !== priceBase.sales || priceDraft.cost !== priceBase.cost);
  const createDirty = creating && JSON.stringify(draft) !== JSON.stringify(draftBase);
  const masterDirty = !!editing && !!editingBase && JSON.stringify(editing) !== JSON.stringify(editingBase);
  const saveActivity = async () => {
    if (priceDirty && priceRow) return savePrice(false);
    if (createDirty) return saveCreate();
    if (masterDirty) return saveEditor();
    return false;
  };
  useEffect(() => { props.onActivity({ dirty: priceDirty || createDirty || masterDirty || !!rawRows, kind: rawRows ? 'import' : creating ? 'create' : editing ? 'master' : priceRow ? 'price' : 'idle', save: saveActivity }); });
  const commit = async (products: Product[]) => {
    try { await props.onSave(products); setError(''); return true; }
    catch (e) { setError(e instanceof Error ? e.message : '保存失败，请重试。'); return false; }
  };
  const readFile = async (file?: File) => {
    if (!file || !props.canEditMaster) return;
    setError('');
    if (!/\.(xlsx|xls|csv)$/i.test(file.name)) { setError('请选择 Excel（.xlsx / .xls）或 CSV 表格。'); return; }
    if (file.size > 5 * 1024 * 1024) { setError('请选择不超过 5 MB 的表格。'); return; }
    setReading(true);
    try { const { importWorkbook } = await import('@/lib/import-workbook'); const result = importWorkbook(await file.arrayBuffer()); setPreview(result); setFileName(file.name); }
    catch (e) { setError(e instanceof Error ? e.message : '表格读取失败，请检查文件。'); }
    finally { setReading(false); if (fileInput.current) fileInput.current.value = ''; }
  };
  const saveEditor = async () => {
    if (!editing || !props.canEditMaster) return false;
    try {
      const product = validateProduct(editing);
      if (props.products.some(p => p.id !== product.id && catalogVariantKey(p) === catalogVariantKey(product))) throw new Error('相同简称、名称、规格和单位的商品已存在。');
      const next = props.products.some(p => p.id === product.id) ? props.products.map(p => p.id === product.id ? product : p) : [...props.products, product];
      if (await commit(next.map(item => ({ id: item.id, shortName: item.shortName, name: item.name, specification: item.specification, unit: item.unit, category: item.category, price: item.price, aliases: item.aliases })))) { setEditing(null); toast.add({ title: '商品已保存到云端', type: 'success' }); return true; }
    } catch (e) { setError((e as Error).message); }
    return false;
  };
  const confirmImport = async () => {
    if (!preview || !props.canEditMaster) return;
    try { const merged = mergeCatalog(props.products, preview.products); if (await commit(merged.products)) { setPreview(null); toast.add({ title: `已导入云端：新增 ${merged.added} 项，更新 ${merged.updated} 项`, type: 'success' }); } }
    catch (e) { setError((e as Error).message); }
  };
  const sync = async () => {
    setSyncing(true);
    try {
      const latest = await props.onRefresh();
      if (!latest) { toast.add({ title: '同步失败／数据截至', type: 'error' }); return; }
      const updated = editing && latest.find(p => p.id === editing.id);
      if (updated && editing && editingBase) {
        const keys = ['shortName', 'name', 'specification', 'category', 'unit', 'price'] as const;
        const changes = Object.fromEntries(keys.filter(key => editing[key] !== editingBase[key]).map(key => [key, editing[key]]));
        setEditing({ ...updated, ...changes }); setEditingBase(updated);
      }
      if (priceRow) {
        const remote = (latest as Row[]).find(item => item.id === priceRow.id);
        if (remote && (remote.salesPrice !== priceRow.salesPrice || remote.costPrice !== priceRow.costPrice || remote.specFingerprint !== priceRow.specFingerprint)) toast.add({ title: '云端价格已更新，请核对，未覆盖当前输入', type: 'warning' });
      }
      setError('');
    } finally { setSyncing(false); }
  };
  const openCreate = (seed = { shortName: '', name: '', specification: '', category: '未分类', unit: '盒', salesPrice: '', costPrice: '' }) => {
    createRequest.current = requestId(); setDraft(seed); setDraftBase(seed); setCreating(true); setError('');
  };
  const saveCreate = async () => {
    const result = await props.onCreate({ requestId: createRequest.current || requestId(), expectedActorId: props.actorId, catalogRevision: props.revision, costRevision: props.costRevision, product: { shortName: draft.shortName, name: draft.name, specification: draft.specification, category: draft.category, unit: draft.unit, aliases: [] }, salesPrice: draft.salesPrice, costPrice: draft.costPrice });
    if (result.code === 'exists') { setError(result.error || '商品已存在，去补录／编辑价格'); return false; }
    if (!result.ok || !result.productId) { setError(result.error || '保存失败，商品和价格都没有写入。'); return false; }
    setCreating(false); setHighlight(result.productId); setShowHidden(true); toast.add({ title: '商品已保存，两个账号都会看到', type: 'success' }); return true;
  };
  const openPrice = (product: Row, focus: 'sales' | 'cost', fromQueue = false) => {
    const sales = product.salesPrice ?? '';
    const cost = product.costStatus === 'confirmed' || product.costStatus === 'pending' ? product.costPrice ?? '' : '';
    priceRequest.current = requestId(); setPriceRow(product); setPriceBase({ sales, cost }); setPriceDraft({ sales, cost }); setPriceFocus(focus); setConflicts([]); setError('');
    if (!fromQueue) setQueue(filter === 'all' ? [] : visible.map(item => item.id));
  };
  const savePrice = async (advance: boolean) => {
    if (!priceRow) return false;
    const body: Record<string, unknown> = { requestId: priceRequest.current || requestId(), expectedActorId: props.actorId, catalogRevision: props.revision, costRevision: props.costRevision, seenFingerprint: priceRow.specFingerprint };
    if (priceDraft.sales !== priceBase.sales) body.sales = { amount: priceDraft.sales, baseline: priceRow.salesPrice ? moneyCents(priceRow.salesPrice) : null };
    if (priceDraft.cost !== priceBase.cost) body.cost = { amount: priceDraft.cost, baseline: priceRow.costPrice && priceRow.costStatus !== 'missing' && priceRow.costStatus !== 'error' ? moneyCents(priceRow.costPrice) : null };
    if (!body.sales && !body.cost) { setPriceRow(null); return true; }
    const result = await props.onPatch(priceRow.id, body);
    if (result.conflicts) { setConflicts(result.conflicts); setError(result.error || '请核对云端价格。'); return false; }
    if (!result.ok) { setError(result.error || '保存失败，输入仍保留。'); return false; }
    const changedSales = body.sales !== undefined; const changedCost = body.cost !== undefined;
    toast.add({ title: changedSales && changedCost ? '售价和成本已保存' : changedCost ? '成本已保存' : '售价已保存', type: 'success' });
    const nextId = advance ? nextQueueId(queue, priceRow.id) : null;
    if (nextId) {
      const next = props.products.find(item => item.id === nextId);
      if (next) openPrice(next, priceFocus, true); else setPriceRow(null);
    } else setPriceRow(null);
    return true;
  };
  const clearPrice = async () => {
    if (!priceRow || !clearing) return;
    const body: Record<string, unknown> = { requestId: requestId(), expectedActorId: props.actorId, catalogRevision: props.revision, costRevision: props.costRevision, seenFingerprint: priceRow.specFingerprint };
    if (clearing === 'sales') body.sales = { clear: true, baseline: priceRow.salesPrice ? moneyCents(priceRow.salesPrice) : null };
    else body.cost = { clear: true, baseline: priceRow.costPrice ? moneyCents(priceRow.costPrice) : null };
    const result = await props.onPatch(priceRow.id, body);
    if (!result.ok) { setError(result.error || '清空失败，商品仍在。'); return; }
    toast.add({ title: clearing === 'sales' ? '售价已清空' : '成本已清空', type: 'success' });
    setClearing(null); setPriceRow(null);
  };
  const readPriceFile = async (file?: File) => {
    if (!file) return;
    if (!/\.(xlsx|xls|csv)$/i.test(file.name) || file.size > 5 * 1024 * 1024) { setError('请选择不超过 5 MB 的 Excel 或 CSV。'); return; }
    setReading(true); setError('');
    try {
      const buffer = await file.arrayBuffer();
      let matrix: string[][] = [];
      if (/\.csv$/i.test(file.name)) matrix = parseCsv(new TextDecoder().decode(buffer));
      else {
        const { read, utils } = await import('xlsx');
        const book = read(buffer, { type: 'array', cellFormula: false, cellDates: false });
        matrix = utils.sheet_to_json<unknown[]>(book.Sheets[book.SheetNames[0]], { header: 1, raw: true, defval: '' }).map(line => line.map(sheetCell));
      }
      const parsed = rowsFromSheet(matrix, importTarget, file.name);
      if (parsed.error) { setError(parsed.error); setRawRows(null); return; }
      importRequest.current = requestId(); setRawRows(parsed.rows); setFileName(file.name); setSkipProblems(false);
    } catch (e) { setError(e instanceof Error ? e.message : '表格读取失败。'); }
    finally { setReading(false); }
  };
  const commitPriceImport = async () => {
    const blocked = importRows.filter(row => row.status === 'invalid' || row.status === 'conflict' || row.status === 'review' || row.status === 'unmatched');
    if (blocked.length && !skipProblems) { setError('还有未处理的行。可以修正、手动匹配，或明确跳过问题行。'); return; }
    const rows = importRows.filter(row => row.status === 'ready').map(row => ({
      productId: row.productId,
      ...(row.writeSales ? { sales: { amount: row.sales?.after ?? '', baseline: row.sales?.before === null || row.sales?.before === undefined ? null : moneyCents(row.sales.before) } } : {}),
      ...(row.writeCost ? { cost: { amount: row.cost?.after ?? '', baseline: row.cost?.before === null || row.cost?.before === undefined ? null : moneyCents(row.cost.before) } } : {}),
    }));
    const result = await props.onCommitImport({ requestId: importRequest.current || requestId(), expectedActorId: props.actorId, catalogRevision: props.revision, costRevision: props.costRevision, target: importTarget, skipProblems, rows });
    if (!result.ok) { setError(result.error || '导入失败，没有写入。'); return; }
    toast.add({ title: `已导入 ${result.changes ?? 0} 项，两个账号同步生效`, type: 'success' });
    setRawRows(null); setImportOpen(false);
  };
  const confirmDelete = async () => {
    if (!pendingDelete || !props.canEditMaster) return;
    try {
      await props.onSave(removeProduct(props.products, pendingDelete.id));
      setError(''); toast.add({ title: `已删除 ${productDisplayName(pendingDelete)}`, type: 'success' }); setPendingDelete(null);
    } catch (e) { const message = e instanceof Error ? e.message : '删除失败，请重试。'; setError(message); toast.add({ title: message, type: 'error' }); }
  };
  const compared = props.products.map(product => {
    const sales = product.salesPrice ? moneyCents(product.salesPrice) : null;
    const cost = product.costStatus === 'confirmed' && product.costPrice ? moneyCents(product.costPrice) : null;
    return { product, compared: compareUnit(sales, product.costStatus === 'pending' ? (product.costPrice ? moneyCents(product.costPrice) : null) : cost, product.costStatus ?? 'missing') };
  }).filter(row => compareFilter === 'all' || (compareFilter === 'missing' && (row.compared.status === 'missing_cost' || row.compared.status === 'missing_both')) || (compareFilter === 'pending' && row.compared.status === 'pending_cost') || (compareFilter === 'above' && row.compared.aboveSales));
  const exportComparison = () => {
    const csv = comparisonCsv(props.products.map(product => {
      const sales = product.salesPrice ? moneyCents(product.salesPrice) : null;
      const pending = product.costStatus === 'pending';
      const cost = !pending && product.costStatus === 'confirmed' && product.costPrice ? moneyCents(product.costPrice) : null;
      const row = compareUnit(sales, pending ? null : cost, product.costStatus ?? 'missing');
      return { id: product.id, shortName: product.shortName, name: product.name, specification: product.specification, unit: product.unit, sales: formatCents(sales), cost: pending ? '' : formatCents(cost), diff: formatCents(row.diffCents), rate: row.rate, status: comparisonStatusLabel(row), updatedAt: product.costUpdatedAt || product.salesUpdatedAt || '' };
    }));
    downloadText(quoteFilename(new Date(), 'comparison'), csv);
    toast.add({ title: '已导出内部对比，文件包含成本信息', type: 'success' });
  };
  const close = (open: boolean) => { if (!open && props.saving) return; props.onOpenChange(open); };
  const hiddenNew = showHidden && highlight && !visible.some(product => product.id === highlight);

  return <><Dialog open={props.open} onOpenChange={close}><DialogContent className="catalog-manager" showCloseButton={false}>
    <div className="dialog-heading"><div><DialogTitle>商品价格库</DialogTitle><DialogDescription>销售价和成本价共用这一份商品。{props.priceType === 'cost' ? '当前清单默认取成本价。' : '当前清单默认取销售价。'}</DialogDescription></div><DialogClose className="icon-button" aria-label="关闭商品价格库" disabled={props.saving || syncing}><X size={20} /></DialogClose></div>
    <div className="catalog-body">
      <div className="cloud-status"><span><Cloud size={15} />{props.saving ? '正在保存到云端…' : !props.ready ? '正在加载商品库…' : props.updatedAt ? `商品库已同步 · ${new Date(props.updatedAt).toLocaleString('zh-CN', { hour12: false })}` : '云端商品库已就绪'}</span><button className="text-button" onClick={() => void sync()} disabled={props.saving || reading || syncing}><RefreshCw size={14} />{syncing ? '正在同步…' : '同步云端'}</button></div>
      {props.cloudError && <p role="alert" className="field-error">{props.cloudError}</p>}
      {!props.costAvailable && <p role="alert" className="field-error">成本价加载失败。销售价仍可使用；依赖成本的表单已停止保存，避免用空值覆盖。</p>}
      {editing && props.canEditMaster ? <section className="product-editor"><button className="text-button" onClick={() => { setEditing(null); setError(''); }} disabled={props.saving || syncing}><ArrowLeft size={15} />返回商品列表（放弃未保存改动）</button><fieldset className="product-editor-grid" disabled={props.saving || syncing}>
        <label>产品简称<input className="field-input" value={editing.shortName} onChange={e => setEditing({ ...editing, shortName: e.target.value })} placeholder="留空时显示完整名称" maxLength={80} /></label>
        <label className="editor-name">产品名称<input className="field-input" value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} maxLength={240} placeholder="完整产品名称" /></label>
        <label>规格<input className="field-input" value={editing.specification} onChange={e => setEditing({ ...editing, specification: e.target.value })} placeholder="例如 5mg*10vials" maxLength={160} /></label>
        <label>品类<input className="field-input" value={editing.category} onChange={e => setEditing({ ...editing, category: e.target.value })} maxLength={80} /></label>
        <label>计价单位<input className="field-input" value={editing.unit} onChange={e => setEditing({ ...editing, unit: e.target.value })} placeholder="例如 盒" maxLength={16} /></label>
        <label>销售价（元 / {editing.unit || '单位'}）<input className="field-input" value={editing.price} onChange={e => setEditing({ ...editing, price: e.target.value })} inputMode="decimal" placeholder="留空为待录入，填 0 才是零元" /></label>
      </fieldset><p className="quiet-note">改规格或单位后，已有成本会变为待确认，不会自动套用。已生成的报价保留当时的单价和单位。</p></section>
      : preview && props.canEditMaster ? <section className="import-preview"><div className="import-result-heading"><FileSpreadsheet size={27} /><div><h3>{fileName}</h3><p>识别 {preview.products.length} 条规格 · {preview.sheetCount} 个工作表</p></div></div>
        <p className="import-notice">这是商品资料导入，会更新名称和规格。价格导入请用“导入价格”，两种价格分开映射。</p>
        <div className="catalog-table-scroll preview-scroll"><Table><TableHeader><TableRow><TableHead>商品</TableHead><TableHead>规格</TableHead><TableHead>销售价</TableHead></TableRow></TableHeader><TableBody>{preview.products.map(p => <TableRow key={p.id}><TableCell><div className="catalog-product-name"><strong>{productDisplayName(p)}</strong></div></TableCell><TableCell>{p.specification || '未填写规格'}</TableCell><TableCell className="catalog-price">{p.price ? `¥${p.price}/${p.unit}` : '待录入'}</TableCell></TableRow>)}</TableBody></Table></div>
      </section> : compareOpen ? <section className="comparison-view"><div className="catalog-toolbar"><label className="catalog-search"><Search size={18} /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索对比商品" aria-label="搜索对比商品" /></label><button type="button" className="secondary-button" onClick={() => setCompareOpen(false)}>返回商品库</button><button type="button" className="primary-button" onClick={exportComparison}>导出内部对比</button></div>
        <p className="quiet-note">只比较同一商品、同一规格和单位的人民币单价，不是订单利润。数据截至 {props.updatedAt ? new Date(props.updatedAt).toLocaleString('zh-CN', { hour12: false }) : '尚未同步'}。导出文件包含内部成本。</p>
        <div className="filter-row" role="group" aria-label="对比筛选">{[['all', '全部'], ['missing', '缺成本'], ['pending', '待确认'], ['above', '成本高于售价']].map(([id, label]) => <button type="button" key={id} aria-pressed={compareFilter === id} onClick={() => setCompareFilter(id)}>{label}</button>)}</div>
        <div className="comparison-list">{compared.filter(row => searchProducts([row.product], query).length).map(row => <article className="comparison-card" key={row.product.id}><header><strong>{productDisplayName(row.product)}</strong><span>{comparisonStatusLabel(row.compared)}</span></header><p>{row.product.specification || '未填规格'} · {row.product.unit}</p><dl><div><dt>销售价</dt><dd>{row.product.salesPrice ? `¥${row.product.salesPrice}` : '—'}</dd></div><div><dt>成本价</dt><dd>{row.product.costStatus === 'pending' ? '待确认' : row.product.costStatus === 'error' ? '加载失败' : row.product.costPrice ? `¥${row.product.costPrice}` : '—'}</dd></div><div><dt>价差</dt><dd>{formatCents(row.compared.diffCents) ?? '—'}</dd></div><div><dt>价差率</dt><dd>{row.compared.rate ? `${row.compared.rate}%` : '—'}</dd></div></dl><button type="button" className="text-button" onClick={() => openPrice(row.product, props.priceType)}>编辑价格</button></article>)}</div>
      </section> : importOpen ? <section className="import-preview"><button className="text-button" onClick={() => { setImportOpen(false); setRawRows(null); setError(''); }}>返回商品库</button>
        <fieldset className="import-target"><legend>导入目标</legend>{([['sales', '销售价'], ['cost', '成本价'], ['both', '双价']] as const).map(([id, label]) => <label key={id}><input type="radio" name="import-target" checked={importTarget === id} onChange={() => { setImportTarget(id); setRawRows(null); }} />{label}</label>)}</fieldset>
        <p className="quiet-note">先选目标再映射列。不会因为当前是{props.priceType === 'cost' ? '成本' : '销售'}账号就猜价格列。空白单元格保留原价，不会清空。</p>
        <label className="include-prices"><input type="checkbox" checked={includePrices} onChange={e => setIncludePrices(e.target.checked)} />模板带出当前{importTarget === 'sales' ? '销售价' : importTarget === 'cost' ? '成本价' : '两种价格'}。成本不会用销售价预填。</label>
        <div className="import-actions"><button type="button" className="secondary-button" onClick={() => downloadText(includePrices ? '价格模板_含当前价格.csv' : '价格模板.csv', priceTemplateCsv(known, importTarget, includePrices))}>下载模板</button><button type="button" className="primary-button" onClick={() => document.getElementById('price-file')?.click()}>{reading ? '正在读取' : '选择表格'}</button></div>
        <input id="price-file" type="file" accept=".xlsx,.xls,.csv" hidden aria-label="选择价格表" onChange={e => void readPriceFile(e.target.files?.[0])} />
        {rawRows && <div className="price-preview-list">{importRows.map((row, index) => <article className="price-preview-card" key={`${row.sheet}-${row.row}-${index}`}><header><strong>{fileName} · 第 {row.row} 行</strong><span>{row.status}</span></header><p>{row.reason}</p>{row.sales && <p>销售价 {row.sales.before ?? '空'} → {row.sales.after}{row.sales.zero ? '（零元）' : ''}</p>}{row.cost && <p>成本价 {row.cost.before ?? '空'} → {row.cost.after}{row.cost.zero ? '（零元）' : ''}{row.cost.reconfirm ? '（重新确认）' : ''}</p>}{row.suggestions.length > 0 && <label>手动匹配<select className="field-input" value={row.productId} onChange={e => setRawRows(rows => rows?.map((item, itemIndex) => itemIndex === index ? { ...item, productId: e.target.value } : item) ?? null)}><option value="">选择商品</option>{row.suggestions.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>}{(row.status === 'unmatched' || row.status === 'review') && <button type="button" className="text-button" onClick={() => openCreate({ shortName: rawRows[index]?.shortName ?? '', name: rawRows[index]?.name ?? '', specification: rawRows[index]?.specification ?? '', category: '未分类', unit: rawRows[index]?.unit || '盒', salesPrice: rawRows[index]?.salesRaw ?? '', costPrice: rawRows[index]?.costRaw ?? '' })}>新增商品并保存</button>}</article>)}<label className="include-prices"><input type="checkbox" checked={skipProblems} onChange={e => setSkipProblems(e.target.checked)} />跳过问题行，只提交已确认的价格</label></div>}
      </section> : <>
        <div className="catalog-toolbar"><label className="catalog-search"><Search size={18} /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索简称、名称或规格" aria-label="搜索简称、名称或规格" /></label><button type="button" className="secondary-button" onClick={() => openCreate()} disabled={!canEdit}><Plus size={16} />新增商品</button><button type="button" className="primary-button" onClick={() => { setImportOpen(true); setError(''); }} disabled={!canEdit}>导入价格</button></div>
        <div className="catalog-secondary-actions"><button type="button" className="text-button" onClick={() => setCompareOpen(true)}>售价对比</button>{props.canEditMaster && <button type="button" className="text-button" onClick={() => fileInput.current?.click()} disabled={!canEdit}>{reading ? '正在读取' : '导入商品资料'}</button>}</div>
        <input type="file" accept=".xlsx,.xls,.csv" ref={fileInput} hidden aria-label="选择商品价格表" onChange={e => void readFile(e.target.files?.[0])} />
        <div className="filter-row" role="group" aria-label="价格筛选">{([['all', '全部'], ['sales-missing', '售价待录入'], ['cost-missing', '成本待录入'], ['pending', '待确认']] as const).map(([id, label]) => <button type="button" key={id} aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}</button>)}</div>
        <p className="catalog-count">{query || filter !== 'all' ? `找到 ${visible.length} 条规格` : `共 ${props.products.length} 条规格`}</p>
        {hiddenNew && <p className="quiet-note">新商品已保存，但当前筛选把它藏起来了。<button type="button" className="text-button" onClick={() => { setFilter('all'); setQuery(''); setShowHidden(false); }}>查看新商品</button></p>}
        {!props.ready && !props.cloudError ? <div className="catalog-loading"><LoaderCircle className="animate-spin" />加载云端商品库</div> : visible.length === 0 ? <div className="catalog-empty"><FileSpreadsheet size={32} /><h3>{query || filter !== 'all' ? '没有找到相关商品' : '还没有商品'}</h3><div className="import-actions"><button type="button" className="secondary-button" onClick={() => { setQuery(''); setFilter('all'); }}>清除筛选</button><button type="button" className="secondary-button" onClick={() => void sync()}>重新同步</button><button type="button" className="primary-button" onClick={() => openCreate()}>新增商品</button></div></div> : <div className="catalog-table-scroll"><Table><TableHeader><TableRow><TableHead>简称 / 名称</TableHead><TableHead>规格 / 品类</TableHead><TableHead>销售价 / 成本价</TableHead><TableHead><span className="sr-only">操作</span></TableHead></TableRow></TableHeader><TableBody>{visible.map(p => <TableRow key={p.id} data-highlight={p.id === highlight} className={p.id === highlight ? 'is-highlight' : undefined}><TableCell><div className="catalog-product-name"><strong>{productDisplayName(p)}</strong>{productSecondaryName(p) && <span>{productSecondaryName(p)}</span>}</div></TableCell><TableCell><div className="catalog-product-spec"><span>{p.specification || '未填规格'}</span><small>{p.category}</small></div></TableCell><TableCell className="catalog-price"><div className="price-pair"><button type="button" onClick={() => openPrice(p, 'sales')} disabled={!canEdit}><small>销售价</small><strong>{salesText(p)}</strong></button><button type="button" onClick={() => openPrice(p, 'cost')} disabled={!canEdit}><small>成本价</small><strong>{costText(p)}</strong></button></div></TableCell><TableCell><div className="catalog-row-actions"><button className="text-button" onClick={() => openPrice(p, props.priceType)} disabled={!canEdit}>编辑价格</button>{props.canEditMaster && <button className="icon-button" aria-label={`编辑 ${productDisplayName(p)} ${p.specification}`} onClick={() => { setEditing({ id: p.id, shortName: p.shortName, name: p.name, specification: p.specification, category: p.category, unit: p.unit, price: p.salesPrice ?? p.price, aliases: p.aliases }); setEditingBase({ id: p.id, shortName: p.shortName, name: p.name, specification: p.specification, category: p.category, unit: p.unit, price: p.salesPrice ?? p.price, aliases: p.aliases }); setError(''); }} disabled={!canEdit}><Pencil size={16} /></button>}{props.canEditMaster && <button className="icon-button" aria-label={`删除 ${productDisplayName(p)} ${p.specification}`} onClick={() => setPendingDelete(p)} disabled={!canEdit}><Trash2 size={16} /></button>}</div></TableCell></TableRow>)}</TableBody></Table></div>}
      </>}
      {error && <p role="alert" className="field-error">{error}</p>}
    </div>
    {(editing || preview || (importOpen && rawRows)) && <div className="catalog-footer">{editing ? <button className="primary-button editor-save" onClick={() => void saveEditor()} disabled={!canEdit}><Check size={17} />{props.saving ? '正在保存…' : '保存商品到云端'}</button> : preview ? <div className="import-actions"><button className="secondary-button" onClick={() => { setPreview(null); setError(''); }} disabled={props.saving || syncing}>取消</button><button className="primary-button" onClick={() => void confirmImport()} disabled={!canEdit}><Upload size={17} />{props.saving ? '正在保存…' : `导入 ${preview.products.length} 项`}</button></div> : <div className="import-actions"><button className="secondary-button" onClick={() => { setRawRows(null); setError(''); }}>取消导入</button><button className="primary-button" onClick={() => void commitPriceImport()} disabled={!canEdit}>确认导入</button></div>}</div>}
  </DialogContent></Dialog>
  <Dialog open={creating} onOpenChange={open => { if (!open && !createDirty) setCreating(false); if (!open && createDirty) setError('还有未保存的新商品。请先保存或清空表单。'); }}><DialogContent className="price-dialog"><DialogTitle>新增商品</DialogTitle><DialogDescription>商品和填写的价格会同步到两个账号。留空是待录入，填 0 才是零元。保存不会切换账号。</DialogDescription>
    <div className="product-editor-grid"><label>产品简称<input className="field-input" value={draft.shortName} onChange={e => setDraft({ ...draft, shortName: e.target.value })} /></label><label>产品名称<input className="field-input" aria-label="产品名称" value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} /></label><label>规格<input className="field-input" aria-label="规格" value={draft.specification} onChange={e => setDraft({ ...draft, specification: e.target.value })} /></label><label>品类<input className="field-input" aria-label="品类" value={draft.category} onChange={e => setDraft({ ...draft, category: e.target.value })} /></label><label>计价单位<input className="field-input" aria-label="计价单位" value={draft.unit} onChange={e => setDraft({ ...draft, unit: e.target.value })} /></label><label>销售价（元 / {draft.unit || '单位'}）<input className="field-input" aria-label="销售价" inputMode="decimal" value={draft.salesPrice} onChange={e => setDraft({ ...draft, salesPrice: e.target.value })} placeholder="可留空" /></label><label>成本价（元 / {draft.unit || '单位'}）<input className="field-input" aria-label="成本价" inputMode="decimal" value={draft.costPrice} onChange={e => setDraft({ ...draft, costPrice: e.target.value })} placeholder="可留空" /></label></div>
    {error && <p role="alert" className="field-error">{error}</p>}<div className="catalog-footer"><button type="button" className="secondary-button" onClick={() => { setDraft(draftBase); setCreating(false); setError(''); }}>取消</button><button type="button" className="primary-button" onClick={() => void saveCreate()} disabled={!canEdit || (!props.costAvailable && draft.costPrice.trim() !== '')}>保存商品</button></div>
  </DialogContent></Dialog>
  <Dialog open={priceRow !== null} onOpenChange={open => { if (open || !priceRow) return; if (!priceDirty) setPriceRow(null); else setError('价格已修改。请保存、清空修改，或继续编辑。'); }}><DialogContent className="price-dialog"><DialogTitle>编辑价格</DialogTitle><DialogDescription>商品资料只读。只提交改过的价格；未改的价格不会覆盖另一边刚保存的值。</DialogDescription>
    {priceRow && <div className="price-identity"><strong>{productDisplayName(priceRow)}</strong><span>{priceRow.name}</span><span>{priceRow.specification || '未填规格'} · {priceRow.unit}</span></div>}
    {queue.length > 0 && priceRow && <p className="quiet-note">已完成 {Math.max(0, queue.indexOf(priceRow.id))} 项／剩余 {Math.max(0, queue.length - queue.indexOf(priceRow.id) - 1)} 项</p>}
    <div className="product-editor-grid"><label>销售单价（元 / {priceRow?.unit || '单位'}）<input className="field-input" aria-label="销售单价" inputMode="decimal" autoFocus={priceFocus === 'sales'} value={priceDraft.sales} onChange={e => setPriceDraft({ ...priceDraft, sales: e.target.value })} placeholder="待录入" />{priceRow?.salesUpdatedAt && <small>销售价更新于 {new Date(priceRow.salesUpdatedAt).toLocaleString('zh-CN', { hour12: false })}</small>}</label><label>成本单价（元 / {priceRow?.unit || '单位'}）<input className="field-input" aria-label="成本单价" inputMode="decimal" autoFocus={priceFocus === 'cost'} value={priceDraft.cost} onChange={e => setPriceDraft({ ...priceDraft, cost: e.target.value })} placeholder={priceRow?.costStatus === 'error' ? '加载失败' : '待录入'} disabled={!props.costAvailable} />{priceRow?.costUpdatedAt && <small>成本更新于 {new Date(priceRow.costUpdatedAt).toLocaleString('zh-CN', { hour12: false })}</small>}</label></div>
    {conflicts.length > 0 && <ul className="field-error">{conflicts.map(item => <li key={item.field}>云端{item.field === 'cost' ? '成本' : '销售价'}是 {item.cloud ?? '空'}，本次输入是 {item.typed ?? '空'}。没有自动覆盖。</li>)}</ul>}
    {error && <p role="alert" className="field-error">{error}</p>}
    <div className="catalog-footer price-editor-footer"><button type="button" className="text-button" onClick={() => setClearing('sales')}>清空售价</button><button type="button" className="text-button" onClick={() => setClearing('cost')} disabled={!props.costAvailable}>清空成本</button><button type="button" className="secondary-button" onClick={() => { setPriceDraft(priceBase); setPriceRow(null); setError(''); }}>取消</button><button type="button" className="secondary-button" onClick={() => void savePrice(true)} disabled={!canEdit}>保存并下一条</button><button type="button" className="primary-button" onClick={() => void savePrice(false)} disabled={!canEdit}>保存</button></div>
  </DialogContent></Dialog>
  <AlertDialog open={pendingDelete !== null} onOpenChange={open => { if (!open && !props.saving) setPendingDelete(null); }}><AlertDialogContent><AlertDialogTitle>删除这个商品？</AlertDialogTitle><AlertDialogDescription>将从两个工作台移除{pendingDelete ? `「${productDisplayName(pendingDelete)}${pendingDelete.specification ? ` · ${pendingDelete.specification}` : ''}」` : '该商品'}。这不是清空价格。已生成的报价仍保留当时的名称、单位和单价。若另一台设备刚保存过，需要先同步再删。</AlertDialogDescription><AlertDialogFooter><AlertDialogCancel disabled={props.saving}>取消</AlertDialogCancel><AlertDialogAction variant="destructive" type="button" disabled={props.saving || !canEdit} onClick={() => void confirmDelete()}>{props.saving ? '正在删除…' : '删除商品'}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  <AlertDialog open={clearing !== null} onOpenChange={open => { if (!open) setClearing(null); }}><AlertDialogContent><AlertDialogTitle>{clearing === 'cost' ? '清空成本？' : '清空售价？'}</AlertDialogTitle><AlertDialogDescription>只把这一项价格改为待录入，不删除商品，另一种价格保持不变。</AlertDialogDescription><AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel><AlertDialogAction type="button" onClick={() => void clearPrice()}>确认清空</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </>;
}
