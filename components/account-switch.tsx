'use client';
import { useState } from 'react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { accountLabel } from '@/lib/accounts';

type Current = { userId: string; displayName: string; priceType: 'sales' | 'cost' };
type Draft = { dirty: boolean; kind: string; save: () => Promise<boolean> };
type Props = { open: boolean; onOpenChange: (open: boolean) => void; current: Current; hasQuote: boolean; draft: Draft; busy: boolean };

export function AccountSwitch(props: Props) {
  const targetName = props.current.displayName === '888' ? '111' : '888';
  const [username, setUsername] = useState(targetName);
  const [password, setPassword] = useState('');
  const [quoteConfirmed, setQuoteConfirmed] = useState(false);
  const [draftChoice, setDraftChoice] = useState<'none' | 'save' | 'discard' | 'cancel'>('none');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const reset = () => { setPassword(''); setQuoteConfirmed(false); setDraftChoice('none'); setError(''); setPending(false); setUsername(props.current.displayName === '888' ? '111' : '888'); };
  const close = () => { if (pending) return; reset(); props.onOpenChange(false); };
  const finish = () => { reset(); window.location.replace('/'); };
  const verify = async () => {
    if (pending || props.busy) return;
    setPending(true); setError('');
    const target = username.trim();
    try {
      const response = await fetch('/api/auth/switch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: target, password }) });
      const data = await response.json() as { error?: string; userId?: string; priceType?: string };
      if (response.ok && data.userId) { finish(); return; }
      setError(data.error || '账号或密码不正确。');
      setPending(false);
    } catch {
      try {
        const session = await fetch('/api/auth/session', { cache: 'no-store' });
        const data = await session.json() as { userId?: string };
        if (session.ok && data.userId && data.userId !== props.current.userId) { finish(); return; }
      } catch { /* keep the current session visible */ }
      setError('网络中断。当前账号和输入仍保留，请重试。');
      setPending(false);
    }
  };
  const saveThenPassword = async () => {
    setPending(true); setError('');
    const ok = await props.draft.save();
    setPending(false);
    if (!ok) { setError('保存失败，已停留在当前账号。'); return; }
    setDraftChoice('save');
  };
  let step: 'quote' | 'draft' | 'password' = 'password';
  if (props.hasQuote && !quoteConfirmed) step = 'quote';
  else if (props.draft.dirty && draftChoice === 'none') step = 'draft';
  return <Dialog open={props.open} onOpenChange={open => { if (!open) close(); }}><DialogContent className="account-switch-dialog">
    <DialogTitle>切换账号</DialogTitle>
    <DialogDescription>当前是{accountLabel(props.current)}。切换需要目标账号密码，不会先退出当前账号。</DialogDescription>
    {step === 'quote' && <div className="switch-step"><p>切换后将清空当前清单，请先复制或导出。</p><div className="import-actions"><button type="button" className="secondary-button" onClick={close}>返回复制或导出</button><button type="button" className="primary-button" onClick={() => setQuoteConfirmed(true)}>确认清空并切换</button></div></div>}
    {step === 'draft' && <div className="switch-step"><p>{props.draft.kind === 'import' ? '导入预览还没提交。可以返回继续导入，或放弃预览后再切换。系统不会自动提交导入。' : '有未保存的商品或价格。可以先保存，或放弃后再切换。'}</p>
      <div className="import-actions">{props.draft.kind === 'import' ? <button type="button" className="secondary-button" onClick={close}>返回完成导入</button> : <button type="button" className="secondary-button" onClick={() => void saveThenPassword()} disabled={pending || props.busy}>保存后继续切换</button>}<button type="button" className="primary-button" onClick={() => setDraftChoice('discard')}>放弃后继续切换</button><button type="button" className="text-button" onClick={close}>取消</button></div>
      {error && <p role="alert" className="field-error">{error}</p>}</div>}
    {step === 'password' && <form className="switch-step" onSubmit={event => { event.preventDefault(); void verify(); }}><label>目标账号<input className="field-input" aria-label="目标账号" value={username} onChange={event => setUsername(event.target.value)} autoComplete="username" /></label><label>目标账号密码<input className="field-input" aria-label="目标账号密码" type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="current-password" /></label>{error && <p role="alert" className="field-error">{error}</p>}<div className="import-actions"><button type="button" className="secondary-button" onClick={close} disabled={pending}>取消</button><button className="primary-button" type="submit" disabled={pending || props.busy || !password}>{pending ? '正在验证…' : '验证并切换'}</button></div></form>}
  </DialogContent></Dialog>;
}
