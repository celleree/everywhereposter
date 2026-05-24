'use client';

import { useSearchParams } from 'next/navigation';
import { FC, useCallback, useEffect } from 'react';

const getSafeReturnUrl = (url: string) => {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    const parsed = new URL(url, window.location.origin);
    const path = `${parsed.pathname}${parsed.search}${parsed.hash}` || '/';

    if (parsed.origin === window.location.origin) {
      return path;
    }

    if (['localhost', '127.0.0.1'].includes(parsed.hostname)) {
      return path;
    }
  } catch {}
};

const ReturnUrlComponent: FC = () => {
  const params = useSearchParams();
  const url = params.get('returnUrl');
  useEffect(() => {
    if (url) {
      const safeReturnUrl = getSafeReturnUrl(url);
      if (safeReturnUrl) {
        localStorage.setItem('returnUrl', safeReturnUrl);
      }
    }
  }, [url]);
  return null;
};
export const useReturnUrl = () => {
  return {
    getAndClear: useCallback(() => {
      const data = localStorage.getItem('returnUrl');
      localStorage.removeItem('returnUrl');
      return data;
    }, []),
  };
};
export default ReturnUrlComponent;
