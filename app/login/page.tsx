import { redirect } from 'next/navigation';
import { getAccountUser } from '@/app/account-auth';
import LoginForm from './login-form';
export const dynamic = 'force-dynamic';
async function LoginScreen() {
  if (await getAccountUser()) redirect('/');
  return <LoginForm />;
}
export default function LoginPage() { return <LoginScreen />; }
