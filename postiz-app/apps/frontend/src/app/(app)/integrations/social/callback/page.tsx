import { ContinueIntegration } from '@gitroom/frontend/components/launches/continue.integration';
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';

export default async function Page(props: { searchParams: Promise<any> }) {
  const searchParams = await props.searchParams;
  const get = (await cookies()).get('auth');

  return (
    <ContinueIntegration
      searchParams={searchParams}
      provider="tiktok"
      logged={!!get?.name}
    />
  );
}
