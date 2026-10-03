'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, ChevronDown, Check, CheckCheck, CircleHelp, Copy, Download, FileText, Layers3, ListChecks, Minus, Package, Plus, SlidersHorizontal, Sparkles, X, Zap } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogClose } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogContent, AlertDialogTitle, AlertDialogDescription, AlertDialogCancel, AlertDialogAction, AlertDialogFooter } from '@/components/ui/alert-dialog';
import { Toaster, toast } from '@/components/ui/toast';
import { CatalogManager } from '@/components/catalog-manager';
import { useMobileViewport } from '@/hooks/use-mobile-viewport';
import { ProductPicker } from '@/components/product-picker';
import { TypingTitle } from '@/components/typing-title';
import { quoteFilename, rateUnits, usdtAmount } from '@/lib/quote-export';
import { OKX_RATE_PAGE, COINGATE_RATE_URL } from '@/lib/live-rate';
import { parseQuote, summarize, money, moneyCents, quantityValue, lineTotal, issue, quoteText, quoteCsv, productLabel, productDisplayName, MAX_LINES, type Product, type QuoteLine } from '@/lib/pricing';

type CatalogResponse = { ownerId: string; products: Product[]; revision: number; updatedAt: string | null; error?: string };
type Props = { user: { userId: string; displayName: string } };
type RateResponse = { rate: string; updatedAt: string; fetchedAt?: string; source: string; kind: string; sourceUrl: string; warning?: string; error?: string };
const RATE_STORAGE_KEY = 'quickprice:last-usdt-cny-rate';
const RATE_STORAGE_MAX_AGE = 24 * 60 * 60 * 1000;
function storedRate(): RateResponse | null {
  try {
    const value = JSON.parse(localStorage.getItem(RATE_STORAGE_KEY) || 'null') as RateResponse | null;
    const fetched = Date.parse(value?.fetchedAt || value?.updatedAt || '');
    if (!value || typeof value.rate !== 'string' || rateUnits(value.rate) === null || typeof value.source !== 'string' || ![OKX_RATE_PAGE, COINGATE_RATE_URL].includes(value.sourceUrl) || !Number.isFinite(fetched) || fetched > Date.now() + 60000 || Date.now() - fetched > RATE_STORAGE_MAX_AGE) return null;
    return value;
  } catch { return null; }
}
function rememberRate(value: RateResponse) {
  try { localStorage.setItem(RATE_STORAGE_KEY, JSON.stringify(value)); } catch { /* Private browsing may deny storage. */ }
}
export default function QuickPriceApp({ user }: Props) {
  const [products, setProducts] = useState<Product[]>([]);
  const [lines, setLines] = useState<QuoteLine[]>([]);
  const [text, setText] = useState('');
  useMobileViewport();
  const [mode, setMode] = useState('manual');
  const [category, setCategory] = useState('all');
  const [selected, setSelected] = useState('');
  const [addQuantity, setAddQuantity] = useState('1');
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);
  const [exchangeRate, setExchangeRate] = useState('');
  const [rateError, setRateError] = useState(false);
  const [rateLoading, setRateLoading] = useState(true);
  const [rateMessage, setRateMessage] = useState('正在获取最新汇率…');
  const [rateSource, setRateSource] = useState('手动设置');
  const [rateSourceUrl, setRateSourceUrl] = useState(OKX_RATE_PAGE);
  const exchangeRateRef = useRef('');
  const rateRequest = useRef(0);
  const rateAbort = useRef<AbortController | null>(null);
  const refreshRate = useCallback(async (force = false) => {
    const request = ++rateRequest.current;
    rateAbort.current?.abort();
    const controller = new AbortController();
    rateAbort.current = controller;
    const timeout = setTimeout(() => controller.abort(), 9000);
    setRateLoading(true); setRateMessage('正在获取最新汇率…');
    try {
      const response = await fetch(force ? '/api/exchange-rate?refresh=1' : '/api/exchange-rate', { cache: 'no-store', signal: controller.signal });
      const data = await response.json() as RateResponse;
      if (!response.ok || typeof data.rate !== 'string' || rateUnits(data.rate) === null || !Number.isFinite(Date.parse(data.updatedAt)) || ![OKX_RATE_PAGE, COINGATE_RATE_URL].includes(data.sourceUrl)) throw new Error(data.error || '服务器汇率不可用');
      if (request !== rateRequest.current) return;
      exchangeRateRef.current = data.rate; setExchangeRate(data.rate); setRateError(false);
      const source = `${data.source} · ${new Date(data.fetchedAt || data.updatedAt).toLocaleString('zh-CN', { hour12: false })}${data.kind === 'stale' ? ' · 缓存汇率' : ''}`;
      setRateSourceUrl(data.sourceUrl);
      setRateSource(source); setRateMessage(`${source}${data.warning ? ` · ${data.warning}` : ''}`);
      if (data.kind !== 'stale') rememberRate(data);
    } catch {
      if (request === rateRequest.current) {
        const previous = storedRate();
        if (rateUnits(exchangeRateRef.current) === null && previous) {
          exchangeRateRef.current = previous.rate; setExchangeRate(previous.rate);
          setRateSource(`${previous.source} · ${new Date(previous.fetchedAt || previous.updatedAt).toLocaleString('zh-CN', { hour12: false })} · 缓存汇率`);
          setRateSourceUrl(previous.sourceUrl);
        }
        setRateMessage(rateUnits(exchangeRateRef.current) !== null ? '最新汇率暂时不可用，已保留当前汇率；点击“最新”重试。' : '最新汇率暂时不可用，请手动填写或点击“最新”重试。');
      }
    } finally {
      clearTimeout(timeout);
      if (request === rateRequest.current) setRateLoading(false);
    }
  }, []);
  useEffect(() => {
    const previous = storedRate();
    if (previous) {
      exchangeRateRef.current = previous.rate; setExchangeRate(previous.rate); setRateSource(`${previous.source} · ${new Date(previous.fetchedAt || previous.updatedAt).toLocaleString('zh-CN', { hour12: false })} · 缓存汇率`); setRateSourceUrl(previous.sourceUrl); setRateMessage('已使用上次成功汇率，正在刷新最新行情…');
    }
    void refreshRate();
    return () => { rateRequest.current++; rateAbort.current?.abort(); };
  }, [refreshRate]);
  const updateRate = (value: string) => {
    rateRequest.current++;
    rateAbort.current?.abort();
    exchangeRateRef.current = value; setExchangeRate(value); setRateError(false);
    setRateLoading(false); setRateSource('手动设置'); setRateMessage('手动汇率 · 点击“最新”可恢复行情');
  };
  const [inputError, setInputError] = useState('');
  const [isExample, setIsExample] = useState(false);
  const [ready, setReady] = useState(false);
  const [revision, setRevision] = useState(0);
  const [ownerId, setOwnerId] = useState('');
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [cloudError, setCloudError] = useState('');
  const [saving, setSaving] = useState(false);
  const refreshCatalog = useCallback(async () => {
    try {
      const response = await fetch('/api/catalog', { cache: 'no-store' });
      const data = await response.json() as CatalogResponse;
      if (response.status === 401) { window.location.replace('/login'); return; }
      if (!response.ok) throw new Error(data.error || '商品库加载失败。');
      if (data.ownerId !== user.userId) throw new Error('登录账号已改变，请刷新页面后重新加载对应商品库。');
      setOwnerId(data.ownerId);
      setProducts(data.products); setCategory(current => current === 'all' || data.products.some(p => p.category === current) ? current : 'all'); setRevision(data.revision); setUpdatedAt(data.updatedAt); setReady(true); setCloudError('');
      setSelected(current => data.products.some((p: Product) => p.id === current) ? current : data.products[0]?.id ?? '');
    return data.products;
    } catch (e) { setCloudError((e as Error).message); setReady(false); return undefined; }
  }, [user]);
  useEffect(() => { const pending = setTimeout(() => { void refreshCatalog(); }, 0); return () => clearTimeout(pending); }, [refreshCatalog]);
  const saveCatalog = async (next: Product[]) => {
    if (!ready || ownerId !== user.userId) throw new Error('请先登录并加载云端商品库。');
    setSaving(true);
    try {
      const response = await fetch('/api/catalog', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ products: next, revision, ownerId }) });
      const data = await response.json() as CatalogResponse;
      if (response.status === 401) throw new Error('登录已过期，请重新登录后再保存。');
      if (!response.ok) throw new Error(data.error || '保存失败，请重试。');
      setProducts(data.products); setCategory(current => current === 'all' || data.products.some(p => p.category === current) ? current : 'all'); setRevision(data.revision); setUpdatedAt(data.updatedAt); setCloudError('');
      setSelected(current => data.products.some((p: Product) => p.id === current) ? current : data.products[0]?.id ?? '');
    } finally { setSaving(false); }
  };
  const [loggingOut, setLoggingOut] = useState(false);
  const signOut = async () => {
    setLoggingOut(true);
    try {
      const response = await fetch('/api/auth/logout', { method: 'POST' });
      if (!response.ok) throw new Error('退出失败，请重试。');
      window.location.replace('/login');
    } catch (e) { toast.add({ title: (e as Error).message, type: 'error' }); setLoggingOut(false); }
  };
  const sampleText = products.slice(0, 3).map((p, i) => `${p.name}${p.specification ? ` ${p.specification}` : ''} × ${[10, 5, 2][i]}`).join('\n');
  const id = useRef(0);
  const summary = summarize(lines);
  const categories = Array.from(new Set(products.map(p => p.category)));
  const filteredProducts = products.filter(p => category === 'all' || p.category === category);
  const selectedProduct = filteredProducts.find(p => p.id === selected);
  const selectedCents = selectedProduct ? moneyCents(selectedProduct.price) : null;
  const quantity = quantityValue(addQuantity);
  const entryAmount = selectedCents !== null && quantity !== null ? money(selectedCents * quantity) : null;
  const showResults = () => document.getElementById('quote-results')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const patchLine = (lineId: string, patch: Partial<QuoteLine>) => { setLines(ls => ls.map(l => l.id === lineId ? { ...l, ...patch } : l)); setIsExample(false); };
  const selectProduct = (line: QuoteLine, productId: string) => {
    const product = products.find(p => p.id === productId);
    patchLine(line.id, { productId, price: product?.price ?? '', match: product ? 'manual' : 'none' });
  };
  const calculate = () => {
    if (!text.trim()) { setInputError('请先输入产品型号和数量。'); return; }
    try { const next = parseQuote(text, products); setLines(next); setIsExample(false); setInputError(''); const s = summarize(next); toast.add({ title: `已解析 ${s.count} 项${s.pending ? `，${s.pending} 项需要完善` : '，计价完成'}`, type: s.pending ? 'warning' : 'success' }); }
    catch (error) { setInputError((error as Error).message); }
  };
  const startNewQuote = () => {
    setLines([]);
    setText('');
    setIsExample(false);
    setInputError('');
    setResetOpen(false);
    toast.add({ title: '已新建报价，可以开始添加项目', type: 'success' });
  };
  const addLine = () => {
    if (!selectedProduct || quantityValue(addQuantity) === null) { setInputError('请选择产品，并填写 1–999999 的整数数量。'); return; }
    if (lines.length >= MAX_LINES) { setInputError('每份清单最多支持 200 项。'); return; }
    setLines(ls => [...ls, { id: `manual-${++id.current}`, source: `${productDisplayName(selectedProduct)} × ${addQuantity}`, parsed: selectedProduct.name, productId: selected, quantity: addQuantity, price: selectedProduct.price, match: 'manual' }]); setIsExample(false); setInputError(''); toast.add({ title: `已添加 ${selectedProduct.name} × ${addQuantity}`, type: 'success' });
  };
  const copy = async () => {
    if (rateUnits(exchangeRate) === null) {
      setRateError(true);
      document.getElementById('usdt-rate')?.focus();
      toast.add({ title: '请先填写 USDT 汇率，再复制报价', type: 'warning' });
      return;
    }
    try { await navigator.clipboard.writeText(quoteText(lines, products, exchangeRate, rateSource)); toast.add({ title: '报价已复制，包含 USDT 换算金额', type: 'success' }); }
    catch { setCopyOpen(true); }
  };
  const download = () => {
    if (rateUnits(exchangeRate) === null) {
      setRateError(true); document.getElementById('usdt-rate')?.focus();
      toast.add({ title: '请先填写有效汇率，再导出报价', type: 'warning' }); return;
    }
    const url = URL.createObjectURL(new Blob([quoteCsv(lines, products, exchangeRate, rateSource)], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a'); a.href = url; a.download = quoteFilename(); document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 10000);
    toast.add({ title: '报价已导出，可使用 Excel 打开', type: 'success' });
  };


  return <Toaster>
    <header className="topbar"><div className="nav-inner">
      <a className="brand" href="#main" aria-label="QuickPrice 首页"><span className="brand-icon"><Zap size={23} fill="currentColor" /></span><span>QuickPrice<span className="brand-sub">快速计价助手</span></span></a>
      <div className="nav-actions"><button className="account-link" onClick={() => void signOut()} disabled={loggingOut || saving}>{loggingOut ? '正在退出…' : '退出登录'}</button><button className="nav-button" aria-label="商品价格库" onClick={() => setCatalogOpen(true)}><Package size={17} /><span>商品库</span></button><button className="icon-button help-button" aria-label="使用说明" onClick={() => setHelpOpen(true)}><CircleHelp size={19} /></button></div>
    </div></header>
    <main id="main" className={`workspace ${lines.length ? 'has-lines' : ''}`}>
      <section className="page-heading"><div><div className="workspace-label"><span className="tiny-dot" />药品研发计价工作台</div><h1><span className="desktop-page-title"><TypingTitle text="每一笔，算得清楚。" /></span><span className="mobile-page-title"><TypingTitle text="快速计价" /></span></h1><p>为药物研发团队提供专业、高效的计价服务。</p></div><button className="secondary-button new-quote" onClick={() => setResetOpen(true)}><Plus size={17} />新建报价</button></section>
      <div className="account-banner"><span>云端商品库 · {user.displayName}</span><button className="text-button" onClick={() => setCatalogOpen(true)}>{cloudError ? '加载失败，点击重试' : ready ? `${products.length} 条规格 · 管理商品` : '正在加载…'}</button></div>
      <div className="workspace-grid">
        <aside className="input-column">
          <section className="panel input-panel">
            <div className="panel-heading"><span className="heading-icon"><FileText size={19} /></span><h2>添加计价项目</h2></div>
            <Tabs value={mode} onValueChange={value => { setMode(String(value)); setInputError(''); }}>
              <TabsList className="input-tabs"><TabsTrigger value="manual">手动添加</TabsTrigger><TabsTrigger value="batch">批量输入</TabsTrigger></TabsList>
              <TabsContent value="batch" className="batch-content"><div className="field-caption"><label htmlFor="quote-input">产品简称 / 名称与数量</label><button className="text-button" onClick={() => { setText(sampleText); setInputError(''); }}>填入示例</button></div>
                <textarea id="quote-input" className="quote-textarea" spellCheck={false} value={text} onChange={e => { setText(e.target.value); setInputError(''); }} maxLength={16000} placeholder={'每行一个项目，例如：\nTSM5 × 20\nML10 5件\nNJ100*15'} aria-describedby="input-help" />
                <div className="textarea-caption"><span>一行一项，支持 ×、*、x 和空格</span><span>{text.split(/[\n\r;；,，]+/).filter(x => x.trim()).length} 项</span></div>
                <button className="primary-button calculate-button" onClick={calculate} disabled={!ready}><Sparkles size={18} />解析并计价<ArrowRight size={18} /></button>
                <p id="input-help" className="quiet-note">重新解析将替换当前清单，请先导出需要保留的报价。</p>
              </TabsContent>
              <TabsContent value="manual" className="manual-content"><form className="manual-form" onSubmit={e => { e.preventDefault(); addLine(); }}><div className={`category-field ${categories.length <= 1 ? 'single-category' : ''}`}><label htmlFor="category-select">产品品类</label><Select value={category} onValueChange={value => { const cat = String(value); setCategory(cat); setSelected(products.find(p => cat === 'all' || p.category === cat)?.id ?? ''); }}><SelectTrigger className="field-select" id="category-select" aria-label="产品品类"><SelectValue>{category === 'all' ? '全部品类' : category}</SelectValue></SelectTrigger><SelectContent><SelectItem value="all">全部品类</SelectItem>{categories.map(c => <SelectItem value={c} key={c}>{c}</SelectItem>)}</SelectContent></Select></div>
                <p className="picker-label">选择商品</p><ProductPicker products={filteredProducts} value={selected} onChange={setSelected} label="选择产品，可搜索简称和名称" />
                {selectedProduct && <p className="selected-product-description">{selectedProduct.name}{selectedProduct.specification ? ` · ${selectedProduct.specification}` : ''}</p>}
                <div className="manual-price"><span>参考单价</span><strong>{selectedCents === null ? '待定' : `¥${money(selectedCents)}`}<small> / {selectedProduct?.unit || '件'}</small></strong></div>
                <div className="quantity-heading"><label htmlFor="add-quantity">数量（{selectedProduct?.unit || '件'}）</label><span>本项 <strong>{entryAmount === null ? '待完善' : `¥${entryAmount}`}</strong></span></div><div className="stepper manual-stepper"><button type="button" aria-label="减少添加数量" disabled={(quantity ?? 0) <= 1} onClick={() => setAddQuantity(String(Math.max(1, (quantity ?? 1) - 1)))}><Minus size={18} /></button><input id="add-quantity" inputMode="numeric" enterKeyHint="done" value={addQuantity} aria-invalid={quantity === null} onChange={e => setAddQuantity(e.target.value)} /><button type="button" aria-label="增加添加数量" disabled={(quantity ?? 0) >= 999999} onClick={() => setAddQuantity(String((quantity ?? 0) + 1))}><Plus size={18} /></button></div><div className="quantity-presets" aria-label="常用数量">{[1, 5, 10, 20].map(n => <button type="button" key={n} aria-pressed={addQuantity === String(n)} onClick={() => setAddQuantity(String(n))}>{n}</button>)}</div>
                <button className="primary-button calculate-button" type="submit" disabled={!ready || !selectedProduct}><Plus size={18} />添加到报价</button><p className="quiet-note">添加后可继续选品，或在明细中调整单价。</p></form>
              </TabsContent>
            </Tabs>
            {inputError && <p role="alert" className="field-error">{inputError}</p>}
          </section>
          <div className="tips-block"><span className="tips-icon"><Zap size={17} /></span><div><h3>少一点重复，多一点效率</h3><p>可直接粘贴客户清单。无法识别的型号，手动选一下就好。</p><button className="text-button" onClick={() => setHelpOpen(true)}>查看输入规则 <ArrowRight size={13} /></button></div></div>
          <div className="catalog-shortcut"><span><Package size={16} />{products.length} 条云端商品规格</span><button className="text-button" onClick={() => setCatalogOpen(true)}>管理 <ArrowRight size={13} /></button></div>
        </aside>
        <section id="quote-results" className="results-column" aria-label="计价结果">
          <div className="stats-panel"><div className="stat"><span><Layers3 size={15} />计价项目</span><strong>{summary.count}<small>项</small></strong></div><div className="stat"><span><CheckCheck size={15} />已匹配</span><strong>{summary.matched}<small>项</small></strong></div><div className="stat"><span><ListChecks size={15} />精确匹配</span><strong>{summary.exact}<small>项</small></strong></div><div className="stat"><span><Package size={15} />已计价数量</span><strong>{summary.quantity}<small>总量</small></strong></div></div>
          <section className="panel detail-panel"><div className="details-heading"><div><h2>计价明细 <span className="count-badge">{summary.count}</span></h2><p>{isExample ? '当前为示例报价，可直接编辑体验' : '数量、单价修改后，金额实时更新'}</p></div><button className="text-button" onClick={() => setCatalogOpen(true)}><SlidersHorizontal size={15} /><span>价格库</span></button></div>
            {lines.length > 0 ? <><div className="table-heading" aria-hidden="true"><span>产品描述 / 匹配</span><span>数量</span><span>单价（元）</span><span>金额（元）</span><span /></div>
              <div className="quote-lines">{lines.map((line, index) => { const product = products.find(p => p.id === line.productId); const error = issue(line); const total = lineTotal(line); return <article className={`quote-line ${error ? 'has-issue' : ''}`} key={line.id} aria-label={`第 ${index + 1} 项 ${line.source}`}>
                <div className="product-cell"><span className="row-index">{String(index + 1).padStart(2, '0')}</span><div className="product-control"><div className="source-label"><span title={line.source}>{line.source}</span>{line.productId && <span className="match-indicator" title={line.match === 'exact' ? '型号精确匹配' : '手动选择'}><Check size={11} />{line.match === 'exact' ? '已匹配' : '已选择'}</span>}</div><ProductPicker compact products={products} value={line.productId} onChange={value => selectProduct(line, value)} label={`第 ${index + 1} 项匹配产品，搜索简称或名称`} />{product && <span className="quote-product-description">{productLabel(product)} · {product.unit}</span>}</div></div>
                <div className="quantity-cell"><label className="mobile-label" htmlFor={`qty-${line.id}`}>数量（{product?.unit || '件'}）</label><div className="stepper"><button aria-label={`减少第 ${index + 1} 项数量`} disabled={(quantityValue(line.quantity) ?? 0) <= 1} onClick={() => patchLine(line.id, { quantity: String(Math.max(1, (quantityValue(line.quantity) ?? 1) - 1)) })}><Minus size={12} /></button><input id={`qty-${line.id}`} aria-label={`第 ${index + 1} 项数量`} inputMode="numeric" value={line.quantity} aria-invalid={quantityValue(line.quantity) === null} onChange={e => patchLine(line.id, { quantity: e.target.value })} /><button aria-label={`增加第 ${index + 1} 项数量`} disabled={(quantityValue(line.quantity) ?? 0) >= 999999} onClick={() => patchLine(line.id, { quantity: String((quantityValue(line.quantity) ?? 0) + 1) })}><Plus size={12} /></button></div></div>
                <div className="unit-price-cell"><label className="mobile-label" htmlFor={`price-${line.id}`}>单价（元）</label><input id={`price-${line.id}`} aria-label={`第 ${index + 1} 项单价`} className="price-input" inputMode="decimal" value={line.price} aria-invalid={moneyCents(line.price) === null} placeholder="待填写" onChange={e => patchLine(line.id, { price: e.target.value })} /></div>
                <div className="line-amount"><span className="mobile-label">金额（元）</span><strong>{total === null ? '待完善' : money(total)}</strong></div>
                <button className="remove-line icon-button" aria-label={`删除第 ${index + 1} 项`} onClick={() => { setLines(ls => ls.filter(l => l.id !== line.id)); setIsExample(false); }}><X size={15} /></button>{error && <p className="line-error">{error}</p>}
              </article>; })}</div></> : <div className="empty-state"><FileText size={34} /><h3>新报价，从第一项开始</h3><p>粘贴产品清单，或手动添加产品。</p><button className="text-button" onClick={() => { setText(sampleText); setLines(parseQuote(sampleText, products)); setIsExample(true); }}>使用示例清单 <ArrowRight size={14} /></button></div>}
            <div className="details-footer"><span><span className={`tiny-dot ${summary.pending ? 'pending' : ''}`} />{summary.pending ? `${summary.pending} 项待完善，暂未计入合计` : lines.length ? '所有项目已计价' : '等待添加项目'}</span><button className="text-button" onClick={() => { setMode('manual'); document.querySelector('.input-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}><Plus size={14} />添加项目</button></div>
          </section>
          <section className="total-panel" aria-label="报价汇总"><div className="total-top"><div><h2>{summary.pending ? '已确认金额' : '合计金额'}</h2><p>{summary.count} 项产品<span>·</span>已计价数量 {summary.quantity}</p></div><output className="total-amount" aria-live="polite" aria-atomic="true"><span>¥</span>{summary.safe ? money(summary.cents) : '金额超限'}</output></div><div className="total-bottom"><span><Check size={14} />人民币 CNY · 单价 × 数量</span><span>{summary.pending ? '完善全部项目后可导出' : '核对后即可导出报价'}</span></div></section>
          <div className="action-bar" data-empty={!lines.length}><button type="button" className="mobile-quote-summary" onClick={showResults}><span>{summary.count} 项商品{summary.pending ? ` · ${summary.pending} 项待完善` : ' · 查看明细'}</span><strong>{summary.safe ? `¥${money(summary.cents)}` : '金额超限'}</strong><ChevronDown size={16} /></button><button className="secondary-button copy-button" onClick={copy} disabled={!lines.length || !!summary.pending || !summary.safe}><Copy size={17} />复制报价</button><div className="inline-rate"><label htmlFor="usdt-rate">1 USDT = 人民币</label><div><input id="usdt-rate" inputMode="decimal" autoComplete="off" maxLength={13} placeholder={rateLoading ? "获取中…" : "输入汇率"} value={exchangeRate} onChange={e => updateRate(e.target.value)} aria-invalid={rateError || (!!exchangeRate && rateUnits(exchangeRate) === null)} aria-describedby="rate-hint" /><button type="button" onClick={() => void refreshRate(true)} disabled={rateLoading} aria-label="获取最新 USDT 汇率" aria-busy={rateLoading}>{rateLoading ? "更新中" : "最新"}</button></div></div><button className="primary-button export-button" onClick={download} disabled={!lines.length || !!summary.pending || !summary.safe}><Download size={18} />导出报价<span className="export-format">CSV / Excel</span></button></div>
          <p id="rate-hint" className="rate-status" role="status">{rateError || (!!exchangeRate && rateUnits(exchangeRate) === null) ? '请输入大于 0 的汇率，最多 6 位整数、6 位小数。' : rateMessage} · {summary.safe && usdtAmount(summary.cents, exchangeRate) !== null ? `折合 ${usdtAmount(summary.cents, exchangeRate)} USDT` : '待换算'}<a href={rateSourceUrl} target="_blank" rel="noreferrer">行情来源</a></p>
          <p className="session-note">商品库在云端保存；当前报价为临时清单，离开前请导出。</p>
        </section>
      </div>
      <footer className="page-footer"><span className="footer-brand"><Zap size={13} />QuickPrice</span><span>研发清单，快速算清。</span></footer>
      <nav className="mobile-nav" aria-label="主要导航"><button type="button" className="mobile-nav-item is-active" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}><FileText size={20} /><span>报价</span></button><button type="button" className="mobile-nav-item" onClick={() => setCatalogOpen(true)}><Package size={20} /><span>商品库</span></button><button type="button" className="mobile-nav-item" onClick={() => setHelpOpen(true)}><SlidersHorizontal size={20} /><span>设置</span></button></nav>
    </main>
    <CatalogManager open={catalogOpen} onOpenChange={setCatalogOpen} products={products} ready={ready} saving={saving} cloudError={cloudError} updatedAt={updatedAt} onRefresh={refreshCatalog} onSave={saveCatalog} />
    <Dialog open={helpOpen} onOpenChange={setHelpOpen}><DialogContent className="help-dialog" showCloseButton={false}><div className="dialog-heading"><DialogTitle>快速上手</DialogTitle><DialogClose className="icon-button" aria-label="关闭使用说明"><X size={20} /></DialogClose></div><DialogDescription>从客户清单到报价，只需三个步骤。</DialogDescription><ol className="help-list"><li><strong>输入型号与数量</strong><p>每行一个项目，支持 SM5×20、SM5*20、SM5x20 或 SM5 20盒。也可用分号分隔；逗号会分隔项目，请勿在数字中使用千位分隔符。</p></li><li><strong>核对匹配与单价</strong><p>支持产品简称、完整名称和名称加规格。不区分大小写；同名或同简称有多种规格时，请在匹配框搜索并选择具体规格，系统不会猜测价格。</p></li><li><strong>调整数量，导出报价</strong><p>数量为正整数，单价最多两位小数。金额按分精确计算。全部项目完善后可复制报价或导出 Excel 可打开的 CSV 文件。</p></li></ol></DialogContent></Dialog>
    <AlertDialog open={resetOpen} onOpenChange={setResetOpen}><AlertDialogContent><AlertDialogTitle>开始一份新报价？</AlertDialogTitle><AlertDialogDescription>当前清单和输入内容将清空。需要保留的报价，请先导出。</AlertDialogDescription><AlertDialogFooter><AlertDialogCancel>保留当前报价</AlertDialogCancel><AlertDialogAction type="button" onClick={startNewQuote}>新建报价</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    <Dialog open={copyOpen} onOpenChange={setCopyOpen}><DialogContent><DialogTitle>手动复制报价</DialogTitle><DialogDescription>浏览器未允许自动复制，请长按或全选以下内容复制。</DialogDescription><textarea className="quote-textarea" readOnly value={rateUnits(exchangeRate) !== null ? quoteText(lines, products, exchangeRate, rateSource) : ''} onFocus={e => e.target.select()} aria-label="报价文本" /></DialogContent></Dialog>
  </Toaster>;
}
