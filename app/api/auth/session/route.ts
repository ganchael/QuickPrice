import { authJson, getAccountUser } from '@/app/account-auth';
export const dynamic = 'force-dynamic';
export async function GET() {
  const user = await getAccountUser();
  if (!user) return authJson({ error: '请先登录。' }, 401);
  return authJson({ ok: true, userId: user.userId, displayName: user.displayName, priceType: user.priceType, canEditMaster: user.canEditMaster });
}
