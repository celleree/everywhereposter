'use client';

import React, {
  createContext,
  FC,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import clsx from 'clsx';
import { useShallow } from 'zustand/react/shallow';
import ImageWithFallback from '@gitroom/react/helpers/image.with.fallback';
import { VideoFrame } from '@gitroom/react/helpers/video.frame';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { DatePicker } from '@gitroom/frontend/components/launches/helpers/date.picker';
import { getGuidedPlatformIdentity } from '@gitroom/frontend/components/new-launch/guided.composer.destinations';
import {
  getGuidedReviewDestinationLimit,
  getGuidedReviewDraftValidation,
} from '@gitroom/frontend/components/new-launch/guided.composer.review';
import { useGuidedComposerStore } from '@gitroom/frontend/components/new-launch/guided.composer.store';
import { useLaunchStore } from '@gitroom/frontend/components/new-launch/store';
import { isGuidedMp4MovMedia } from '@gitroom/frontend/components/new-launch/guided.video.validation';

export type GuidedPublishTiming = 'now' | 'schedule';

export interface GuidedPublishRequest {
  type: GuidedPublishTiming;
  destinationIds: string[];
  captionOverrides: Record<string, string>;
}

export interface GuidedPublishPostReference {
  postId: string;
  integration: string;
}

export type GuidedPublishFailureKind =
  | 'validation'
  | 'request'
  | 'transport'
  | 'response'
  | 'duplicate';

export type GuidedPublishSubmitResult =
  | {
      ok: true;
      posts: GuidedPublishPostReference[];
    }
  | {
      ok: false;
      kind: GuidedPublishFailureKind;
      message: string;
      ambiguous: boolean;
    };

export type GuidedPublishDestinationStatus =
  | 'idle'
  | 'scheduled'
  | 'processing'
  | 'published'
  | 'failed'
  | 'reconnect-required';

interface GuidedPublishDestinationResult {
  destinationId: string;
  postId?: string;
  status: GuidedPublishDestinationStatus;
  message?: string;
}

type GuidedPublishSubmitter = (
  request: GuidedPublishRequest
) => Promise<GuidedPublishSubmitResult>;

interface GuidedPublishBridgeValue {
  available: boolean;
  register: (submitter: GuidedPublishSubmitter) => () => void;
  submit: GuidedPublishSubmitter;
}

const unavailableResult = (): GuidedPublishSubmitResult => ({
  ok: false,
  kind: 'request',
  message: 'The publishing controls are still loading. Please try again.',
  ambiguous: false,
});

const GuidedPublishBridgeContext = createContext<GuidedPublishBridgeValue>({
  available: false,
  register: () => () => undefined,
  submit: async () => unavailableResult(),
});

export const GuidedComposerPublishBridgeProvider: FC<{
  children: ReactNode;
}> = ({ children }) => {
  const submitterRef = useRef<GuidedPublishSubmitter | null>(null);
  const [available, setAvailable] = useState(false);

  const register = useCallback((submitter: GuidedPublishSubmitter) => {
    submitterRef.current = submitter;
    setAvailable(true);

    return () => {
      if (submitterRef.current === submitter) {
        submitterRef.current = null;
        setAvailable(false);
      }
    };
  }, []);

  const submit = useCallback<GuidedPublishSubmitter>((request) => {
    return (
      submitterRef.current?.(request) ?? Promise.resolve(unavailableResult())
    );
  }, []);

  const value = useMemo(
    () => ({ available, register, submit }),
    [available, register, submit]
  );

  return (
    <GuidedPublishBridgeContext.Provider value={value}>
      {children}
    </GuidedPublishBridgeContext.Provider>
  );
};

export const useRegisterGuidedComposerPublish = (
  submitter: GuidedPublishSubmitter,
  enabled: boolean
) => {
  const { register } = useContext(GuidedPublishBridgeContext);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    return register(submitter);
  }, [enabled, register, submitter]);
};

const GUIDED_PUBLISH_POLL_INTERVAL_MS = 1500;
const GUIDED_PUBLISH_POLL_TIMEOUT_MS = 45000;

const wait = (milliseconds: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });

const getErrorMessage = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

const getPolledPost = (payload: any, postId: string) => {
  const posts = Array.isArray(payload?.posts) ? payload.posts : [];
  return posts.find((post: any) => post?.id === postId) || posts[0];
};

const hasReconnectState = (payload: any, post: any) =>
  Boolean(
    post?.integration?.refreshNeeded ||
      post?.integration?.inBetweenSteps ||
      post?.integration?.publishedCapabilities?.requiresReconnect ||
      payload?.integration?.refreshNeeded ||
      payload?.integration?.inBetweenSteps ||
      payload?.integration?.publishedCapabilities?.requiresReconnect
  );

export const pollGuidedPublishPost = async ({
  fetcher,
  reference,
  timing,
  timeoutMs = GUIDED_PUBLISH_POLL_TIMEOUT_MS,
  intervalMs = GUIDED_PUBLISH_POLL_INTERVAL_MS,
  now = Date.now,
  pause = wait,
}: {
  fetcher: (url: string, options?: RequestInit) => Promise<any>;
  reference: GuidedPublishPostReference;
  timing: GuidedPublishTiming;
  timeoutMs?: number;
  intervalMs?: number;
  now?: () => number;
  pause?: (milliseconds: number) => Promise<void>;
}): Promise<GuidedPublishDestinationResult> => {
  const startedAt = now();
  let lastError = '';

  while (now() - startedAt <= timeoutMs) {
    try {
      const response = await fetcher(
        `/posts/${encodeURIComponent(reference.postId)}`
      );

      if (!response.ok) {
        lastError = 'The latest publishing status could not be loaded.';
      } else {
        const payload = await response.json();
        const post = getPolledPost(payload, reference.postId);

        if (!post) {
          lastError =
            'The submitted post was not present in the status response.';
        } else if (post.state === 'PUBLISHED') {
          return {
            destinationId: reference.integration,
            postId: reference.postId,
            status: 'published',
          };
        } else if (post.state === 'ERROR') {
          const reconnectRequired = hasReconnectState(payload, post);
          return {
            destinationId: reference.integration,
            postId: reference.postId,
            status: reconnectRequired ? 'reconnect-required' : 'failed',
            message: reconnectRequired
              ? 'Reconnect this account before trying again.'
              : getErrorMessage(
                  post.error,
                  typeof post.error === 'string'
                    ? post.error
                    : 'Publishing failed for this destination.'
                ),
          };
        } else if (timing === 'schedule' && post.state === 'QUEUE') {
          return {
            destinationId: reference.integration,
            postId: reference.postId,
            status: 'scheduled',
          };
        }
      }
    } catch (error) {
      lastError = getErrorMessage(
        error,
        'The latest publishing status could not be loaded.'
      );
    }

    if (now() - startedAt >= timeoutMs) {
      break;
    }

    await pause(intervalMs);
  }

  return {
    destinationId: reference.integration,
    postId: reference.postId,
    status: timing === 'schedule' ? 'scheduled' : 'processing',
    message:
      lastError ||
      (timing === 'schedule'
        ? 'The schedule was accepted, but its latest status could not be confirmed.'
        : 'Publishing is still processing. Status checks stopped after the timeout.'),
  };
};

const statusLabel: Record<GuidedPublishDestinationStatus, string> = {
  idle: 'Ready',
  scheduled: 'Scheduled',
  processing: 'Publishing',
  published: 'Published',
  failed: 'Failed',
  'reconnect-required': 'Reconnect required',
};

export const GuidedComposerPublish: FC<{
  onSubmittingChange?: (submitting: boolean) => void;
}> = ({ onSubmittingChange }) => {
  const fetch = useFetch();
  const { available, submit } = useContext(GuidedPublishBridgeContext);
  const { global, integrations, selectedIntegrations, chars, date, setDate } =
    useLaunchStore(
      useShallow((state) => ({
        global: state.global,
        integrations: state.integrations,
        selectedIntegrations: state.selectedIntegrations,
        chars: state.chars,
        date: state.date,
        setDate: state.setDate,
      }))
    );
  const reviewDrafts = useGuidedComposerStore((state) => state.reviewDrafts);
  const [timing, setTiming] = useState<GuidedPublishTiming>('now');
  const [phase, setPhase] = useState<
    'idle' | 'submitting' | 'success' | 'failed'
  >('idle');
  const [error, setError] = useState('');
  const [ambiguous, setAmbiguous] = useState(false);
  const [results, setResults] = useState<
    Record<string, GuidedPublishDestinationResult>
  >({});
  const submissionInFlightRef = useRef(false);

  const availableDestinationIds = useMemo(
    () =>
      new Set(
        integrations
          .filter(
            (integration) =>
              !integration.disabled && !integration.inBetweenSteps
          )
          .map((integration) => integration.id)
      ),
    [integrations]
  );
  const destinations = useMemo(
    () =>
      selectedIntegrations
        .map((selected) => selected.integration)
        .filter(
          (integration) =>
            availableDestinationIds.has(integration.id) &&
            reviewDrafts[integration.id]?.enabled === true
        ),
    [availableDestinationIds, reviewDrafts, selectedIntegrations]
  );
  const media = global[0]?.media || [];
  const video = media.find((item) => isGuidedMp4MovMedia(item));
  const validationByDestination = useMemo(
    () =>
      Object.fromEntries(
        destinations.map((destination) => {
          const draft = reviewDrafts[destination.id];
          const limit = getGuidedReviewDestinationLimit({
            providerLimit: chars[destination.id],
            platform: draft.platform,
          });
          return [
            destination.id,
            getGuidedReviewDraftValidation(draft, limit, media.length > 0),
          ];
        })
      ),
    [chars, destinations, media.length, reviewDrafts]
  );
  const hasBlockingError = destinations.some(
    (destination) => validationByDestination[destination.id]?.errors.length > 0
  );

  const submitPublish = useCallback(async () => {
    if (
      submissionInFlightRef.current ||
      !available ||
      !destinations.length ||
      hasBlockingError
    ) {
      return;
    }

    submissionInFlightRef.current = true;
    onSubmittingChange?.(true);
    setPhase('submitting');
    setError('');
    setAmbiguous(false);
    setResults(
      Object.fromEntries(
        destinations.map((destination) => [
          destination.id,
          {
            destinationId: destination.id,
            status: timing === 'schedule' ? 'scheduled' : 'processing',
          },
        ])
      )
    );

    try {
      const request: GuidedPublishRequest = {
        type: timing,
        destinationIds: destinations.map((destination) => destination.id),
        captionOverrides: Object.fromEntries(
          destinations.map((destination) => [
            destination.id,
            reviewDrafts[destination.id].caption,
          ])
        ),
      };
      const submitted = await submit(request);

      if (submitted.ok === false) {
        setPhase('failed');
        setError(submitted.message);
        setAmbiguous(submitted.ambiguous);
        return;
      }

      const referencesByDestination = new Map(
        submitted.posts.map((post) => [post.integration, post])
      );
      const missingDestinations = destinations.filter(
        (destination) => !referencesByDestination.has(destination.id)
      );
      const pollResults = await Promise.all(
        submitted.posts.map((reference) =>
          pollGuidedPublishPost({ fetcher: fetch, reference, timing })
        )
      );
      const nextResults = Object.fromEntries(
        pollResults.map((result) => [result.destinationId, result])
      );

      missingDestinations.forEach((destination) => {
        nextResults[destination.id] = {
          destinationId: destination.id,
          status: 'failed',
          message: 'The publishing response did not include this destination.',
        };
      });
      setResults(nextResults);

      const terminalFailure = Object.values(nextResults).some(
        (result) =>
          result.status === 'failed' || result.status === 'reconnect-required'
      );
      const confirmationTimedOut = Object.values(nextResults).some(
        (result) =>
          Boolean(result.message) &&
          (result.status === 'processing' || result.status === 'scheduled')
      );

      if (terminalFailure || missingDestinations.length) {
        setPhase('failed');
        setError(
          'At least one destination failed. Review each result before explicitly retrying.'
        );
        setAmbiguous(missingDestinations.length > 0);
      } else if (confirmationTimedOut) {
        setPhase('failed');
        setError(
          'The request was accepted, but the latest status could not be confirmed before polling stopped.'
        );
        setAmbiguous(true);
      } else {
        setPhase('success');
      }
    } finally {
      submissionInFlightRef.current = false;
      onSubmittingChange?.(false);
    }
  }, [
    available,
    destinations,
    fetch,
    hasBlockingError,
    onSubmittingChange,
    reviewDrafts,
    submit,
    timing,
  ]);

  const retry = useCallback(() => {
    setPhase('idle');
    setError('');
    setAmbiguous(false);
    setResults({});
  }, []);

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[1120px] flex-col gap-[18px] p-[28px] mobile:p-[14px]">
      <div className="rounded-[18px] border border-newBorder bg-newBgColorInner p-[20px] mobile:p-[15px]">
        <div className="flex flex-wrap items-start justify-between gap-[14px]">
          <div>
            <h2 className="text-[18px] font-[700] text-white">
              Confirm your post
            </h2>
            <p className="mt-[4px] text-[13px] text-textColor/60">
              {destinations.length} enabled destination
              {destinations.length === 1 ? '' : 's'} will receive the final
              captions approved in Review.
            </p>
          </div>
          <div className="rounded-full bg-newBgLineColor px-[11px] py-[6px] text-[11px] font-[700] text-textColor/75">
            {destinations.length} account{destinations.length === 1 ? '' : 's'}
          </div>
        </div>

        <div className="mt-[18px] grid min-w-0 grid-cols-[minmax(220px,0.8fr)_minmax(0,1.4fr)] gap-[18px] mobile:grid-cols-1">
          <div className="min-w-0">
            <div className="text-[13px] font-[700] text-white">
              Source media
            </div>
            <div className="mt-[8px] flex aspect-video min-h-[160px] items-center justify-center overflow-hidden rounded-[14px] border border-newBorder bg-black/35">
              {video?.path ? (
                <VideoFrame url={video.path} />
              ) : media[0]?.path ? (
                <img
                  src={media[0].thumbnail || media[0].path}
                  alt="Post media preview"
                  className="h-full w-full object-contain"
                />
              ) : (
                <div className="px-[18px] text-center text-[12px] text-textColor/50">
                  Text-only post
                </div>
              )}
            </div>
          </div>

          <div className="min-w-0">
            <div className="text-[13px] font-[700] text-white">
              Enabled destinations
            </div>
            <div className="mt-[8px] flex flex-col gap-[8px]">
              {destinations.map((destination) => {
                const validation = validationByDestination[destination.id];
                const result = results[destination.id];
                const identity = getGuidedPlatformIdentity(
                  destination.identifier
                );
                const messages = [
                  ...(validation?.errors || []),
                  ...(validation?.warnings || []),
                ];

                return (
                  <div
                    key={destination.id}
                    data-testid={`guided-publish-destination-${destination.id}`}
                    className="rounded-[12px] border border-newBorder bg-newBgColor px-[12px] py-[11px]"
                  >
                    <div className="flex min-w-0 items-center gap-[10px]">
                      <ImageWithFallback
                        fallbackSrc="/no-picture.jpg"
                        src={destination.picture || '/no-picture.jpg'}
                        alt=""
                        width={36}
                        height={36}
                        className="h-[36px] w-[36px] min-w-[36px] rounded-full object-cover"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] font-[700] text-white">
                          {destination.name}
                        </div>
                        <div className="truncate text-[11px] text-textColor/55">
                          {identity.label} ·{' '}
                          {reviewDrafts[destination.id].caption.length}{' '}
                          characters
                        </div>
                      </div>
                      <div
                        className={clsx(
                          'text-[11px] font-[700]',
                          result?.status === 'failed' ||
                            result?.status === 'reconnect-required' ||
                            validation?.errors.length
                            ? 'text-red-300'
                            : result?.status === 'published' ||
                              result?.status === 'scheduled'
                            ? 'text-green-300'
                            : 'text-textColor/65'
                        )}
                      >
                        {statusLabel[result?.status || 'idle']}
                      </div>
                    </div>
                    {!!messages.length && (
                      <div className="mt-[8px] text-[11px] text-orange-200">
                        {messages.join(' ')}
                      </div>
                    )}
                    {!!result?.message && (
                      <div className="mt-[8px] text-[11px] text-textColor/60">
                        {result.message}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-[18px] border border-newBorder bg-newBgColorInner p-[20px] mobile:p-[15px]">
        <fieldset disabled={phase === 'submitting'}>
          <legend className="text-[14px] font-[700] text-white">
            Publishing time
          </legend>
          <div className="mt-[10px] grid grid-cols-2 gap-[10px] mobile:grid-cols-1">
            <label
              className={clsx(
                'flex cursor-pointer items-center gap-[10px] rounded-[12px] border px-[13px] py-[12px]',
                timing === 'now'
                  ? 'border-ai bg-newBgLineColor'
                  : 'border-newBorder bg-newBgColor'
              )}
            >
              <input
                type="radio"
                name="guided-publish-timing"
                value="now"
                checked={timing === 'now'}
                onChange={() => setTiming('now')}
              />
              <span>
                <span className="block text-[13px] font-[700] text-white">
                  Publish now
                </span>
                <span className="block text-[11px] text-textColor/55">
                  Send to the enabled accounts immediately.
                </span>
              </span>
            </label>
            <label
              className={clsx(
                'flex cursor-pointer items-center gap-[10px] rounded-[12px] border px-[13px] py-[12px]',
                timing === 'schedule'
                  ? 'border-ai bg-newBgLineColor'
                  : 'border-newBorder bg-newBgColor'
              )}
            >
              <input
                type="radio"
                name="guided-publish-timing"
                value="schedule"
                checked={timing === 'schedule'}
                onChange={() => setTiming('schedule')}
              />
              <span>
                <span className="block text-[13px] font-[700] text-white">
                  Schedule
                </span>
                <span className="block text-[11px] text-textColor/55">
                  Use the composer&apos;s existing scheduled time.
                </span>
              </span>
            </label>
          </div>
        </fieldset>

        {timing === 'schedule' && (
          <div
            className="mt-[12px] max-w-[360px]"
            aria-label="Scheduled date and time"
          >
            <DatePicker date={date} onChange={setDate} />
          </div>
        )}

        {!!error && (
          <div
            role="alert"
            className="mt-[14px] rounded-[10px] border border-red-400/40 bg-red-400/10 px-[12px] py-[10px] text-[12px] text-red-200"
          >
            {error}
            {ambiguous && (
              <div className="mt-[4px]">
                Check the calendar and connected accounts before retrying to
                avoid a duplicate post.
              </div>
            )}
          </div>
        )}

        {phase === 'success' && (
          <div
            role="status"
            className="mt-[14px] rounded-[10px] border border-green-400/40 bg-green-400/10 px-[12px] py-[10px] text-[12px] text-green-200"
          >
            {timing === 'schedule'
              ? 'The enabled destinations are scheduled.'
              : 'Publishing was confirmed for every enabled destination.'}
          </div>
        )}

        <div className="mt-[16px] flex justify-end gap-[10px] mobile:flex-col">
          {phase === 'failed' && (
            <button
              type="button"
              onClick={retry}
              className="flex h-[44px] items-center justify-center rounded-[8px] bg-btnSimple px-[18px] text-[14px] font-[700] mobile:w-full"
            >
              Prepare retry
            </button>
          )}
          <button
            type="button"
            onClick={submitPublish}
            disabled={
              phase === 'submitting' ||
              phase === 'success' ||
              phase === 'failed' ||
              !available ||
              !destinations.length ||
              hasBlockingError
            }
            className="flex h-[44px] min-w-[190px] items-center justify-center rounded-[8px] bg-btnPrimary px-[18px] text-[14px] font-[700] text-white disabled:cursor-not-allowed disabled:opacity-50 mobile:w-full"
          >
            {phase === 'submitting'
              ? timing === 'schedule'
                ? 'Scheduling...'
                : 'Publishing...'
              : timing === 'schedule'
              ? 'Schedule post'
              : 'Publish now'}
          </button>
        </div>
      </div>
    </div>
  );
};
