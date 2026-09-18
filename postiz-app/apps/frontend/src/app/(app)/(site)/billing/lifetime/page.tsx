import { LifetimeDeal } from '@gitroom/frontend/components/billing/lifetime.deal';
export const dynamic = 'force-dynamic';
import { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { isBillingEnabled } from '@gitroom/helpers/utils/billing.enabled';
export const metadata: Metadata = {
  title: 'EverywherePoster Lifetime deal',
  description: '',
};
export default async function Page() {
  if (!isBillingEnabled()) {
    redirect('/launches');
  }

  return <LifetimeDeal />;
}
