import { CreateComponent } from '@gitroom/frontend/components/create/create.component';
import { Metadata } from 'next';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'EverywherePoster Create',
  description: '',
};

export default async function Page() {
  return <CreateComponent />;
}
