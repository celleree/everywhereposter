'use client';

import { useCallback, useEffect } from 'react';
import useSWR from 'swr';
import { LoadingComponent } from '@gitroom/frontend/components/layout/loading';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { MainBillingComponent } from './main.billing.component';
import { AiWalletComponent } from './ai-wallet.component';
export const BillingComponent = ({ walletAvailable = false }: { walletAvailable?: boolean }) => {
  const fetch = useFetch();
  const load = useCallback(async (path: string) => {
    return await (await fetch(path)).json();
  }, []);
  const { isLoading: isLoadingTier, data: tiers } = useSWR(
    '/user/subscription/tiers',
    load
  );
  const { isLoading: isLoadingSubscription, data: subscription } = useSWR(
    '/user/subscription',
    load
  );
  return <>
    {walletAvailable ? <AiWalletComponent /> : null}
    {isLoadingSubscription || isLoadingTier ? <LoadingComponent /> : <MainBillingComponent sub={subscription?.subscription} />}
  </>;
};
