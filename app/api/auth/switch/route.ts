import { accountByName } from '@/lib/accounts';
import { authJson, checkCredentials, consumeLoginAttempt, getAccountUser, isSameOrigin, startSession } from '@/app/account-auth';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return authJson({ error: '请从本站切换账号。' }, 403);
  const current = await getAccountUser();
  if (!current) return authJson({ error: '请先登录。' }, 401);
  if (!request.headers.get('content-type')?.includes('application/json')) return authJson({ error: '请求格式不正确。' }, 415);
  let username: string, password: string;
  try {
    const body = await request.text();
    if (body.length > 2048) return authJson({ error: '登录信息过长。' }, 413);
    const data = JSON.parse(body);
    if (typeof data?.username !== 'string' || typeof data?.password !== 'string' || !data.password) throw new Error();
    username = data.username.trim(); password = data.password;
  } catch { return authJson({ error: '请填写目标账号和密码。' }, 400); }
  try {
    const attempt = await consumeLoginAttempt(request);
    if (!attempt.allowed) return authJson({ error: '尝试次数过多，请 15 分钟后再试。' }, 429, { 'Retry-After': String(attempt.retryAfter) });
    const result = await checkCredentials(username, password);
    if (result === 'unconfigured') return authJson({ error: '该账号暂未开通。' }, 503);
    if (result !== 'ok') return authJson({ error: '账号或密码不正确。' }, 401);
    const account = accountByName(username)!;
    return authJson({ ok: true, userId: account.userId, displayName: account.displayName, priceType: account.priceType }, 200, { 'Set-Cookie': await startSession(request, attempt.key, account.userId) });
  } catch { return authJson({ error: '暂时无法切换，请稍后重试。' }, 503); }
}
