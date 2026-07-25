export const dynamic = 'force-dynamic';
import { Login } from '@gitroom/frontend/components/auth/login';
import { Metadata } from 'next';
export const metadata: Metadata = {
  title: 'EverywherePoster Login',
  description:
    'Sign in to EverywherePoster to schedule and publish social media content.',
};
export default async function Auth() {
  return <Login />;
}
