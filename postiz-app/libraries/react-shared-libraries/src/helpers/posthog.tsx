'use client';

import posthog from 'posthog-js';
import { PostHogProvider } from 'posthog-js/react';
import { FC, ReactNode, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { initializePostHog, capturePageview } from './posthog.analytics';

export const PHProvider: FC<{
  children: ReactNode;
  phkey?: string;
  host?: string;
  environment?: string;
}> = ({ children, phkey, host, environment }) => {
  const pathname = usePathname();
  useEffect(() => {
    if (initializePostHog(phkey, host, environment) && pathname) {
      capturePageview(pathname);
    }
  }, [phkey, host, environment, pathname]);
  if (!phkey || !host) {
    return <>{children}</>;
  }
  return <PostHogProvider client={posthog}>{children}</PostHogProvider>;
};
