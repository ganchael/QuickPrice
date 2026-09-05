import { authJson, checkCredentials, consumeLoginAttempt, isSameOrigin, startSession } from '@/app/account-auth';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return authJson({ error: '请从本站登录。' }, 403);
  if (!request.headers.get('content-type')?.includes('application/json')) return authJson({ error: '请求格式不正确。' }, 415);
  let username: string, password: string;
  try {
    const body = await request.text();
    if (body.length > 2048) return authJson({ error: '登录信息过长。' }, 413);
    const data = JSON.parse(body);
    if (typeof data?.username !== 'string' || typeof data?.password !== 'string' || data.username.length > 80 || data.password.length > 256 || !data.password) throw new Error();
    username = data.username.trim(); password = data.password;
  } catch { return authJson({ error: '请填写账号和密码。' }, 400); }
  try {
    const attempt = await consumeLoginAttempt(request);
    if (!attempt.allowed) return authJson({ error: '尝试次数过多，请 15 分钟后再试。' }, 429, { 'Retry-After': String(attempt.retryAfter) });
    if (!await checkCredentials(username, password)) return authJson({ error: '账号或密码不正确。' }, 401);
    return authJson({ ok: true }, 200, { 'Set-Cookie': await startSession(request, attempt.key) });
  } catch { return authJson({ error: '暂时无法登录，请稍后重试。' }, 503); }
}
