import { ThirdPartyComponent } from '@gitroom/frontend/components/third-parties/third-party.component';

export const dynamic = 'force-dynamic';
import { Metadata } from 'next';
export const metadata: Metadata = {
  title: 'EverywherePoster Integrations',
  description: '',
};
export default async function Index() {
  return <ThirdPartyComponent />;
}
