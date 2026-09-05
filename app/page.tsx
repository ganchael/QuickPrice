import { redirect } from 'next/navigation';
import QuickPriceApp from './quickprice-app';
import { getAccountUser } from './account-auth';
export const dynamic = 'force-dynamic';
async function AuthenticatedWorkspace() {
  const user = await getAccountUser();
  if (!user) redirect('/login');
  return <QuickPriceApp user={user} />;
}
export default function Page() { return <AuthenticatedWorkspace />; }
