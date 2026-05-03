import { CreateComponent } from '@gitroom/frontend/components/create/create.component';
import { isGeneralServerSide } from '@gitroom/helpers/utils/is.general.server.side';
import { Metadata } from 'next';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: `${isGeneralServerSide() ? 'Publish Everywhere' : 'Gitroom'} Create`,
  description: '',
};

export default async function Page() {
  return <CreateComponent />;
}
