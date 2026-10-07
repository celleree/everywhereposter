'use client';

import { useEffect, useState } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useVariables } from '@gitroom/react/helpers/variable.context';
import { useUser } from '@gitroom/frontend/components/layout/user.context';

export function CreatorAudit() {
  const fetch = useFetch();
  const { backendUrl } = useVariables();
  const user = useUser();
  const [source, setSource] = useState('');
  const [message, setMessage] = useState('Loading Creator Audit…');
  useEffect(() => {
    let active = true;
    setSource('');
    setMessage('Loading Creator Audit…');
    fetch('/creator-audit/status').then((response) => response.ok ? response.json() : null)
      .then((data) => {
        if (!active) return;
        const url = new URL(backendUrl.replace(/\/$/, '') + '/creator-audit/audit', window.location.origin);
        if (!data?.enabled || url.origin !== window.location.origin) {
          setMessage('Creator Audit is unavailable for this workspace.');
          return;
        }
        setSource(url.href);
      }).catch(() => { if (active) setMessage('Creator Audit cannot be reached. Refresh to try again.'); });
    return () => { active = false; };
  }, [fetch, backendUrl, user?.orgId]);
  return source ? <iframe key={user?.orgId} title="Creator Audit" src={source}
    className="w-full border-0" style={{ height: 'calc(100dvh - 140px)', minHeight: 440 }} /> :
    <p role="status" className="p-6">{message}</p>;
}
