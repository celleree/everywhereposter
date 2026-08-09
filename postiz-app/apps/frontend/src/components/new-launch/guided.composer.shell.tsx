'use client';

import React, {
  FC,
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import clsx from 'clsx';
import { useShallow } from 'zustand/react/shallow';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import {
  GUIDED_COMPOSER_STEPS,
  GuidedComposerStep,
  useGuidedComposerStore,
} from '@gitroom/frontend/components/new-launch/guided.composer.store';
import { GuidedComposerUploadDetails } from '@gitroom/frontend/components/new-launch/guided.composer.upload.details';
import { GuidedComposerDestinations } from '@gitroom/frontend/components/new-launch/guided.composer.destinations';
import {
  buildGuidedGenerationFingerprint,
  getGuidedGenerationProgress,
  GuidedComposerGeneration,
} from '@gitroom/frontend/components/new-launch/guided.composer.generation';
import {
  getGuidedReviewDestinationLimit,
  getGuidedReviewDraftValidation,
  GuidedComposerReview,
} from '@gitroom/frontend/components/new-launch/guided.composer.review';
import { requestMediaCopyGenerationForDestinations } from '@gitroom/frontend/components/new-launch/copy-generation.client';
import { useLaunchStore } from '@gitroom/frontend/components/new-launch/store';
import {
  isGuidedMp4MovMedia,
  selectGuidedSourceVideo,
} from '@gitroom/frontend/components/new-launch/guided.video.validation';
import { stripHtmlValidation } from '@gitroom/helpers/utils/strip.html.validation';

type GuidedComposerSourceType = 'text' | 'image' | 'video';

const GUIDED_VIDEO_PATH_PATTERN =
  /\.(mp4|mov|webm|m4v|avi|mkv|mpeg|mpg|ogv|3gp)(?:$|[?#])/i;

const isGuidedVideoMedia = (media: {
  path?: string;
  originalName?: string | null;
  type?: string | null;
}) => {
  const mediaType = (media.type || '').toLowerCase();

  return (
    mediaType === 'video' ||
    mediaType.startsWith('video/') ||
    GUIDED_VIDEO_PATH_PATTERN.test(media.originalName || media.path || '')
  );
};

const getGuidedComposerSourceType = (
  media: Array<{
    path?: string;
    originalName?: string | null;
    type?: string | null;
  }>
): GuidedComposerSourceType => {
  if (media.some(isGuidedVideoMedia)) {
    return 'video';
  }

  return media.length ? 'image' : 'text';
};

export const GUIDED_COMPOSER_STEP_DETAILS: Record<
  GuidedComposerStep,
  {
    title: string;
    description: string;
  }
> = {
  upload: {
    title: 'Upload',
    description: 'Add your video and any context the captions should use.',
  },
  destinations: {
    title: 'Destinations',
    description: 'Choose the platforms and connected accounts for this post.',
  },
  review: {
    title: 'Review',
    description: 'Review and refine each platform-specific version.',
  },
  publish: {
    title: 'Publish',
    description: 'Confirm the timing and destinations before publishing.',
  },
};

export const shouldUseGuidedComposerShell = ({
  enabled,
  existingIntegration,
  isCreateSet,
  dummy,
}: {
  enabled?: boolean;
  existingIntegration?: string;
  isCreateSet?: boolean;
  dummy?: boolean;
}) => enabled === true && !existingIntegration && !isCreateSet && !dummy;

export const GuidedComposerShell: FC<{
  children: ReactNode;
  locked?: boolean;
}> = ({ children, locked = false }) => {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const generationRequestActiveRef = useRef(false);
  const composerMountedRef = useRef(true);
  const previousVideoIdsRef = useRef<Set<string>>(new Set());
  const sourceMediaSnapshotRef = useRef<{
    id: string;
    path: string;
    thumbnail?: string;
  } | null>(null);
  const sourceDeletionInFlightRef = useRef<Set<string>>(new Set());
  const [sourceTransitionPending, setSourceTransitionPending] = useState(false);
  const [sourceTransitionError, setSourceTransitionError] = useState<
    string | null
  >(null);
  const fetch = useFetch();
  const {
    global,
    integrations,
    selectedIntegrations,
    chars,
    setGlobalValueMedia,
  } = useLaunchStore(
    useShallow((state) => ({
      global: state.global,
      integrations: state.integrations,
      selectedIntegrations: state.selectedIntegrations,
      chars: state.chars,
      setGlobalValueMedia: state.setGlobalValueMedia,
    }))
  );
  const {
    composerStep,
    sourceMediaId,
    transcriptionStatus,
    captionMode,
    sourceCaption,
    additionalContext,
    generationStatus,
    generationProgress,
    generationError,
    generationInputFingerprint,
    reviewDrafts,
    setComposerStep,
    selectSourceMedia,
    setTranscriptionState,
    nextComposerStep,
    previousComposerStep,
    startGeneration,
    setGenerationProgress,
    completeGeneration,
    failGeneration,
    invalidateGeneration,
    pruneReviewDrafts,
    resetGuidedComposer,
  } = useGuidedComposerStore(
    useShallow((state) => ({
      composerStep: state.composerStep,
      sourceMediaId: state.sourceMediaId,
      transcriptionStatus: state.transcriptionStatus,
      captionMode: state.captionMode,
      sourceCaption: state.sourceCaption,
      additionalContext: state.additionalContext,
      generationStatus: state.generationStatus,
      generationProgress: state.generationProgress,
      generationError: state.generationError,
      generationInputFingerprint: state.generationInputFingerprint,
      reviewDrafts: state.reviewDrafts,
      setComposerStep: state.setComposerStep,
      selectSourceMedia: state.selectSourceMedia,
      setTranscriptionState: state.setTranscriptionState,
      nextComposerStep: state.nextComposerStep,
      previousComposerStep: state.previousComposerStep,
      startGeneration: state.startGeneration,
      setGenerationProgress: state.setGenerationProgress,
      completeGeneration: state.completeGeneration,
      failGeneration: state.failGeneration,
      invalidateGeneration: state.invalidateGeneration,
      pruneReviewDrafts: state.pruneReviewDrafts,
      resetGuidedComposer: state.resetGuidedComposer,
    }))
  );

  const currentStepIndex = GUIDED_COMPOSER_STEPS.indexOf(composerStep);
  const destinationStepIndex = GUIDED_COMPOSER_STEPS.indexOf('destinations');
  const reviewStepIndex = GUIDED_COMPOSER_STEPS.indexOf('review');
  const currentStep = GUIDED_COMPOSER_STEP_DETAILS[composerStep];
  const nextStep = useMemo(
    () => GUIDED_COMPOSER_STEPS[currentStepIndex + 1],
    [currentStepIndex]
  );
  const globalMedia = global[0]?.media || [];
  const sourceType = getGuidedComposerSourceType(globalMedia);
  const hasUploadedVideo = globalMedia.some(
    (media) => media.id === sourceMediaId && isGuidedMp4MovMedia(media)
  );
  const legacyDraftValid =
    stripHtmlValidation('normal', global[0]?.content || '', true).length > 0 ||
    globalMedia.length > 0;
  const needsSourceCaption = captionMode !== 'generate';
  const hasSourceCaption = sourceCaption.trim().length > 0;
  const uploadStepValid =
    sourceType === 'video'
      ? hasUploadedVideo && (!needsSourceCaption || hasSourceCaption)
      : legacyDraftValid;
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
  const selectedDestinationCount = selectedIntegrations.filter((selected) =>
    availableDestinationIds.has(selected.integration.id)
  ).length;
  const allSelectedDestinationsAvailable =
    selectedIntegrations.length > 0 &&
    selectedIntegrations.every((selected) =>
      availableDestinationIds.has(selected.integration.id)
    );
  const destinationStepValid = selectedDestinationCount > 0;
  const selectedDestinations = useMemo(
    () =>
      selectedIntegrations
        .map((selected) => selected.integration)
        .filter((integration) => availableDestinationIds.has(integration.id)),
    [availableDestinationIds, selectedIntegrations]
  );
  const selectedGenerationDestinations = useMemo(
    () => selectedIntegrations.map((selected) => selected.integration),
    [selectedIntegrations]
  );
  const uploadedVideo = globalMedia.find(
    (media) => media.id === sourceMediaId && isGuidedMp4MovMedia(media)
  );
  const generationFingerprint = useMemo(
    () =>
      buildGuidedGenerationFingerprint({
        mediaId: uploadedVideo?.id,
        destinations: selectedGenerationDestinations,
        captionMode,
        sourceCaption,
        additionalContext,
      }),
    [
      additionalContext,
      captionMode,
      selectedGenerationDestinations,
      sourceCaption,
      uploadedVideo?.id,
    ]
  );
  const generationLoading = generationStatus === 'loading';
  const generationReady =
    generationInputFingerprint === generationFingerprint &&
    (generationStatus === 'complete' || generationStatus === 'partial');
  const selectedReviewDrafts = selectedDestinations
    .map((destination) => reviewDrafts[destination.id])
    .filter(Boolean);
  const enabledReviewDrafts = selectedReviewDrafts.filter(
    (draft) => draft.enabled
  );
  const reviewRegenerationLoading = enabledReviewDrafts.some(
    (draft) => draft.regenerationStatus === 'loading'
  );
  const reviewHasBlockingError = enabledReviewDrafts.some((draft) => {
    const limit = getGuidedReviewDestinationLimit({
      providerLimit: chars[draft.destinationId],
      platform: draft.platform,
    });
    return Boolean(
      getGuidedReviewDraftValidation(draft, limit, globalMedia.length > 0)
        .errors.length
    );
  });
  const reviewStepValid =
    selectedReviewDrafts.length === selectedDestinations.length &&
    enabledReviewDrafts.length > 0 &&
    !reviewHasBlockingError &&
    !reviewRegenerationLoading;
  const navigationLocked =
    locked || generationLoading || sourceTransitionPending;
  const destinationRequiredForCurrentStep =
    currentStepIndex >= destinationStepIndex;
  const generationRequiredForCurrentStep =
    sourceType === 'video' && currentStepIndex >= reviewStepIndex;
  const continueDisabled =
    navigationLocked ||
    (composerStep === 'upload' && !uploadStepValid) ||
    (destinationRequiredForCurrentStep && !destinationStepValid) ||
    (composerStep === 'destinations' &&
      sourceType === 'video' &&
      !allSelectedDestinationsAvailable) ||
    (generationRequiredForCurrentStep && !generationReady) ||
    (composerStep === 'review' && !reviewStepValid);
  const uploadValidationMessage =
    sourceType === 'video' && !hasUploadedVideo
      ? 'Upload an MP4 or MOV video to continue.'
      : sourceType === 'video' && needsSourceCaption && !hasSourceCaption
      ? 'Enter your caption to continue.'
      : !legacyDraftValid
      ? 'Enter post text or add media to continue.'
      : '';
  const continueValidationMessage =
    composerStep === 'upload'
      ? uploadValidationMessage
      : destinationRequiredForCurrentStep && !destinationStepValid
      ? 'Select at least one destination to continue.'
      : composerStep === 'destinations' &&
        sourceType === 'video' &&
        !allSelectedDestinationsAvailable
      ? 'Wait for all selected destinations to load before generating captions.'
      : composerStep === 'review' && !enabledReviewDrafts.length
      ? 'Include at least one destination to continue.'
      : composerStep === 'review' && reviewHasBlockingError
      ? 'Resolve blocking caption errors or disable those destinations.'
      : '';

  useEffect(() => {
    const videos = globalMedia.filter((media) => isGuidedMp4MovMedia(media));
    const previousVideoIds = previousVideoIdsRef.current;
    const newlyAttachedVideo = videos.find(
      (media) => !previousVideoIds.has(media.id)
    );
    const currentSource = videos.find((media) => media.id === sourceMediaId);
    const nextSource =
      newlyAttachedVideo && sourceMediaId && newlyAttachedVideo.id !== sourceMediaId
        ? newlyAttachedVideo
        : currentSource || selectGuidedSourceVideo(videos, sourceMediaId || undefined);
    const nextSourceId = nextSource?.id || null;

    previousVideoIdsRef.current = new Set(videos.map((media) => media.id));

    if (currentSource) {
      sourceMediaSnapshotRef.current = currentSource;
    }

    if (nextSourceId === sourceMediaId) {
      return;
    }

    const previousSourceId = sourceMediaId;
    if (!previousSourceId) {
      setSourceTransitionError(null);
      selectSourceMedia(nextSourceId);
      return;
    }

    if (sourceDeletionInFlightRef.current.has(previousSourceId)) {
      return;
    }

    sourceDeletionInFlightRef.current.add(previousSourceId);
    setSourceTransitionPending(true);
    setSourceTransitionError(null);

    const previousSource = sourceMediaSnapshotRef.current;
    if (
      previousSource?.id === previousSourceId &&
      !globalMedia.some((media) => media.id === previousSourceId)
    ) {
      setGlobalValueMedia(0, [...globalMedia, previousSource]);
    }

    void (async () => {
      try {
        const response = await fetch(`/media/${previousSourceId}`, {
          method: 'DELETE',
        });
        if (!response.ok) {
          throw new Error('The previous video could not be deleted.');
        }

        if (!composerMountedRef.current) {
          return;
        }

        const latestGuidedState = useGuidedComposerStore.getState();
        if (latestGuidedState.sourceMediaId !== previousSourceId) {
          return;
        }

        const latestLaunchState = useLaunchStore.getState();
        const latestMedia = latestLaunchState.global[0]?.media || [];
        const latestVideos = latestMedia.filter(
          (media) =>
            media.id !== previousSourceId && isGuidedMp4MovMedia(media)
        );
        const confirmedNextSource =
          latestVideos.find((media) => media.id === nextSourceId) ||
          selectGuidedSourceVideo(latestVideos, nextSourceId || undefined);

        selectSourceMedia(confirmedNextSource?.id || null);

        if (latestMedia.some((media) => media.id === previousSourceId)) {
          setGlobalValueMedia(
            0,
            latestMedia.filter((media) => media.id !== previousSourceId)
          );
        }
      } catch {
        if (!composerMountedRef.current) {
          return;
        }

        const latestLaunchState = useLaunchStore.getState();
        const latestMedia = latestLaunchState.global[0]?.media || [];
        const previousSource = sourceMediaSnapshotRef.current;
        if (
          previousSource?.id === previousSourceId &&
          !latestMedia.some((media) => media.id === previousSourceId)
        ) {
          setGlobalValueMedia(0, [...latestMedia, previousSource]);
        }
        setSourceTransitionError(
          'The previous video could not be removed. Please try again.'
        );
      } finally {
        sourceDeletionInFlightRef.current.delete(previousSourceId);
        if (composerMountedRef.current) {
          setSourceTransitionPending(false);
        }
      }
    })();
  }, [
    fetch,
    globalMedia,
    selectSourceMedia,
    setGlobalValueMedia,
    sourceMediaId,
  ]);

  useEffect(() => {
    if (
      !sourceMediaId ||
      transcriptionStatus === 'READY' ||
      transcriptionStatus === 'FAILED'
    ) {
      return;
    }

    let active = true;
    let statusTimer: ReturnType<typeof setTimeout> | undefined;

    const syncStatus = async (method: 'GET' | 'POST') => {
      try {
        const response = await fetch(
          method === 'POST'
            ? `/media/${sourceMediaId}/transcription/ensure`
            : `/media/${sourceMediaId}/transcription`,
          { method }
        );
        if (!response.ok) {
          throw new Error('Transcription could not be started.');
        }

        const status = await response.json();
        if (!active || status.mediaId !== sourceMediaId) {
          return;
        }

        setTranscriptionState(
          sourceMediaId,
          status.status,
          status.error?.message || null
        );

        if (status.status === 'PENDING' || status.status === 'PROCESSING') {
          statusTimer = setTimeout(() => void syncStatus('GET'), 2_000);
        }
      } catch (error) {
        if (active) {
          setTranscriptionState(
            sourceMediaId,
            'FAILED',
            error instanceof Error
              ? error.message
              : 'Transcription could not be started.'
          );
        }
      }
    };

    void syncStatus(
      transcriptionStatus === 'PROCESSING' ? 'GET' : 'POST'
    );

    return () => {
      active = false;
      if (statusTimer) {
        clearTimeout(statusTimer);
      }
    };
  }, [
    fetch,
    setTranscriptionState,
    sourceMediaId,
    transcriptionStatus,
  ]);

  useEffect(() => {
    pruneReviewDrafts(
      selectedIntegrations.map((selected) => selected.integration.id)
    );
  }, [pruneReviewDrafts, selectedIntegrations]);

  useEffect(() => {
    if (
      generationInputFingerprint &&
      generationInputFingerprint !== generationFingerprint &&
      generationStatus !== 'loading'
    ) {
      invalidateGeneration();
    }
  }, [
    generationFingerprint,
    generationInputFingerprint,
    generationStatus,
    invalidateGeneration,
  ]);

  const generateForReview = useCallback(async () => {
    if (generationRequestActiveRef.current || generationStatus === 'loading') {
      return;
    }

    if (!allSelectedDestinationsAvailable) {
      return;
    }

    if (!uploadedVideo || !selectedDestinations.length) {
      failGeneration(
        !uploadedVideo
          ? 'Upload an MP4 or MOV video before generating captions.'
          : 'Select at least one destination before generating captions.',
        { fingerprint: generationFingerprint }
      );
      return;
    }

    if (
      generationInputFingerprint === generationFingerprint &&
      (generationStatus === 'complete' || generationStatus === 'partial')
    ) {
      setComposerStep('review');
      return;
    }

    generationRequestActiveRef.current = true;
    startGeneration(generationFingerprint);

    try {
      const result = await requestMediaCopyGenerationForDestinations(
        fetch,
        selectedDestinations,
        {
          mediaId: uploadedVideo.id,
          captionMode,
          ...(captionMode !== 'generate' ? { sourceCaption } : {}),
          ...(additionalContext.trim()
            ? { additionalContext: additionalContext.trim() }
            : {}),
          goal: 'position',
        },
        (name, data) => {
          if (
            composerMountedRef.current &&
            useGuidedComposerStore.getState().generationInputFingerprint ===
              generationFingerprint
          ) {
            setGenerationProgress(getGuidedGenerationProgress(name, data));
          }
        }
      );

      if (!composerMountedRef.current) {
        return;
      }

      const currentLaunchState = useLaunchStore.getState();
      const currentGuidedState = useGuidedComposerStore.getState();
      const currentMedia = currentLaunchState.global[0]?.media || [];
      const currentVideo = currentMedia.find(
        (media) =>
          media.id === currentGuidedState.sourceMediaId &&
          isGuidedMp4MovMedia(media)
      );
      const currentFingerprint = buildGuidedGenerationFingerprint({
        mediaId: currentVideo?.id,
        destinations: currentLaunchState.selectedIntegrations.map(
          (selected) => selected.integration
        ),
        captionMode: currentGuidedState.captionMode,
        sourceCaption: currentGuidedState.sourceCaption,
        additionalContext: currentGuidedState.additionalContext,
      });

      if (currentFingerprint !== generationFingerprint) {
        invalidateGeneration();
        return;
      }

      if (!result.response) {
        failGeneration(
          'None of the selected destinations support caption generation yet.',
          {
            unsupportedDestinations: result.unsupportedDestinations,
            fingerprint: generationFingerprint,
          }
        );
        return;
      }

      if (
        result.response.status === 'failed' ||
        !result.response.results.length
      ) {
        failGeneration(
          result.response.warnings[0]?.message ||
            'We could not generate captions. Please try again.',
          {
            response: result.response,
            unsupportedDestinations: result.unsupportedDestinations,
            fingerprint: generationFingerprint,
          }
        );
        return;
      }

      completeGeneration(
        result.response,
        result.unsupportedDestinations,
        generationFingerprint
      );
      setComposerStep('review');
    } catch (error: any) {
      if (
        composerMountedRef.current &&
        useGuidedComposerStore.getState().generationInputFingerprint ===
          generationFingerprint
      ) {
        failGeneration(
          error?.message || 'We could not generate captions. Please try again.',
          { fingerprint: generationFingerprint }
        );
      }
    } finally {
      generationRequestActiveRef.current = false;
    }
  }, [
    additionalContext,
    allSelectedDestinationsAvailable,
    captionMode,
    completeGeneration,
    failGeneration,
    fetch,
    generationFingerprint,
    generationInputFingerprint,
    generationStatus,
    invalidateGeneration,
    selectedDestinations,
    setComposerStep,
    setGenerationProgress,
    sourceCaption,
    startGeneration,
    uploadedVideo,
  ]);

  const continueComposer = useCallback(() => {
    if (composerStep === 'destinations') {
      if (sourceType !== 'video') {
        if (
          generationStatus !== 'idle' ||
          generationInputFingerprint !== null
        ) {
          invalidateGeneration();
        }
        setComposerStep('review');
        return;
      }

      void generateForReview();
      return;
    }

    nextComposerStep();
  }, [
    composerStep,
    generateForReview,
    generationInputFingerprint,
    generationStatus,
    invalidateGeneration,
    nextComposerStep,
    setComposerStep,
    sourceType,
  ]);

  useEffect(() => {
    headingRef.current?.focus();
  }, [composerStep]);

  useEffect(() => {
    composerMountedRef.current = true;
    return () => {
      composerMountedRef.current = false;
      resetGuidedComposer();
    };
  }, [resetGuidedComposer]);

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-newBgColor">
      <header className="border-b border-newBorder bg-newBgColorInner px-[24px] py-[18px] mobile:px-[14px] mobile:py-[14px]">
        <div className="mx-auto flex w-full max-w-[1600px] min-w-0 flex-col gap-[16px]">
          <div className="min-w-0">
            <div className="text-[13px] font-[700] uppercase tracking-[0.12em] text-textColor/55">
              Create post
            </div>
            <h1
              ref={headingRef}
              tabIndex={-1}
              className="mt-[4px] break-words text-[22px] font-[700] text-white outline-none mobile:text-[19px]"
            >
              {currentStep.title}
            </h1>
            <p className="mt-[4px] max-w-[720px] break-words text-[13px] leading-[1.5] text-textColor/65">
              {currentStep.description}
            </p>
          </div>

          <nav
            aria-label="Post creation progress"
            className="min-w-0 overflow-x-auto pb-[2px]"
          >
            <ol className="flex min-w-max items-center gap-[8px]">
              {GUIDED_COMPOSER_STEPS.map((step, index) => {
                const details = GUIDED_COMPOSER_STEP_DETAILS[step];
                const isActive = step === composerStep;
                const isComplete = index < currentStepIndex;
                const isFuture = index > currentStepIndex;

                return (
                  <li key={step} className="flex items-center gap-[8px]">
                    <button
                      type="button"
                      aria-current={isActive ? 'step' : undefined}
                      disabled={
                        isFuture || navigationLocked || (locked && !isActive)
                      }
                      onClick={() => setComposerStep(step)}
                      className={clsx(
                        'flex min-w-[145px] items-center gap-[10px] rounded-[12px] border px-[12px] py-[10px] text-left transition-colors disabled:cursor-not-allowed mobile:min-w-[132px]',
                        isActive
                          ? 'border-ai bg-newBgLineColor'
                          : isComplete
                          ? 'border-ai/50 bg-newBgColor [@media(hover:hover)]:hover:border-ai'
                          : 'border-newBorder bg-newBgColor opacity-55'
                      )}
                    >
                      <span
                        className={clsx(
                          'flex h-[28px] w-[28px] min-w-[28px] items-center justify-center rounded-full text-[12px] font-[700]',
                          isActive || isComplete
                            ? 'bg-btnPrimary text-white'
                            : 'bg-newSettings text-textColor/70'
                        )}
                      >
                        {index + 1}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] font-[700] text-white">
                          {details.title}
                        </span>
                        <span className="mt-[1px] block text-[11px] text-textColor/55">
                          Step {index + 1} of {GUIDED_COMPOSER_STEPS.length}
                        </span>
                      </span>
                    </button>

                    {index < GUIDED_COMPOSER_STEPS.length - 1 && (
                      <div
                        aria-hidden="true"
                        className={clsx(
                          'h-px w-[24px]',
                          index < currentStepIndex ? 'bg-ai/70' : 'bg-newBorder'
                        )}
                      />
                    )}
                  </li>
                );
              })}
            </ol>
          </nav>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto">
        <div
          data-testid="guided-composer-upload-content"
          hidden={composerStep !== 'upload'}
          className="min-h-full"
        >
          <div className="guided-upload-existing-composer">
            {children}
            <style>
              {`
                .guided-upload-existing-composer #social-content > section:not([data-guided-composer-section="media"]):not([data-guided-composer-section="editor"]) {
                  display: none !important;
                }
                .guided-upload-existing-composer div[class*="w-[580px]"] {
                  display: none !important;
                }
                .guided-upload-existing-composer div[class*="min-h-[84px]"] {
                  display: none !important;
                }
                .guided-upload-existing-composer div[class*="min-h-[65px]"] {
                  display: none !important;
                }
                .guided-upload-existing-composer > :not(:first-child) {
                  display: none !important;
                }
              `}
            </style>
          </div>
          <GuidedComposerUploadDetails
            disabled={navigationLocked}
            sourceMutationError={sourceTransitionError}
          />
        </div>
        {composerStep === 'destinations' && generationLoading && (
          <GuidedComposerGeneration progress={generationProgress} />
        )}
        {composerStep === 'destinations' && !generationLoading && (
          <GuidedComposerDestinations disabled={navigationLocked} />
        )}
        {composerStep === 'review' && <GuidedComposerReview />}
        {composerStep === 'publish' && (
          <GuidedComposerPlaceholder step="publish" />
        )}
      </main>

      <footer className="border-t border-newBorder bg-newBgColorInner px-[24px] py-[14px] mobile:px-[14px]">
        <div className="mx-auto flex w-full max-w-[1600px] items-center justify-between gap-[12px] mobile:flex-col-reverse mobile:items-stretch">
          <button
            type="button"
            disabled={currentStepIndex === 0 || navigationLocked}
            onClick={previousComposerStep}
            className="flex h-[44px] min-w-[120px] items-center justify-center rounded-[8px] bg-btnSimple px-[18px] text-[14px] font-[700] disabled:cursor-not-allowed disabled:opacity-40 mobile:w-full"
          >
            Back
          </button>

          <div className="flex min-w-0 flex-col items-end gap-[5px] mobile:items-stretch">
            {!!continueValidationMessage && (
              <div
                role="status"
                className="text-end text-[12px] text-textColor/55 mobile:text-start"
              >
                {continueValidationMessage}
              </div>
            )}
            {!!generationError &&
              composerStep === 'destinations' &&
              sourceType === 'video' && (
                <div
                  role="alert"
                  className="max-w-[460px] text-end text-[12px] text-red-400 mobile:text-start"
                >
                  {generationError}
                </div>
              )}
            {nextStep ? (
              <button
                type="button"
                disabled={continueDisabled}
                onClick={continueComposer}
                className="flex h-[44px] min-w-[190px] items-center justify-center rounded-[8px] bg-btnPrimary px-[18px] text-[14px] font-[700] text-white disabled:cursor-not-allowed disabled:opacity-50 mobile:w-full"
              >
                {generationLoading
                  ? 'Generating captions...'
                  : sourceType === 'video' &&
                    composerStep === 'destinations' &&
                    generationStatus === 'failed'
                  ? 'Retry generation'
                  : `Continue to ${GUIDED_COMPOSER_STEP_DETAILS[nextStep].title}`}
              </button>
            ) : (
              <button
                type="button"
                disabled
                className="flex h-[44px] min-w-[190px] items-center justify-center rounded-[8px] bg-btnPrimary px-[18px] text-[14px] font-[700] text-white opacity-50 mobile:w-full"
              >
                Publish
              </button>
            )}
          </div>
        </div>
      </footer>
    </div>
  );
};

const GuidedComposerPlaceholder: FC<{
  step: 'publish';
}> = ({ step }) => {
  const details = GUIDED_COMPOSER_STEP_DETAILS[step];

  return (
    <div className="flex min-h-full w-full items-center justify-center p-[40px] mobile:p-[18px]">
      <div className="w-full max-w-[680px] rounded-[20px] border border-newBorder bg-newBgColorInner p-[28px] text-center mobile:rounded-[16px] mobile:p-[20px]">
        <div className="mx-auto flex h-[42px] w-[42px] items-center justify-center rounded-full bg-newBgLineColor text-[14px] font-[700] text-white">
          {GUIDED_COMPOSER_STEPS.indexOf(step) + 1}
        </div>
        <h2 className="mt-[16px] text-[22px] font-[700] text-white mobile:text-[19px]">
          {details.title}
        </h2>
        <p className="mx-auto mt-[8px] max-w-[500px] text-[14px] leading-[1.6] text-textColor/65">
          {details.description}
        </p>
        <p className="mx-auto mt-[12px] max-w-[500px] text-[12px] leading-[1.5] text-textColor/45">
          The existing controls for this stage will be connected in the next
          implementation phase.
        </p>
      </div>
    </div>
  );
};
