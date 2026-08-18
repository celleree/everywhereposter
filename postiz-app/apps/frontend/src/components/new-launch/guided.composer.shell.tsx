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
import {
  getGuidedAvailableIntegrations,
  GuidedComposerDestinations,
} from '@gitroom/frontend/components/new-launch/guided.composer.destinations';
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
import {
  GuidedComposerPublish,
  GuidedComposerPublishBridgeProvider,
} from '@gitroom/frontend/components/new-launch/guided.composer.publish';
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

type SourceIntent = {
  mediaId: string | null;
  revision: number;
};

type PendingCleanup = {
  id: string;
  kind: 'source' | 'obsolete';
};

type ReconciliationOwner = {
  active: boolean;
  running: boolean;
  pendingCleanup: PendingCleanup | null;
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
  const generationAbortControllerRef = useRef<AbortController | null>(null);
  const composerMountedRef = useRef(true);
  const previousVideoIdsRef = useRef<Set<string>>(new Set());
  const latestSourceIntentRef = useRef<SourceIntent | null>(null);
  const sourceMediaSnapshotRef = useRef<{
    id: string;
    path: string;
    thumbnail?: string;
  } | null>(null);
  const obsoleteSourceIntentIdsRef = useRef<Set<string>>(new Set());
  const sourceReconciliationOwnerRef = useRef<ReconciliationOwner>({
    active: false,
    running: false,
    pendingCleanup: null,
  });
  const [sourceTransitionPending, setSourceTransitionPending] = useState(false);
  const [sourceTransitionError, setSourceTransitionError] = useState<
    string | null
  >(null);
  const [sourceReconciliationRunning, setSourceReconciliationRunning] =
    useState(false);
  const [publishSubmitting, setPublishSubmitting] = useState(false);
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
        getGuidedAvailableIntegrations(integrations).map(
          (integration) => integration.id
        )
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
    locked ||
    generationLoading ||
    sourceTransitionPending ||
    !!sourceTransitionError ||
    publishSubmitting;
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

  const runSourceReconciliation = useCallback(async () => {
    const owner = sourceReconciliationOwnerRef.current;
    if (!composerMountedRef.current || !owner.active || owner.running) {
      return;
    }

    owner.running = true;
    setSourceReconciliationRunning(true);
    setSourceTransitionError(null);

    try {
      while (composerMountedRef.current && owner.active) {
        const intent = latestSourceIntentRef.current;
        if (!intent) {
          owner.active = false;
          owner.pendingCleanup = null;
          setSourceTransitionPending(false);
          return;
        }

        const guidedState = useGuidedComposerStore.getState();
        const media = useLaunchStore.getState().global[0]?.media || [];
        const attachedVideoIds = new Set(
          media
            .filter((item) => isGuidedMp4MovMedia(item))
            .map((item) => item.id)
        );

        for (const obsoleteId of Array.from(
          obsoleteSourceIntentIdsRef.current
        )) {
          if (
            !attachedVideoIds.has(obsoleteId) ||
            obsoleteId === guidedState.sourceMediaId ||
            obsoleteId === intent.mediaId
          ) {
            obsoleteSourceIntentIdsRef.current.delete(obsoleteId);
          }
        }

        if (!owner.pendingCleanup) {
          if (
            guidedState.sourceMediaId &&
            guidedState.sourceMediaId !== intent.mediaId
          ) {
            owner.pendingCleanup = {
              id: guidedState.sourceMediaId,
              kind: 'source',
            };
          } else {
            const obsoleteId = Array.from(
              obsoleteSourceIntentIdsRef.current
            ).find((id) => attachedVideoIds.has(id));
            if (obsoleteId) {
              owner.pendingCleanup = { id: obsoleteId, kind: 'obsolete' };
            }
          }
        }

        if (!owner.pendingCleanup) {
          if (guidedState.sourceMediaId !== intent.mediaId) {
            const intendedSource = media.find(
              (item) =>
                item.id === intent.mediaId && isGuidedMp4MovMedia(item)
            );
            selectSourceMedia(intendedSource?.id || null);
            continue;
          }

          if (latestSourceIntentRef.current?.revision !== intent.revision) {
            continue;
          }

          owner.active = false;
          setSourceTransitionPending(false);
          setSourceTransitionError(null);
          return;
        }

        const cleanup = owner.pendingCleanup;
        const latestIntent = latestSourceIntentRef.current;
        const latestGuidedState = useGuidedComposerStore.getState();
        const latestMedia = useLaunchStore.getState().global[0]?.media || [];
        const cleanupAttached = latestMedia.some(
          (item) => item.id === cleanup.id
        );

        if (!cleanupAttached) {
          obsoleteSourceIntentIdsRef.current.delete(cleanup.id);
          owner.pendingCleanup = null;
          if (
            cleanup.kind === 'source' &&
            latestGuidedState.sourceMediaId === cleanup.id
          ) {
            const intendedSource = latestMedia.find(
              (item) =>
                item.id === latestIntent?.mediaId &&
                isGuidedMp4MovMedia(item)
            );
            selectSourceMedia(intendedSource?.id || null);
          }
          continue;
        }

        if (cleanup.kind === 'source') {
          if (latestGuidedState.sourceMediaId !== cleanup.id) {
            if (
              cleanup.id !== latestIntent?.mediaId &&
              cleanup.id !== latestGuidedState.sourceMediaId
            ) {
              obsoleteSourceIntentIdsRef.current.add(cleanup.id);
            }
            owner.pendingCleanup = null;
            continue;
          }

          if (!latestIntent || latestIntent.mediaId === cleanup.id) {
            owner.pendingCleanup = null;
            continue;
          }

          if (
            latestIntent.mediaId &&
            !latestMedia.some(
              (item) =>
                item.id === latestIntent.mediaId &&
                isGuidedMp4MovMedia(item)
            )
          ) {
            throw new Error('The replacement video is no longer attached.');
          }
        } else if (
          cleanup.id === latestGuidedState.sourceMediaId ||
          cleanup.id === latestIntent?.mediaId
        ) {
          obsoleteSourceIntentIdsRef.current.delete(cleanup.id);
          owner.pendingCleanup = null;
          continue;
        }

        const response = await fetch(`/media/${cleanup.id}`, {
          method: 'DELETE',
        });
        if (!response.ok) {
          throw new Error('The previous video could not be deleted.');
        }

        if (!composerMountedRef.current) {
          return;
        }

        const reconciledIntent = latestSourceIntentRef.current;
        const reconciledGuidedState = useGuidedComposerStore.getState();
        const reconciledMedia =
          useLaunchStore.getState().global[0]?.media || [];

        if (cleanup.kind === 'source') {
          const remainingMedia = reconciledMedia.filter(
            (item) => item.id !== cleanup.id
          );
          previousVideoIdsRef.current = new Set(
            remainingMedia
              .filter((item) => isGuidedMp4MovMedia(item))
              .map((item) => item.id)
          );
          setGlobalValueMedia(0, remainingMedia);

          const intendedSource = remainingMedia.find(
            (item) =>
              item.id === reconciledIntent?.mediaId &&
              isGuidedMp4MovMedia(item)
          );
          selectSourceMedia(intendedSource?.id || null);
        } else if (
          cleanup.id !== reconciledGuidedState.sourceMediaId &&
          cleanup.id !== reconciledIntent?.mediaId
        ) {
          const remainingMedia = reconciledMedia.filter(
            (item) => item.id !== cleanup.id
          );
          previousVideoIdsRef.current = new Set(
            remainingMedia
              .filter((item) => isGuidedMp4MovMedia(item))
              .map((item) => item.id)
          );
          setGlobalValueMedia(0, remainingMedia);
        }

        obsoleteSourceIntentIdsRef.current.delete(cleanup.id);
        owner.pendingCleanup = null;
      }
    } catch {
      if (composerMountedRef.current) {
        setSourceTransitionError(
          'The previous video could not be removed. Please try again.'
        );
      }
    } finally {
      owner.running = false;
      if (composerMountedRef.current) {
        setSourceReconciliationRunning(false);
      }
    }
  }, [fetch, selectSourceMedia, setGlobalValueMedia]);

  useEffect(() => {
    const videos = globalMedia.filter((media) => isGuidedMp4MovMedia(media));
    const previousVideoIds = previousVideoIdsRef.current;
    const newlyAttachedVideo = videos.find(
      (media) => !previousVideoIds.has(media.id)
    );
    const currentSource = videos.find((media) => media.id === sourceMediaId);
    const selectedSource =
      currentSource || selectGuidedSourceVideo(videos, sourceMediaId || undefined);

    if (!latestSourceIntentRef.current) {
      latestSourceIntentRef.current = {
        mediaId: selectedSource?.id || null,
        revision: 0,
      };
      previousVideoIdsRef.current = new Set(videos.map((media) => media.id));
      if (currentSource) {
        sourceMediaSnapshotRef.current = currentSource;
      }
      if (!sourceMediaId && selectedSource) {
        selectSourceMedia(selectedSource.id);
      }
      return;
    }

    if (newlyAttachedVideo) {
      const previousIntentId = latestSourceIntentRef.current.mediaId;
      if (
        previousIntentId &&
        previousIntentId !== newlyAttachedVideo.id &&
        previousIntentId !== sourceMediaId
      ) {
        obsoleteSourceIntentIdsRef.current.add(previousIntentId);
      }
      latestSourceIntentRef.current = {
        mediaId: newlyAttachedVideo.id,
        revision: latestSourceIntentRef.current.revision + 1,
      };
    } else if (
      sourceMediaId &&
      !currentSource &&
      !sourceReconciliationOwnerRef.current.active
    ) {
      latestSourceIntentRef.current = {
        mediaId: selectedSource?.id || null,
        revision: latestSourceIntentRef.current.revision + 1,
      };
    }

    previousVideoIdsRef.current = new Set(videos.map((media) => media.id));

    if (currentSource) {
      sourceMediaSnapshotRef.current = currentSource;
    }

    const intent = latestSourceIntentRef.current;
    const hasObsoleteCleanup = Array.from(
      obsoleteSourceIntentIdsRef.current
    ).some(
      (id) =>
        id !== sourceMediaId &&
        id !== intent.mediaId &&
        globalMedia.some((media) => media.id === id)
    );
    const needsSourceTransition = sourceMediaId !== intent.mediaId;

    if (!needsSourceTransition && !hasObsoleteCleanup) {
      return;
    }

    if (
      sourceMediaId &&
      !currentSource &&
      sourceMediaSnapshotRef.current?.id === sourceMediaId
    ) {
      const restoredMedia = [...globalMedia, sourceMediaSnapshotRef.current];
      previousVideoIdsRef.current = new Set(
        restoredMedia
          .filter((media) => isGuidedMp4MovMedia(media))
          .map((media) => media.id)
      );
      setGlobalValueMedia(0, restoredMedia);
    }

    const owner = sourceReconciliationOwnerRef.current;
    if (owner.active) {
      return;
    }

    owner.active = true;
    owner.pendingCleanup = null;
    setSourceTransitionPending(true);
    void runSourceReconciliation();
  }, [
    globalMedia,
    runSourceReconciliation,
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
    const abortController = new AbortController();
    generationAbortControllerRef.current = abortController;
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
        },
        abortController.signal
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
        if (captionMode === 'use-everywhere') {
          completeGeneration(
            null,
            result.unsupportedDestinations,
            generationFingerprint
          );
          setComposerStep('review');
        } else {
          failGeneration(
            'None of the selected destinations support caption generation yet.',
            {
              unsupportedDestinations: result.unsupportedDestinations,
              fingerprint: generationFingerprint,
            }
          );
        }
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
      if (generationAbortControllerRef.current === abortController) {
        generationAbortControllerRef.current = null;
      }
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

  const retrySourceCleanup = useCallback(() => {
    const owner = sourceReconciliationOwnerRef.current;
    if (!owner.active || !owner.pendingCleanup || owner.running) {
      return;
    }

    void runSourceReconciliation();
  }, [runSourceReconciliation]);

  useEffect(() => {
    headingRef.current?.focus();
  }, [composerStep]);

  useEffect(() => {
    composerMountedRef.current = true;
    return () => {
      composerMountedRef.current = false;
      sourceReconciliationOwnerRef.current.active = false;
      sourceReconciliationOwnerRef.current.running = false;
      sourceReconciliationOwnerRef.current.pendingCleanup = null;
      generationAbortControllerRef.current?.abort();
      generationAbortControllerRef.current = null;
      generationRequestActiveRef.current = false;
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
        <GuidedComposerPublishBridgeProvider>
          <div
            data-testid="guided-composer-upload-content"
            hidden={composerStep !== 'upload'}
            className="min-h-full"
          >
            <div className="guided-upload-existing-composer">
              {children}
              <style>
                {`
                .guided-upload-existing-composer #social-content > section:not([data-guided-composer-section="media"]):not([data-guided-composer-section="editor"]):not([data-guided-composer-section="settings"]) {
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
            {!!sourceTransitionError &&
              !!sourceReconciliationOwnerRef.current.pendingCleanup && (
                <div className="mx-auto flex w-full max-w-[1600px] justify-end px-[40px] pt-[10px] mobile:px-[12px]">
                  <button
                    type="button"
                    onClick={retrySourceCleanup}
                    disabled={sourceReconciliationRunning}
                    className="flex h-[36px] items-center justify-center rounded-[8px] bg-btnSimple px-[14px] text-[13px] font-[700] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Retry cleanup
                  </button>
                </div>
              )}
          </div>
          {composerStep === 'destinations' && generationLoading && (
            <GuidedComposerGeneration progress={generationProgress} />
          )}
          {composerStep === 'destinations' && !generationLoading && (
            <GuidedComposerDestinations disabled={navigationLocked} />
          )}
          {composerStep === 'review' && <GuidedComposerReview />}
          <GuidedComposerPublish
            active={composerStep === 'publish'}
            onSubmittingChange={setPublishSubmitting}
          />
        </GuidedComposerPublishBridgeProvider>
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

          {nextStep && (
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
            </div>
          )}
        </div>
      </footer>
    </div>
  );
};
