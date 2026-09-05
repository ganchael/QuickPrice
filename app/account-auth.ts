import { cookies } from 'next/headers';
import { env } from 'cloudflare:workers';
import { getCatalogDatabase } from '@/db';
import { hex, tokenHash, verifyPassword } from '@/lib/auth-crypto';

export const ACCOUNT_ID = 'account:888';
export const ACCOUNT_NAME = '888';
export const SESSION_COOKIE = 'quickprice_session';
const SESSION_SECONDS = 7 * 24 * 60 * 60;
export async function getAccountUser() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const session = await getCatalogDatabase().prepare('SELECT user_id FROM auth_sessions WHERE token_hash = ? AND expires_at > ?').bind(await tokenHash(token), Date.now()).first<{ user_id: string }>();
  return session?.user_id === ACCOUNT_ID ? { userId: ACCOUNT_ID, displayName: ACCOUNT_NAME } : null;
}
export function isSameOrigin(request: Request): boolean {
  return request.headers.get('origin') === new URL(request.url).origin && request.headers.get('sec-fetch-site') !== 'cross-site';
}
export function authJson(body: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie', ...extraHeaders } });
}
export async function checkCredentials(username: string, password: string) {
  const record = env.QUICKPRICE_PASSWORD_RECORD;
  if (!record) throw new Error('Login configuration unavailable');
  const valid = await verifyPassword(password, record);
  return username === ACCOUNT_NAME && valid;
}
export async function consumeLoginAttempt(request: Request) {
  const key = await tokenHash(`login:${request.headers.get('cf-connecting-ip') || 'unknown'}`);
  const now = Date.now(), reset = now + 15 * 60 * 1000;
  const result = await getCatalogDatabase().prepare(`INSERT INTO login_attempts (attempt_key, attempts, reset_at) VALUES (?, 1, ?)
    ON CONFLICT(attempt_key) DO UPDATE SET attempts = CASE WHEN reset_at <= ? THEN 1 ELSE attempts + 1 END,
    reset_at = CASE WHEN reset_at <= ? THEN excluded.reset_at ELSE reset_at END RETURNING attempts, reset_at`).bind(key, reset, now, now).first<{ attempts: number; reset_at: number }>();
  if (!result) throw new Error('Login attempts unavailable');
  return { key, allowed: result.attempts <= 10, retryAfter: Math.max(1, Math.ceil((result.reset_at - now) / 1000)) };
}
function cookieValue(request: Request, value: string, maxAge: number) {
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`;
}
export async function startSession(request: Request, attemptKey: string) {
  const db = getCatalogDatabase(), token = hex(crypto.getRandomValues(new Uint8Array(32))), now = Date.now();
  const old = (await cookies()).get(SESSION_COOKIE)?.value;
  const statements = [
    db.prepare('DELETE FROM auth_sessions WHERE expires_at <= ?').bind(now),
    db.prepare('DELETE FROM login_attempts WHERE attempt_key = ? OR reset_at <= ?').bind(attemptKey, now),
    db.prepare('INSERT INTO auth_sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').bind(await tokenHash(token), ACCOUNT_ID, now + SESSION_SECONDS * 1000),
  ];
  if (old && /^[a-f0-9]{64}$/.test(old)) statements.push(db.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').bind(await tokenHash(old)));
  await db.batch(statements);
  return cookieValue(request, token, SESSION_SECONDS);
}
export async function endSession(request: Request) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (token && /^[a-f0-9]{64}$/.test(token)) await getCatalogDatabase().prepare('DELETE FROM auth_sessions WHERE token_hash = ?').bind(await tokenHash(token)).run();
  return cookieValue(request, '', 0);
}
