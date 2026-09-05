import QuickPriceApp from './quickprice-app';
import { getChatGPTUser, chatGPTSignInPath, chatGPTSignOutPath } from './chatgpt-auth';

export const dynamic = 'force-dynamic';
export default async function Page() {
  const user = await getChatGPTUser();
  return <QuickPriceApp user={user ? { userId: user.userId, displayName: user.displayName, email: user.email } : null} signInUrl={chatGPTSignInPath('/')} signOutUrl={chatGPTSignOutPath('/')} />;
}
