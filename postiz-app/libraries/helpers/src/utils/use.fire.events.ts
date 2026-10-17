import { isAnalyticsEnabled } from '@gitroom/react/helpers/posthog.analytics';
import { usePlausible } from 'next-plausible';
import { useCallback } from 'react';
import { usePostHog } from 'posthog-js/react';
import { useVariables } from '@gitroom/react/helpers/variable.context';
import { useUser } from '@gitroom/frontend/components/layout/user.context';

export const useFireEvents = () => {
  const { billingEnabled } = useVariables();
  const plausible = usePlausible();
  const posthog = usePostHog();
  const user = useUser();

  return useCallback(
    (name: string, props?: any) => {
      if (isAnalyticsEnabled() && posthog.__loaded && user) {
        posthog.identify(user.id, { email: user.email, name: user.name });
      }

      if (isAnalyticsEnabled() && posthog.__loaded) {
        // Legacy purchase means only a checkout return, not a verified payment.
        posthog.capture(name === 'purchase' ? 'checkout_returned' : name, props);
      }
      if (billingEnabled) plausible(name, { props });
    },
    [user, posthog, plausible, billingEnabled]
  );
};
