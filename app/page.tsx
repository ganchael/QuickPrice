'use client';
import { useRef, useState } from 'react';
import { ArrowRight, Check, CheckCheck, CircleHelp, Copy, Download, FileText, Layers3, ListChecks, Minus, Package, Plus, SlidersHorizontal, Sparkles, X, Zap } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogClose } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogContent, AlertDialogTitle, AlertDialogDescription, AlertDialogCancel, AlertDialogAction, AlertDialogFooter } from '@/components/ui/alert-dialog';
import { Toaster, toast } from '@/components/ui/toast';
import { productsSeed, sampleText, parseQuote, summarize, money, moneyCents, quantityValue, lineTotal, issue, quoteText, quoteCsv, normalize, MAX_LINES, type Product, type QuoteLine } from '@/lib/pricing';

export default function Home() {
  const [products, setProducts] = useState<Product[]>(productsSeed);
  const [lines, setLines] = useState<QuoteLine[]>(() => parseQuote(sampleText, productsSeed));
  const [text, setText] = useState(sampleText);
  const [mode, setMode] = useState('batch');
  const [category, setCategory] = useState('all');
  const [selected, setSelected] = useState('gnd10');
  const [addQuantity, setAddQuantity] = useState('1');
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newCategory, setNewCategory] = useState('');
  const [newPrice, setNewPrice] = useState('');
  const [inputError, setInputError] = useState('');
  const [catalogError, setCatalogError] = useState('');
  const [isExample, setIsExample] = useState(true);
  const id = useRef(0);
  const summary = summarize(lines);
  const categories = Array.from(new Set(products.map(p => p.category)));
  const filteredProducts = products.filter(p => category === 'all' || p.category === category);
  const selectedProduct = products.find(p => p.id === selected);
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
  const addLine = () => {
    if (!selectedProduct || quantityValue(addQuantity) === null) { setInputError('请选择产品，并填写 1–999999 的整数数量。'); return; }
    if (lines.length >= MAX_LINES) { setInputError('每份清单最多支持 200 项。'); return; }
    setLines(ls => [...ls, { id: `manual-${++id.current}`, source: `${selectedProduct.name} × ${addQuantity}`, parsed: selectedProduct.name, productId: selected, quantity: addQuantity, price: selectedProduct.price, match: 'manual' }]); setIsExample(false); setInputError(''); toast.add({ title: `已添加 ${selectedProduct.name} × ${addQuantity}`, type: 'success' });
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(quoteText(lines, products)); toast.add({ title: '报价已复制，可以粘贴发送', type: 'success' }); }
    catch { setCopyOpen(true); }
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([quoteCsv(lines, products)], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a'); a.href = url; a.download = `QuickPrice-报价-${new Date().toISOString().slice(0, 10)}.csv`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 10000);
    toast.add({ title: '报价已导出，可使用 Excel 打开', type: 'success' });
  };
  const addProduct = () => {
    const name = newName.trim(), cat = newCategory.trim();
    if (!name || !cat || moneyCents(newPrice) === null) { setCatalogError('请填写型号、品类和有效单价（最多两位小数）。'); return; }
    if (products.some(p => [p.name, ...p.aliases].some(n => normalize(n) === normalize(name)))) { setCatalogError('该型号已存在，请使用不同型号。'); return; }
    setProducts(ps => [...ps, { id: `custom-${++id.current}`, name, category: cat, price: (moneyCents(newPrice)! / 100).toFixed(2), aliases: [] }]); setNewName(''); setNewCategory(''); setNewPrice(''); setCatalogError(''); toast.add({ title: '产品已添加，本次会话内可用', type: 'success' });
  };

  return <Toaster>
    <header className="topbar"><div className="nav-inner">
      <a className="brand" href="#main" aria-label="QuickPrice 首页"><span className="brand-icon"><Zap size={23} fill="currentColor" /></span><span>QuickPrice<span className="brand-sub">快速计价助手</span></span></a>
      <div className="nav-actions"><button className="nav-button" onClick={() => setCatalogOpen(true)}><Package size={17} /><span>产品价格库</span></button><button className="icon-button help-button" aria-label="使用说明" onClick={() => setHelpOpen(true)}><CircleHelp size={19} /></button></div>
    </div></header>
    <main id="main" className="workspace">
      <section className="page-heading"><div><div className="workspace-label"><span className="tiny-dot" />你的轻量计价工作台</div><h1>每一笔，<span>算得清楚。</span></h1><p>输入清单，即刻匹配。让报价简单一点。</p></div><button className="secondary-button new-quote" onClick={() => setResetOpen(true)}><Plus size={17} />新建报价</button></section>
      <div className="workspace-grid">
        <aside className="input-column">
          <section className="panel input-panel">
            <div className="panel-heading"><span className="heading-icon"><FileText size={19} /></span><h2>添加计价项目</h2></div>
            <Tabs value={mode} onValueChange={value => { setMode(String(value)); setInputError(''); }}>
              <TabsList className="input-tabs"><TabsTrigger value="batch">批量输入</TabsTrigger><TabsTrigger value="manual">手动添加</TabsTrigger></TabsList>
              <TabsContent value="batch" className="batch-content"><div className="field-caption"><label htmlFor="quote-input">产品型号与数量</label><button className="text-button" onClick={() => { setText(sampleText); setInputError(''); }}>填入示例</button></div>
                <textarea id="quote-input" className="quote-textarea" spellCheck={false} value={text} onChange={e => { setText(e.target.value); setInputError(''); }} maxLength={16000} placeholder={'每行一个项目，例如：\nTSM5 × 20\nML10 5件\nNJ100*15'} aria-describedby="input-help" />
                <div className="textarea-caption"><span>一行一项，支持 ×、*、x 和空格</span><span>{text.split(/[\n\r;；,，]+/).filter(x => x.trim()).length} 项</span></div>
                <button className="primary-button calculate-button" onClick={calculate}><Sparkles size={18} />解析并计价<ArrowRight size={18} /></button>
                <p id="input-help" className="quiet-note">重新解析将替换当前清单，请先导出需要保留的报价。</p>
              </TabsContent>
              <TabsContent value="manual" className="manual-content"><label htmlFor="category-select">产品品类</label><Select value={category} onValueChange={value => { const cat = String(value); setCategory(cat); setSelected(products.find(p => cat === 'all' || p.category === cat)?.id ?? ''); }}><SelectTrigger className="field-select" id="category-select" aria-label="产品品类"><SelectValue>{category === 'all' ? '全部品类' : category}</SelectValue></SelectTrigger><SelectContent><SelectItem value="all">全部品类</SelectItem>{categories.map(c => <SelectItem value={c} key={c}>{c}</SelectItem>)}</SelectContent></Select>
                <label htmlFor="manual-product-select">选择产品</label><Select value={selected} onValueChange={value => setSelected(String(value))}><SelectTrigger className="field-select" id="manual-product-select" aria-label="选择产品"><SelectValue>{selectedProduct?.name ?? '选择产品'}</SelectValue></SelectTrigger><SelectContent>{filteredProducts.map(p => <SelectItem key={p.id} value={p.id}>{p.name} · ¥{p.price}</SelectItem>)}</SelectContent></Select>
                <div className="manual-price"><span>参考单价</span><strong>¥{selectedProduct?.price ?? '0.00'}<small> / 件</small></strong></div>
                <label htmlFor="add-quantity">数量</label><input id="add-quantity" className="field-input" inputMode="numeric" value={addQuantity} onChange={e => setAddQuantity(e.target.value)} />
                <button className="primary-button calculate-button" onClick={addLine}><Plus size={18} />添加到报价</button><p className="quiet-note">添加后可在明细中修改本次报价单价。</p>
              </TabsContent>
            </Tabs>
            {inputError && <p role="alert" className="field-error">{inputError}</p>}
          </section>
          <div className="tips-block"><span className="tips-icon"><Zap size={17} /></span><div><h3>少一点重复，多一点效率</h3><p>可直接粘贴客户清单。无法识别的型号，手动选一下就好。</p><button className="text-button" onClick={() => setHelpOpen(true)}>查看输入规则 <ArrowRight size={13} /></button></div></div>
          <div className="catalog-shortcut"><span><Package size={16} />{products.length} 款示例及自定义产品</span><button className="text-button" onClick={() => setCatalogOpen(true)}>管理 <ArrowRight size={13} /></button></div>
        </aside>
        <section className="results-column" aria-label="计价结果">
          <div className="stats-panel"><div className="stat"><span><Layers3 size={15} />计价项目</span><strong>{summary.count}<small>项</small></strong></div><div className="stat"><span><CheckCheck size={15} />已匹配</span><strong>{summary.matched}<small>项</small></strong></div><div className="stat"><span><ListChecks size={15} />精确匹配</span><strong>{summary.exact}<small>项</small></strong></div><div className="stat"><span><Package size={15} />已计价数量</span><strong>{summary.quantity}<small>件</small></strong></div></div>
          <section className="panel detail-panel"><div className="details-heading"><div><h2>计价明细 <span className="count-badge">{summary.count}</span></h2><p>{isExample ? '当前为示例报价，可直接编辑体验' : '数量、单价修改后，金额实时更新'}</p></div><button className="text-button" onClick={() => setCatalogOpen(true)}><SlidersHorizontal size={15} /><span>价格库</span></button></div>
            {lines.length > 0 ? <><div className="table-heading" aria-hidden="true"><span>产品描述 / 匹配</span><span>数量</span><span>单价（元）</span><span>金额（元）</span><span /></div>
              <div className="quote-lines">{lines.map((line, index) => { const product = products.find(p => p.id === line.productId); const error = issue(line); const total = lineTotal(line); return <article className={`quote-line ${error ? 'has-issue' : ''}`} key={line.id} aria-label={`第 ${index + 1} 项 ${line.source}`}>
                <div className="product-cell"><span className="row-index">{String(index + 1).padStart(2, '0')}</span><div className="product-control"><div className="source-label"><span title={line.source}>{line.source}</span>{line.productId && <span className="match-indicator" title={line.match === 'exact' ? '型号精确匹配' : '手动选择'}><Check size={11} />{line.match === 'exact' ? '已匹配' : '已选择'}</span>}</div><Select value={line.productId || '__none'} onValueChange={value => selectProduct(line, value === '__none' ? '' : String(value))}><SelectTrigger className="product-select" aria-label={`第 ${index + 1} 项匹配产品`}><SelectValue>{product?.name ?? '请选择匹配产品'}</SelectValue></SelectTrigger><SelectContent><SelectItem value="__none">暂不匹配</SelectItem>{products.map(p => <SelectItem key={p.id} value={p.id}>{p.name} · ¥{p.price}</SelectItem>)}</SelectContent></Select></div></div>
                <div className="quantity-cell"><label className="mobile-label" htmlFor={`qty-${line.id}`}>数量</label><div className="stepper"><button aria-label={`减少第 ${index + 1} 项数量`} disabled={(quantityValue(line.quantity) ?? 0) <= 1} onClick={() => patchLine(line.id, { quantity: String(Math.max(1, (quantityValue(line.quantity) ?? 1) - 1)) })}><Minus size={12} /></button><input id={`qty-${line.id}`} aria-label={`第 ${index + 1} 项数量`} inputMode="numeric" value={line.quantity} aria-invalid={quantityValue(line.quantity) === null} onChange={e => patchLine(line.id, { quantity: e.target.value })} /><button aria-label={`增加第 ${index + 1} 项数量`} disabled={(quantityValue(line.quantity) ?? 0) >= 999999} onClick={() => patchLine(line.id, { quantity: String((quantityValue(line.quantity) ?? 0) + 1) })}><Plus size={12} /></button></div></div>
                <div className="unit-price-cell"><label className="mobile-label" htmlFor={`price-${line.id}`}>单价（元）</label><input id={`price-${line.id}`} aria-label={`第 ${index + 1} 项单价`} className="price-input" inputMode="decimal" value={line.price} aria-invalid={moneyCents(line.price) === null} placeholder="待填写" onChange={e => patchLine(line.id, { price: e.target.value })} /></div>
                <div className="line-amount"><span className="mobile-label">金额（元）</span><strong>{total === null ? '待完善' : money(total)}</strong></div>
                <button className="remove-line icon-button" aria-label={`删除第 ${index + 1} 项`} onClick={() => { setLines(ls => ls.filter(l => l.id !== line.id)); setIsExample(false); }}><X size={15} /></button>{error && <p className="line-error">{error}</p>}
              </article>; })}</div></> : <div className="empty-state"><FileText size={34} /><h3>新报价，从第一项开始</h3><p>粘贴产品清单，或手动添加产品。</p><button className="text-button" onClick={() => { setText(sampleText); setLines(parseQuote(sampleText, products)); setIsExample(true); }}>使用示例清单 <ArrowRight size={14} /></button></div>}
            <div className="details-footer"><span><span className={`tiny-dot ${summary.pending ? 'pending' : ''}`} />{summary.pending ? `${summary.pending} 项待完善，暂未计入合计` : lines.length ? '所有项目已计价' : '等待添加项目'}</span><button className="text-button" onClick={() => { setMode('manual'); document.querySelector('.input-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}><Plus size={14} />添加项目</button></div>
          </section>
          <section className="total-panel" aria-label="报价汇总"><div className="total-top"><div><h2>{summary.pending ? '已确认金额' : '合计金额'}</h2><p>{summary.count} 项产品<span>·</span>{summary.quantity} 件已计价</p></div><output className="total-amount" aria-live="polite" aria-atomic="true"><span>¥</span>{summary.safe ? money(summary.cents) : '金额超限'}</output></div><div className="total-bottom"><span><Check size={14} />人民币 CNY · 单价 × 数量</span><span>{summary.pending ? '完善全部项目后可导出' : '核对后即可导出报价'}</span></div></section>
          <div className="action-bar"><button className="secondary-button copy-button" onClick={copy} disabled={!lines.length || !!summary.pending || !summary.safe}><Copy size={17} />复制报价</button><button className="primary-button export-button" onClick={download} disabled={!lines.length || !!summary.pending || !summary.safe}><Download size={18} />导出报价<span className="export-format">CSV / Excel</span></button></div>
          <p className="session-note">示例价格仅供体验，请按实际价格调整。数据仅在本次页面中使用，离开前请导出。</p>
        </section>
      </div>
      <footer className="page-footer"><span className="footer-brand"><Zap size={13} />QuickPrice</span><span>简单输入，清晰报价。</span></footer>
    </main>
    <Dialog open={catalogOpen} onOpenChange={setCatalogOpen}><DialogContent className="catalog-dialog" showCloseButton={false}><div className="dialog-heading"><div><DialogTitle>产品价格库</DialogTitle><DialogDescription>示例产品可调整价格，也可添加自己的品类和型号。</DialogDescription></div><DialogClose className="icon-button" aria-label="关闭价格库"><X size={20} /></DialogClose></div><div className="catalog-list">{products.map(p => <div className="catalog-row" key={p.id}><div><strong>{p.name}</strong><span>{p.category}</span></div><label><span>¥</span><input aria-label={`${p.name} 目录单价`} inputMode="decimal" value={p.price} aria-invalid={moneyCents(p.price) === null} onChange={e => setProducts(ps => ps.map(item => item.id === p.id ? { ...item, price: e.target.value } : item))} /></label></div>)}</div><p className="quiet-note">目录调整用于后续添加及重新匹配；已有报价保留当前单价。更换匹配产品时使用目录单价。</p><div className="new-product-form"><h3><Plus size={16} />添加自定义产品</h3><div className="new-product-fields"><label>产品型号<input className="field-input" value={newName} onChange={e => setNewName(e.target.value)} placeholder="例如 RT5" maxLength={40} /></label><label>所属品类<input className="field-input" value={newCategory} onChange={e => setNewCategory(e.target.value)} placeholder="例如 标准配件" maxLength={24} /></label><label>单价（元）<input className="field-input" inputMode="decimal" value={newPrice} onChange={e => setNewPrice(e.target.value)} placeholder="0.00" /></label></div>{catalogError && <p role="alert" className="field-error">{catalogError}</p>}<button className="primary-button" onClick={addProduct}>添加产品</button></div><p className="quiet-note">价格库改动仅在本次会话内生效。</p></DialogContent></Dialog>
    <Dialog open={helpOpen} onOpenChange={setHelpOpen}><DialogContent className="help-dialog" showCloseButton={false}><div className="dialog-heading"><DialogTitle>快速上手</DialogTitle><DialogClose className="icon-button" aria-label="关闭使用说明"><X size={20} /></DialogClose></div><DialogDescription>从客户清单到报价，只需三个步骤。</DialogDescription><ol className="help-list"><li><strong>输入型号与数量</strong><p>每行一个项目，支持 TSM5×20、TSM5*20、TSM5x20 或 TSM5 20件。也可用分号分隔；逗号会分隔项目，请勿在数字中使用千位分隔符。</p></li><li><strong>核对匹配与单价</strong><p>不区分大小写，支持全角字符。ML10 和 MT2 均对应 ML10/MT2；其他未知型号需要手动选择，系统不会猜测价格。</p></li><li><strong>调整数量，导出报价</strong><p>数量为正整数，单价最多两位小数。金额按分精确计算。全部项目完善后可复制报价或导出 Excel 可打开的 CSV 文件。</p></li></ol></DialogContent></Dialog>
    <AlertDialog open={resetOpen} onOpenChange={setResetOpen}><AlertDialogContent><AlertDialogTitle>开始一份新报价？</AlertDialogTitle><AlertDialogDescription>当前清单和输入内容将清空。需要保留的报价，请先导出。</AlertDialogDescription><AlertDialogFooter><AlertDialogCancel>保留当前报价</AlertDialogCancel><AlertDialogAction onClick={() => { setLines([]); setText(''); setIsExample(false); setInputError(''); setResetOpen(false); }}>新建报价</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    <Dialog open={copyOpen} onOpenChange={setCopyOpen}><DialogContent><DialogTitle>手动复制报价</DialogTitle><DialogDescription>浏览器未允许自动复制，请长按或全选以下内容复制。</DialogDescription><textarea className="quote-textarea" readOnly value={quoteText(lines, products)} onFocus={e => e.target.select()} aria-label="报价文本" /></DialogContent></Dialog>
  </Toaster>;
}
