'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useSWRConfig } from 'swr';

type Status = {
  eligible: boolean;
  canEdit?: boolean;
  reason?: string;
  pageName?: string;
  permalink?: string;
  message?: string;
  revision?: number;
  deleted?: boolean;
  pending?: boolean;
  pendingAction?: 'edit' | 'delete';
};
export function FacebookPublishedManagement({ postId, deleteOnly = false, onConfirmed }: {
  postId: string;
  deleteOnly?: boolean;
  onConfirmed?: (message: string, deleted: boolean) => void;
}) {
  const fetch = useFetch();
  const { mutate } = useSWRConfig();
  const [status, setStatus] = useState<Status>();
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [deletionNeedsCheck, setDeletionNeedsCheck] = useState(false);
  const canEdit = status?.canEdit && !deleteOnly;
  const needsCheck = status?.pending || deletionNeedsCheck;
  const guard = useRef(false);
  const deleteButton = useRef<HTMLButtonElement>(null);
  const epoch = useRef(0);
  const cancelDeletion = useCallback(() => {
    setConfirm(false);
    requestAnimationFrame(() => deleteButton.current?.focus());
  }, []);
  useEffect(() => {
    if (!confirm) return;
    // The outer composer has a native document hotkey. Capture Escape before
    // it reaches that listener, including while a deletion is being confirmed.
    const dismiss = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!busy) cancelDeletion();
    };
    document.addEventListener('keydown', dismiss, true);
    return () => document.removeEventListener('keydown', dismiss, true);
  }, [confirm, busy, cancelDeletion]);
  const request = useCallback(
    async (method = 'GET', body?: object, reconcile = false) => {
      const response = await fetch(
        `/posts/${encodeURIComponent(postId)}/facebook-published${
          reconcile ? '/reconcile' : ''
        }`,
        {
          method,
          ...(body ? { body: JSON.stringify(body) } : {}),
        }
      );
      const data = await response.json();
      if (!response.ok)
        throw new Error(
          typeof data.message === 'string'
            ? data.message
            : 'Unable to confirm the Facebook result.'
        );
      return data as Status;
    },
    [fetch, postId]
  );
  useEffect(() => {
    const generation = ++epoch.current;
    setStatus(undefined);
    setMessage('');
    setError('');
    setConfirm(false);
    setDeletionNeedsCheck(false);
    setBusy(false);
    guard.current = false;
    request()
      .then((data) => {
        if (generation === epoch.current) {
          setStatus(data);
          setMessage(data.message || '');
          if (data.eligible && typeof data.message === 'string') {
            onConfirmed?.(data.message, !!data.deleted);
          }
        }
      })
      .catch((error) => {
        if (generation === epoch.current) setError(error.message);
      });
    return () => {
      epoch.current++;
    };
  }, [request, onConfirmed]);
  const perform = async (action: 'edit' | 'delete' | 'reconcile') => {
    if (guard.current) return;
    guard.current = true;
    setBusy(true);
    setError('');
    const generation = epoch.current;
    try {
      const data = await request(
        'POST',
        action === 'reconcile'
          ? undefined
          : {
              action,
              revision: status?.revision,
              ...(action === 'edit' ? { message } : {}),
            },
        action === 'reconcile'
      );
      if (generation !== epoch.current) return;
      setStatus(data);
      setMessage(data.message || '');
      setConfirm(false);
      setDeletionNeedsCheck(false);
      if (data.eligible && typeof data.message === 'string') {
        onConfirmed?.(data.message, !!data.deleted);
      }
      // Details, calendar, lists and platform-media keys use different formats.
      await mutate(() => true);
    } catch (error) {
      if (generation !== epoch.current) return;
      if (action === 'delete') {
        setConfirm(false);
        setDeletionNeedsCheck(true);
      }
      setError(
        error instanceof Error
          ? error.message
          : 'Unable to confirm the Facebook result.'
      );
      // Refresh only status: retain the requested text while reconciling.
      const data = await request().catch(() => undefined);
      if (data && generation === epoch.current) {
        setStatus(data);
        if (data.eligible && data.deleted && typeof data.message === 'string') {
          setError('');
          setDeletionNeedsCheck(false);
          onConfirmed?.(data.message, true);
          await mutate(() => true);
        }
      }
    } finally {
      if (generation === epoch.current) {
        guard.current = false;
        setBusy(false);
      }
    }
  };
  return (
    <section
      aria-label="Facebook text post management"
      className="flex min-w-0 flex-col gap-3 rounded-lg border border-newBorder p-4"
    >
      <h2 className="break-words font-semibold">{status?.pageName || 'Facebook post'}</h2>
      {busy && <p role="status">Waiting for Facebook confirmation…</p>}
      {error && (
        <p role="alert" className="break-words text-red-400">
          {error}
        </p>
      )}
      {!status && !error && <p role="status">Loading Facebook post actions…</p>}
      {status && !status.eligible && <p>{status.reason}</p>}
      {status?.eligible && (
        <>
          {!confirm && (status.deleted || !canEdit) && (
            <p className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words">{status.message}</p>
          )}
          <a
            href={status.permalink}
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            Open this post on Facebook
          </a>
          {status.deleted ? (
            <p role="status">Deleted on Facebook.</p>
          ) : (
            <>
              {canEdit && !confirm && (
                <>
                  <label htmlFor={`facebook-message-${postId}`}>Post message</label>
                  <textarea
                    id={`facebook-message-${postId}`}
                    value={message}
                    onChange={(event) => setMessage(event.target.value)}
                    disabled={busy || needsCheck}
                    maxLength={63206}
                    rows={5}
                    className="w-full min-w-0 rounded-lg border border-newBorder bg-newBgColor p-3"
                  />
                  <p>Only the message text can be edited here.</p>
                </>
              )}
              {needsCheck ? (
                <>
                  <p role="status">
                    {deletionNeedsCheck || status.pendingAction === 'delete'
                      ? 'Facebook deletion is unconfirmed. Check the result before taking any further action.'
                      : 'The previous operation needs confirmation. Check the result before taking any further action.'}
                  </p>
                  <button
                    disabled={busy}
                    onClick={() => perform('reconcile')}
                    className="rounded bg-btnSimple p-3"
                  >
                    Check result
                  </button>
                </>
              ) : !confirm && (
                <>
                  {canEdit && (
                    <button
                      disabled={busy || !message.trim() || message === status.message}
                      onClick={() => perform('edit')}
                      className="rounded bg-btnSimple p-3"
                    >
                      Save Facebook message
                    </button>
                  )}
                  <button
                    ref={deleteButton}
                    disabled={busy}
                    onClick={() => setConfirm(true)}
                    className="rounded border border-newBorder p-3"
                  >
                    Delete from Facebook
                  </button>
                </>
              )}
              {confirm && !needsCheck && (
                <div
                  role="alertdialog"
                  aria-labelledby={`facebook-delete-${postId}`}
                  aria-describedby={`facebook-delete-message-${postId}`}
                  className="rounded border border-red-400 p-3"
                >
                  <p id={`facebook-delete-${postId}`} className="break-words">
                    Permanently delete this post from <strong>{status.pageName}</strong>?
                  </p>
                  <blockquote
                    id={`facebook-delete-message-${postId}`}
                    className="my-3 max-h-48 overflow-y-auto whitespace-pre-wrap break-words border-s-2 border-newBorder ps-3"
                  >
                    {status.message}
                  </blockquote>
                  <p>Only this Page’s copy will be deleted.</p>
                  <button
                    autoFocus
                    disabled={busy}
                    onClick={cancelDeletion}
                    className="p-3"
                  >
                    Cancel
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => perform('delete')}
                    className="p-3 text-red-400"
                  >
                    Confirm Facebook deletion
                  </button>
                </div>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
