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
import type { Dayjs } from 'dayjs';
import { useShallow } from 'zustand/react/shallow';
import ImageWithFallback from '@gitroom/react/helpers/image.with.fallback';
import { VideoFrame } from '@gitroom/react/helpers/video.frame';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { DatePicker } from '@gitroom/frontend/components/launches/helpers/date.picker';
import {
  getGuidedAvailableIntegrations,
  getGuidedPlatformIdentity,
} from '@gitroom/frontend/components/new-launch/guided.composer.destinations';
import {
  getGuidedReviewDestinationLimit,
  getGuidedReviewDraftValidation,
} from '@gitroom/frontend/components/new-launch/guided.composer.review';
import { useGuidedComposerStore } from '@gitroom/frontend/components/new-launch/guided.composer.store';
import { useLaunchStore } from '@gitroom/frontend/components/new-launch/store';
import { isGuidedMp4MovMedia } from '@gitroom/frontend/components/new-launch/guided.video.validation';

export type GuidedPublishTiming = 'now' | 'schedule';

interface GuidedPublishRequestBase {
  destinationIds: string[];
  captionOverrides: Record<string, string>;
}

export type GuidedPublishRequest = GuidedPublishRequestBase &
  (
    | {
        type: 'now';
      }
    | {
        type: 'schedule';
        scheduledAt: string;
      }
  );

export interface GuidedPublishPostReference {
  postId: string;
  integration: string;
}

export type GuidedPublishFailureKind =
  | 'validation'
  | 'preflight'
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
  | 'submitting'
  | 'accepted'
  | 'scheduled'
  | 'processing'
  | 'published'
  | 'failed'
  | 'reconnect-required'
  | 'unknown';

interface GuidedPublishDestinationResult {
  destinationId: string;
  postId?: string;
  status: GuidedPublishDestinationStatus;
  message?: string;
  retryable?: boolean;
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
const GUIDED_SCHEDULE_TIME_ERROR =
  'Choose a scheduled time that is in the future.';

export const isGuidedScheduleDateFuture = (
  date: Dayjs,
  now = Date.now()
) => date.startOf('second').valueOf() > now;

const wait = (milliseconds: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });

const getErrorMessage = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

const getPolledPosts = (payload: any) =>
  Array.isArray(payload?.posts) ? payload.posts : [];

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

  while (now() - startedAt < timeoutMs) {
    const remainingMs = Math.max(0, timeoutMs - (now() - startedAt));
    const controller = new AbortController();
    let requestTimeout: ReturnType<typeof setTimeout> | undefined;

    try {
      const response = await Promise.race([
        fetcher(`/posts/${encodeURIComponent(reference.postId)}`, {
          signal: controller.signal,
        }),
        new Promise<never>((_, reject) => {
          requestTimeout = setTimeout(() => {
            controller.abort();
            reject(
              new Error('The latest publishing status request timed out.')
            );
          }, remainingMs);
        }),
      ]);

      if (!response.ok) {
        lastError = 'The latest publishing status could not be loaded.';
      } else {
        const payload = await response.json();
        const posts = getPolledPosts(payload);
        const rootPost =
          posts.find((post: any) => post?.id === reference.postId) || posts[0];
        const failedPost = posts.find((post: any) => post?.state === 'ERROR');
        const reconnectRequired = posts.some((post: any) =>
          hasReconnectState(payload, post)
        );

        if (!rootPost) {
          lastError =
            'The submitted post was not present in the status response.';
        } else if (reconnectRequired) {
          return {
            destinationId: reference.integration,
            postId: reference.postId,
            status: 'reconnect-required',
            retryable: false,
            message: 'Reconnect this account before trying again.',
          };
        } else if (failedPost) {
          return {
            destinationId: reference.integration,
            postId: reference.postId,
            status: 'failed',
            retryable: false,
            message: getErrorMessage(
              failedPost.error,
              typeof failedPost.error === 'string'
                ? failedPost.error
                : 'Publishing failed for this destination.'
            ),
          };
        } else if (
          posts.length > 0 &&
          posts.every((post: any) => post?.state === 'PUBLISHED')
        ) {
          return {
            destinationId: reference.integration,
            postId: reference.postId,
            status: 'published',
          };
        } else if (
          timing === 'schedule' &&
          posts.length > 0 &&
          posts.every((post: any) => post?.state === 'QUEUE')
        ) {
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
    } finally {
      if (requestTimeout) {
        clearTimeout(requestTimeout);
      }
    }

    if (now() - startedAt >= timeoutMs) {
      break;
    }

    await pause(
      Math.min(intervalMs, Math.max(0, timeoutMs - (now() - startedAt)))
    );
  }

  return {
    destinationId: reference.integration,
    postId: reference.postId,
    status: timing === 'schedule' ? 'accepted' : 'processing',
    message:
      lastError ||
      (timing === 'schedule'
        ? 'The schedule was accepted, but its latest status could not be confirmed.'
        : 'Publishing is still processing. Status checks stopped after the timeout.'),
  };
};

const statusLabel: Record<GuidedPublishDestinationStatus, string> = {
  idle: 'Ready',
  submitting: 'Submitting',
  accepted: 'Status pending',
  scheduled: 'Scheduled',
  processing: 'Publishing',
  published: 'Published',
  failed: 'Failed',
  'reconnect-required': 'Reconnect required',
  unknown: 'Status unknown',
};

export const GuidedComposerPublish: FC<{
  active?: boolean;
  onSubmittingChange?: (submitting: boolean) => void;
}> = ({ active = true, onSubmittingChange }) => {
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
  const [retryDestinationIds, setRetryDestinationIds] = useState<
    string[] | null
  >(null);
  const submissionInFlightRef = useRef(false);

  const availableDestinationIds = useMemo(
    () =>
      new Set(
        getGuidedAvailableIntegrations(integrations).map(
          (integration) => integration.id
        )
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
  const submissionDestinations = useMemo(() => {
    if (retryDestinationIds === null) {
      return destinations;
    }

    const retryScope = new Set(retryDestinationIds);
    return destinations.filter((destination) => retryScope.has(destination.id));
  }, [destinations, retryDestinationIds]);
  const scheduleDateIsFuture =
    timing !== 'schedule' || isGuidedScheduleDateFuture(date);

  const submitPublish = useCallback(async () => {
    const attemptDate = date;

    if (timing === 'schedule' && !isGuidedScheduleDateFuture(attemptDate)) {
      setError(GUIDED_SCHEDULE_TIME_ERROR);
      setAmbiguous(false);
      return;
    }

    if (
      submissionInFlightRef.current ||
      !available ||
      !submissionDestinations.length ||
      hasBlockingError
    ) {
      return;
    }

    submissionInFlightRef.current = true;
    onSubmittingChange?.(true);
    setPhase('submitting');
    setError('');
    setAmbiguous(false);
    setResults((currentResults) => {
      const nextResults = { ...currentResults };
      submissionDestinations.forEach((destination) => {
        nextResults[destination.id] = {
          destinationId: destination.id,
          status: 'submitting',
        };
      });
      return nextResults;
    });

    try {
      const requestDetails: GuidedPublishRequestBase = {
        destinationIds: submissionDestinations.map(
          (destination) => destination.id
        ),
        captionOverrides: Object.fromEntries(
          submissionDestinations.map((destination) => [
            destination.id,
            reviewDrafts[destination.id].caption,
          ])
        ),
      };
      const request: GuidedPublishRequest =
        timing === 'schedule'
          ? {
              ...requestDetails,
              type: 'schedule',
              scheduledAt: attemptDate.toISOString(),
            }
          : {
              ...requestDetails,
              type: 'now',
            };
      const submitted = await submit(request);

      if (submitted.ok === false) {
        const safeToRetry =
          !submitted.ambiguous &&
          (submitted.kind === 'validation' || submitted.kind === 'preflight');
        setResults((currentResults) => {
          const nextResults = { ...currentResults };
          submissionDestinations.forEach((destination) => {
            nextResults[destination.id] = {
              destinationId: destination.id,
              status: safeToRetry ? 'failed' : 'unknown',
              message: submitted.message,
              retryable: safeToRetry,
            };
          });
          return nextResults;
        });
        setRetryDestinationIds(safeToRetry ? null : []);
        setPhase('failed');
        setError(submitted.message);
        setAmbiguous(submitted.ambiguous);
        return;
      }

      const referencesByDestination = new Map(
        submitted.posts.map((post) => [post.integration, post])
      );
      const missingDestinations = submissionDestinations.filter(
        (destination) => !referencesByDestination.has(destination.id)
      );
      setResults((currentResults) => {
        const nextResults = { ...currentResults };
        submissionDestinations.forEach((destination) => {
          nextResults[destination.id] = {
            destinationId: destination.id,
            postId: referencesByDestination.get(destination.id)?.postId,
            status: referencesByDestination.has(destination.id)
              ? 'accepted'
              : 'unknown',
            ...(!referencesByDestination.has(destination.id)
              ? {
                  message:
                    'The publishing response did not include this destination.',
                }
              : {}),
          };
        });
        return nextResults;
      });
      const pollResults = await Promise.all(
        submitted.posts.map((reference) =>
          pollGuidedPublishPost({ fetcher: fetch, reference, timing })
        )
      );
      const nextResults = { ...results };
      pollResults.forEach((result) => {
        nextResults[result.destinationId] = result;
      });

      missingDestinations.forEach((destination) => {
        nextResults[destination.id] = {
          destinationId: destination.id,
          status: 'unknown',
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
          (result.status === 'accepted' ||
            result.status === 'processing' ||
            result.status === 'unknown')
      );
      if (confirmationTimedOut || missingDestinations.length) {
        setRetryDestinationIds([]);
        setPhase('failed');
        setError(
          'The request was accepted, but the latest status could not be confirmed before polling stopped.'
        );
        setAmbiguous(true);
      } else if (terminalFailure) {
        setRetryDestinationIds([]);
        setPhase('failed');
        setError(
          'At least one destination failed, but retry is locked because publishing may already have started or the account requires reconnection.'
        );
        setAmbiguous(true);
      } else {
        setRetryDestinationIds([]);
        setPhase('success');
      }
    } finally {
      submissionInFlightRef.current = false;
      onSubmittingChange?.(false);
    }
  }, [
    available,
    date,
    destinations,
    fetch,
    hasBlockingError,
    onSubmittingChange,
    results,
    reviewDrafts,
    submit,
    submissionDestinations,
    timing,
  ]);

  const retry = useCallback(() => {
    if (ambiguous || retryDestinationIds !== null) {
      return;
    }

    setPhase('idle');
    setError('');
    setAmbiguous(false);
  }, [ambiguous, retryDestinationIds]);

  if (!active) {
    return null;
  }

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
                            result?.status === 'unknown' ||
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
                onChange={() => {
                  setTiming('now');
                  if (error === GUIDED_SCHEDULE_TIME_ERROR) {
                    setError('');
                  }
                }}
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
            className={clsx(
              'mt-[12px] max-w-[360px]',
              phase === 'submitting' && 'pointer-events-none opacity-60'
            )}
            aria-label="Scheduled date and time"
            aria-disabled={phase === 'submitting'}
          >
            <DatePicker
              date={date}
              onChange={(nextDate) => {
                if (submissionInFlightRef.current) {
                  return;
                }
                setDate(nextDate);
                if (error === GUIDED_SCHEDULE_TIME_ERROR) {
                  setError('');
                }
              }}
            />
            {!scheduleDateIsFuture && (
              <div className="mt-[7px] text-[12px] text-red-200" role="alert">
                {GUIDED_SCHEDULE_TIME_ERROR}
              </div>
            )}
          </div>
        )}

        {!!error && error !== GUIDED_SCHEDULE_TIME_ERROR && (
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
          {phase === 'failed' &&
            !ambiguous &&
            retryDestinationIds === null && (
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
              !submissionDestinations.length ||
              hasBlockingError ||
              !scheduleDateIsFuture
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
