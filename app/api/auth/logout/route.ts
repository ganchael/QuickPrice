import { authJson, endSession, isSameOrigin } from '@/app/account-auth';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return authJson({ error: '请从本站退出登录。' }, 403);
  try { return authJson({ ok: true }, 200, { 'Set-Cookie': await endSession(request) }); }
  catch { return authJson({ error: '退出失败，请重试。' }, 503); }
}
