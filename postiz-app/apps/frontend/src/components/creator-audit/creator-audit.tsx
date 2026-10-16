'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useVariables } from '@gitroom/react/helpers/variable.context';
import { useUser } from '@gitroom/frontend/components/layout/user.context';

type InstagramIntegration = {
  id: string;
  identifier: string;
  name: string;
  disabled?: boolean;
  inBetweenSteps?: boolean;
  refreshNeeded?: boolean;
};

type AuditTask = {
  id: string;
  status: 'running' | 'done' | 'error' | 'paused';
  kind?: string;
  integration_id?: string;
  analysis_cap?: number;
  resumable?: boolean;
  error?: string;
};

const auditHeaders = (orgId: string) => ({ 'X-Audit-Organization': orgId });

export function CreatorAudit() {
  const fetch = useFetch();
  const { backendUrl } = useVariables();
  const user = useUser();
  const orgId = user?.orgId || '';
  const orgRef = useRef(orgId);
  // Update during render so callbacks from the previous workspace become stale
  // as soon as the organization changes, before effects run their cleanup.
  orgRef.current = orgId;

  const [source, setSource] = useState('');
  const [sourceOrg, setSourceOrg] = useState('');
  const [message, setMessage] = useState('Loading Creator Audit…');
  const [integrations, setIntegrations] = useState<InstagramIntegration[]>([]);
  const [selectedIntegration, setSelectedIntegration] = useState('');
  const [task, setTask] = useState<AuditTask | null>(null);
  const [taskOrg, setTaskOrg] = useState('');
  const [taskError, setTaskError] = useState('');
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const allowedToStart = ['ADMIN', 'SUPERADMIN'].includes(user?.role || '');

  const scopedFetch = useCallback(
    (path: string, capturedOrg: string, options: RequestInit = {}) =>
      fetch(path, {
        ...options,
        headers: { ...auditHeaders(capturedOrg), ...options.headers },
      }),
    [fetch]
  );

  useEffect(() => {
    const capturedOrg = orgId;
    let active = true;
    const current = () => active && orgRef.current === capturedOrg;
    setSource('');
    setSourceOrg('');
    setMessage('Loading Creator Audit…');
    setIntegrations([]);
    setSelectedIntegration('');
    setTask(null);
    setTaskOrg('');
    setTaskError('');
    setBusy(false);

    scopedFetch('/creator-audit/status', capturedOrg)
      .then((response) => (response.ok ? response.json() : null))
      .then(async (data) => {
        if (!current()) return;
        const url = new URL(
          backendUrl.replace(/\/$/, '') + '/creator-audit/audit',
          window.location.origin
        );
        if (!data?.enabled || url.origin !== window.location.origin) {
          setMessage('Creator Audit is unavailable for this workspace.');
          return;
        }
        setSource(url.href);
        setSourceOrg(capturedOrg);
        try {
          const [integrationResponse, currentResponse] = await Promise.all([
            fetch('/integrations/list'),
            scopedFetch('/creator-audit/api/audit/tasks/current', capturedOrg),
          ]);
          if (!current()) return;
          const body = integrationResponse.ok ? await integrationResponse.json() : {};
          const loadedIntegrations: InstagramIntegration[] = (body?.integrations || []).filter(
            (integration: InstagramIntegration) =>
              ['instagram', 'instagram-standalone'].includes(integration.identifier)
          );
          if (current()) setIntegrations(loadedIntegrations);
          if (currentResponse.ok) {
            const currentTask = await currentResponse.json();
            if (current() && currentTask?.id) {
              const restoredResponse = await scopedFetch(
                `/creator-audit/api/audit/tasks/${encodeURIComponent(currentTask.id)}`,
                capturedOrg
              );
              if (current() && restoredResponse.ok) {
                const restored = await restoredResponse.json();
                if (current() && ['running', 'error', 'paused'].includes(restored?.status)) {
                  setTask(restored);
                  setTaskOrg(capturedOrg);
                  const restoredIntegration = loadedIntegrations.find(
                    (integration) => integration.id === restored.integration_id &&
                      !integration.disabled && !integration.inBetweenSteps && !integration.refreshNeeded
                  );
                  if (restoredIntegration) setSelectedIntegration(restoredIntegration.id);
                  if (restored.status === 'error' || restored.status === 'paused') {
                    setTaskError(restored.resumable === false ? restored.error || 'An operator must check this audit before starting again.' : 'The previous audit could not finish. Resume it to try again.');
                  }
                }
              }
            }
          }
        } catch {
          // The iframe remains usable when the optional connected beta is unavailable.
        }
      })
      .catch(() => {
        if (current()) setMessage('Creator Audit cannot be reached. Refresh to try again.');
      });
    return () => {
      active = false;
    };
  }, [backendUrl, fetch, orgId, scopedFetch]);

  const finishTask = useCallback(
    (capturedOrg: string) => {
      if (orgRef.current !== capturedOrg) return;
      setTask(null);
      setTaskOrg('');
      setTaskError('');
      setRevision((value) => value + 1);
    },
    []
  );

  useEffect(() => {
    if (!task || task.status !== 'running' || !orgId) return;
    const capturedOrg = orgId;
    const taskId = task.id;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const current = () => active && orgRef.current === capturedOrg;
    const poll = async () => {
      try {
        const response = await scopedFetch(
          `/creator-audit/api/audit/tasks/${encodeURIComponent(taskId)}`,
          capturedOrg
        );
        if (!current()) return;
        if (!response.ok) throw new Error('status');
        const status: AuditTask = await response.json();
        if (!current()) return;
        if (status.status === 'done') {
          finishTask(capturedOrg);
        } else if (status.status === 'error' || status.status === 'paused') {
          setTask(status);
          setTaskOrg(capturedOrg);
          setTaskError(status.resumable === false ? status.error || 'An operator must check this audit before starting again.' : 'The audit could not finish. Resume this audit to try again.');
        } else {
          setTask(status);
          setTaskOrg(capturedOrg);
          timer = setTimeout(poll, 1500);
        }
      } catch {
        if (current()) {
          setTaskError('Audit status is temporarily unavailable. Resume to check again.');
          setTask((previous) => previous ? { ...previous, status: 'error' } : previous);
        }
      }
    };
    timer = setTimeout(poll, 1000);
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [finishTask, orgId, scopedFetch, task?.id, task?.status]);

  const startAudit = async (resumeTaskId?: string, resumeAnalysisCap?: number) => {
    const capturedOrg = orgId;
    if (!capturedOrg || !selectedIntegration || !allowedToStart || busy) return;
    setBusy(true);
    setTaskError('');
    try {
      const response = await scopedFetch('/creator-audit/connected', capturedOrg, {
        method: 'POST',
        body: JSON.stringify({
          integration_id: selectedIntegration,
          ...(resumeTaskId ? { resume_task_id: resumeTaskId } : {}),
          ...(resumeTaskId && resumeAnalysisCap ? { analysis_cap: resumeAnalysisCap } : {}),
        }),
      });
      if (orgRef.current !== capturedOrg) return;
      if (!response.ok) throw new Error('start');
      const started: AuditTask = await response.json();
      if (orgRef.current === capturedOrg) {
        setTask(started);
        setTaskOrg(capturedOrg);
      }
    } catch {
      if (orgRef.current === capturedOrg) {
        setTaskError('The audit could not be started. Check the connection and try again.');
      }
    } finally {
      if (orgRef.current === capturedOrg) setBusy(false);
    }
  };

  const readyIntegrations = integrations.filter(
    (integration) => !integration.disabled && !integration.inBetweenSteps && !integration.refreshNeeded
  );
  const needsConnection = integrations.length === 0 || readyIntegrations.length === 0;
  const visibleTask = taskOrg === orgId ? task : null;
  return (
    <div key={orgId} className="p-6">
      {source && sourceOrg === orgId ? (
        <>
          <section className="creator-audit-controls mb-6 rounded-lg border p-4" aria-label="Connected Instagram audit">
            <h2 className="text-lg font-semibold">Instagram account audit</h2>
            <p className="mt-1">
              Choose a connected Instagram professional account to audit. Discovery covers the default 180 days,
              with up to 300 items and 30 analysis items; unsupported or unavailable account data
              may leave parts of the audit incomplete.
            </p>
            <p className="mt-2 text-sm">Accounts must be connected to this workspace before they appear here.</p>
            {needsConnection ? (
              <div className="mt-3">
                <p>No ready Instagram connection is available. Add or reconnect one to continue.</p>
                <a className="underline" href="/launches">Add or reconnect a channel</a>
              </div>
            ) : (
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <label className="flex min-w-0 max-w-full flex-col gap-2">
                  Instagram connection{' '}
                  <select
                    aria-label="Instagram connection"
                    className="min-h-[44px] w-full min-w-0 rounded-[8px] border border-newTableBorder bg-newBgColorInner px-3 text-textColor focus-visible:outline focus-visible:outline-2"
                    value={selectedIntegration}
                    onChange={(event) => setSelectedIntegration(event.target.value)}
                  >
                    <option className="bg-newBgColorInner text-textColor" value="">Choose a connection</option>
                    {readyIntegrations.map((integration) => (
                      <option className="bg-newBgColorInner text-textColor" key={integration.id} value={integration.id}>{integration.name}</option>
                    ))}
                  </select>
                </label>
                <button type="button" disabled={!selectedIntegration || !allowedToStart || busy || visibleTask?.status === 'running' || visibleTask?.resumable === false} onClick={() => startAudit()}>
                  {busy ? 'Starting…' : visibleTask?.status === 'running' ? 'Audit running…' : 'Start audit'}
                </button>
                <a className="underline" href="/launches">Connect another Instagram account</a>
              </div>
            )}
            {!allowedToStart && <p className="mt-2">An organization admin must start the audit.</p>}
            {visibleTask?.status === 'running' && <p role="status" className="mt-2">Audit running…</p>}
            {taskError && (
              <div role="alert" className="mt-2">
                <p>{taskError}</p>
                {visibleTask?.id && visibleTask.resumable !== false && selectedIntegration && allowedToStart && (
                  <button type="button" disabled={busy} onClick={() => startAudit(visibleTask.id, visibleTask.analysis_cap)}>
                    Resume audit
                  </button>
                )}
              </div>
            )}
          </section>
          <iframe key={`${orgId}:${revision}`} title="Creator Audit" src={source}
            className="w-full border-0" style={{ height: 'calc(100dvh - 140px)', minHeight: 440 }} />
        </>
      ) : <p role="status">{message}</p>}
    </div>
  );
}
