export const dynamic = 'force-dynamic';
import { BillingComponent } from '@gitroom/frontend/components/billing/billing.component';
import { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { isBillingEnabled } from '@gitroom/helpers/utils/billing.enabled';
export const metadata: Metadata = {
  title: 'EverywherePoster Billing',
  description: '',
};
export default async function Page() {
  if (!isBillingEnabled()) {
    redirect('/launches');
  }

  return (
    <div className="bg-newBgColorInner flex-1 flex-col flex p-[20px] gap-[12px]">
      <BillingComponent />
    </div>
  );
}
