'use client';
import { useState, type SubmitEvent } from 'react';
import { ArrowRight, LoaderCircle, LockKeyhole, Zap } from 'lucide-react';
export default function LoginForm() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  async function login(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault(); if (pending) return;
    setPending(true); setError('');
    try {
      const response = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || '登录失败，请重试。');
      window.location.replace('/');
    } catch (e) { setError(e instanceof Error ? e.message : '网络连接失败，请重试。'); setPending(false); }
  }
  return <main className="login-page"><div className="login-brand"><span className="brand-icon"><Zap size={26} fill="currentColor" /></span><span>QuickPrice</span></div><section className="login-card"><div className="login-lock"><LockKeyhole size={24} /></div><h1>登录快速计价助手</h1><p className="login-intro">登录后使用商品库和计价工具。</p><form onSubmit={login}><fieldset disabled={pending}><label htmlFor="username">账号<input id="username" className="field-input" name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} required maxLength={80} placeholder="请输入账号" value={username} onChange={e => setUsername(e.target.value)} /></label><label htmlFor="password">密码<input id="password" className="field-input" name="password" type="password" autoComplete="current-password" required maxLength={256} placeholder="请输入密码" value={password} onChange={e => setPassword(e.target.value)} /></label></fieldset>{error && <p className="field-error" role="alert">{error}</p>}<button className="primary-button login-submit" disabled={pending} type="submit">{pending ? <><LoaderCircle size={18} className="animate-spin" />正在登录…</> : <>登录<ArrowRight size={18} /></>}</button></form><p className="login-note">仅限授权账号访问</p></section><p className="login-footer">QuickPrice · 快速计价助手</p></main>;
}
