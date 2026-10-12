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
import { INTERRUPTED_GENERATION, useComposerDraftRecovery } from './composer.draft.recovery';
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
  getGuidedComposerSourceType,
  selectGuidedGenerationMedia,
} from '@gitroom/frontend/components/new-launch/guided.composer.generation';
import {
  buildGuidedReviewDraftSeeds,
  getGuidedReviewDestinationLimit,
  getGuidedReviewDraftValidation,
  GuidedComposerReview,
} from '@gitroom/frontend/components/new-launch/guided.composer.review';
import {
  GuidedComposerPublish,
  GuidedComposerPublishBridgeProvider,
} from '@gitroom/frontend/components/new-launch/guided.composer.publish';
import { requestMediaCopyGenerationForDestinations } from '@gitroom/frontend/components/new-launch/copy-generation.client';
import { useResumableTransfers } from '../media/resumable-upload.provider';
import { useLaunchStore } from '@gitroom/frontend/components/new-launch/store';
import {
  isGuidedMp4MovMedia,
  selectGuidedSourceVideo,
} from '@gitroom/frontend/components/new-launch/guided.video.validation';
import { quickUploadAccountReason, quickUploadCopyReason, QuickUploadSkip } from './guided.composer.quick-upload';
import { stripHtmlValidation } from '@gitroom/helpers/utils/strip.html.validation';

export const GUIDED_COMPOSER_STEP_DETAILS: Record<
  GuidedComposerStep,
  {
    title: string;
    description: string;
  }
> = {
  upload: {
    title: 'Upload',
    description: 'Add your photo or video and any context the captions should use.',
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
  const recovery = useComposerDraftRecovery();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const generationRequestActiveRef = useRef(false);
  const generationAbortControllerRef = useRef<AbortController | null>(null);
  const composerMountedRef = useRef(true);
  const previousVideoIdsRef = useRef<Set<string> | null>(null);
  const [publishSubmitting, setPublishSubmitting] = useState(false);
  const [quickStage, setQuickStage] = useState<'idle' | 'resolving' | 'generating' | 'publishing' | 'done'>('idle');
  const [quickSkips, setQuickSkips] = useState<QuickUploadSkip[]>([]);
  const [quickError, setQuickError] = useState('');
  const quickInFlightRef = useRef(false);
  const quickGenerationStartedRef = useRef(false);
  const quickUpload = quickStage !== 'idle';

  const fetch = useFetch();
  const {
    global,
    integrations,
    selectedIntegrations,
    chars,
    detachGlobalValueMedia,
  } = useLaunchStore(
    useShallow((state) => ({
      global: state.global,
      integrations: state.integrations,
      selectedIntegrations: state.selectedIntegrations,
      chars: state.chars,
      detachGlobalValueMedia: state.detachGlobalValueMedia,
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
    invalidateReviewRegeneration,
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
      invalidateReviewRegeneration: state.invalidateReviewRegeneration,
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
    sourceType !== 'text'
      ? globalMedia.length > 0 && (sourceType !== 'video' || hasUploadedVideo) && (!needsSourceCaption || hasSourceCaption)
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
  const generationMedia = selectGuidedGenerationMedia(globalMedia, sourceMediaId);
  const generationFingerprint = useMemo(
    () =>
      buildGuidedGenerationFingerprint({
        mediaId: generationMedia?.id,
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
      generationMedia?.id,
    ]
  );
  const previousGenerationFingerprint = useRef(generationFingerprint);
  useEffect(() => {
    if (previousGenerationFingerprint.current !== generationFingerprint) {
      previousGenerationFingerprint.current = generationFingerprint;
      invalidateReviewRegeneration();
    }
  }, [generationFingerprint, invalidateReviewRegeneration]);
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
    publishSubmitting || quickStage === 'resolving' || quickStage === 'generating';
  const destinationRequiredForCurrentStep =
    currentStepIndex >= destinationStepIndex;
  const generationRequiredForCurrentStep =
    sourceType !== 'text' && currentStepIndex >= reviewStepIndex;
  const continueDisabled =
    navigationLocked ||
    (composerStep === 'upload' && !uploadStepValid) ||
    (destinationRequiredForCurrentStep && !destinationStepValid) ||
    (composerStep === 'destinations' &&
      sourceType !== 'text' &&
      !allSelectedDestinationsAvailable) ||
    (generationRequiredForCurrentStep && !generationReady) ||
    (composerStep === 'review' && !reviewStepValid);
  const uploadValidationMessage =
    sourceType === 'video' && !hasUploadedVideo
      ? 'Upload an MP4 or MOV video to continue.'
      : sourceType !== 'text' && needsSourceCaption && !hasSourceCaption
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
        sourceType !== 'text' &&
        !allSelectedDestinationsAvailable
      ? 'Wait for all selected destinations to load before generating captions.'
      : composerStep === 'review' && !enabledReviewDrafts.length
      ? 'Include at least one destination to continue.'
      : composerStep === 'review' && reviewHasBlockingError
      ? 'Resolve blocking caption errors or disable those destinations.'
      : '';

  useEffect(() => {
    const videos = (useLaunchStore.getState().global[0]?.media || []).filter(
      (media) => isGuidedMp4MovMedia(media)
    );
    const currentSourceId = useGuidedComposerStore.getState().sourceMediaId;
    const previousVideoIds = previousVideoIdsRef.current;
    const newlyAttachedVideo = previousVideoIds
      ? videos.find((media) => !previousVideoIds.has(media.id))
      : undefined;
    const currentSource = videos.find((media) => media.id === currentSourceId);
    const selectedSource =
      newlyAttachedVideo ||
      currentSource ||
      selectGuidedSourceVideo(videos, currentSourceId || undefined);

    previousVideoIdsRef.current = new Set(videos.map((media) => media.id));
    if (newlyAttachedVideo && currentSource && currentSource.id !== selectedSource?.id) {
      // Replacing the guided source only detaches it from this composition.
      detachGlobalValueMedia(0, currentSource.id);
    }
    if (currentSourceId !== (selectedSource?.id || null)) {
      selectSourceMedia(selectedSource?.id || null);
    }
  }, [globalMedia, sourceMediaId, selectSourceMedia, detachGlobalValueMedia]);

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
      transcriptionStatus === 'PROCESSING' || recovery.restoredSourceId === sourceMediaId ? 'GET' : 'POST'
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
    recovery.restoredSourceId,
  ]);

  useEffect(() => {
    pruneReviewDrafts(
      selectedIntegrations.map((selected) => selected.integration.id)
    );
  }, [pruneReviewDrafts, selectedIntegrations]);

  useEffect(() => {
    if (recovery.restored && generationError === INTERRUPTED_GENERATION) return;
    if (
      generationInputFingerprint &&
      generationInputFingerprint !== generationFingerprint &&
      generationStatus !== 'loading'
    ) {
      // Keep reviewed captions while guidance changes. The unequal fingerprint
      // still requires generation on Continue; guidance alone must not reseed
      // a manual edit from the legacy root caption.
      try {
        const previous = JSON.parse(generationInputFingerprint);
        const current = JSON.parse(generationFingerprint);
        if (JSON.stringify({ ...previous, additionalContext: '' }) ===
            JSON.stringify({ ...current, additionalContext: '' })) return;
      } catch {
        // Old/invalid fingerprints retain the existing invalidation behavior.
      }
      invalidateGeneration();
    }
  }, [
    generationFingerprint,
    generationInputFingerprint,
    generationStatus,
    invalidateGeneration,
    recovery.restored,
    generationError,
  ]);

  const generateForReview = useCallback(async () => {
    if (generationRequestActiveRef.current || generationStatus === 'loading') {
      return;
    }

    if (!allSelectedDestinationsAvailable) {
      return;
    }

    if (!generationMedia || !selectedDestinations.length) {
      failGeneration(
        !generationMedia
          ? 'Upload a photo or supported video before generating captions.'
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
          mediaId: generationMedia.id,
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
            setGenerationProgress(getGuidedGenerationProgress(name, data, sourceType === 'image' ? 'image' : 'video'));
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
      const currentGenerationMedia = selectGuidedGenerationMedia(currentMedia, currentGuidedState.sourceMediaId);
      const currentFingerprint = buildGuidedGenerationFingerprint({
        mediaId: currentGenerationMedia?.id,
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
    generationMedia,
    sourceType,
  ]);

  const resumableTransfers = useResumableTransfers();
  const startQuickUpload = async () => {
    if (
      quickInFlightRef.current ||
      navigationLocked ||
      recovery.publishLocked ||
      globalMedia.length !== 1 ||
      !hasUploadedVideo
    )
      return;
    quickInFlightRef.current = true;
    setQuickStage('resolving');
    setQuickError('');
    setQuickSkips([]);
    try {
      await resumableTransfers?.assertNoQuickUpload(globalMedia[0].id);
      const response = await fetch('/integrations/list');
      if (!response.ok)
        throw new Error(
          'Connected accounts could not be checked. Use Customize or try again.'
        );
      const payload = await response.json();
      if (!Array.isArray(payload?.integrations))
        throw new Error('Connected accounts could not be checked safely.');
      if (!composerMountedRef.current) return;
      const freshAccounts = payload.integrations as typeof integrations;
      const skipped = freshAccounts.flatMap((account) => {
        const message = quickUploadAccountReason(account);
        return message ? [{ integration: account.id, message }] : [];
      });
      // Show removed/disconnected accounts that were visible before the refresh.
      integrations
        .filter(
          (account) => !freshAccounts.some((fresh) => fresh.id === account.id)
        )
        .forEach((account) =>
          skipped.push({
            integration: account.id,
            message: 'Account is disconnected or unavailable.',
          })
        );
      const candidates = freshAccounts.filter(
        (account) => !quickUploadAccountReason(account)
      );
      setQuickSkips(skipped);
      if (!candidates.length)
        throw new Error(
          'No eligible connected video accounts. Use Customize to connect or configure accounts.'
        );
      const settings = new Map(
        useLaunchStore
          .getState()
          .selectedIntegrations.map((selected) => [
            selected.integration.id,
            selected.settings,
          ])
      );
      if (await resumableTransfers?.tryCompletedQuickUpload(globalMedia[0].id, {
        confirmNoIndividualReview: true,
        destinations: freshAccounts.map(account => ({ id: account.id, settings: {
          ...(account.identifier === 'x' ? { who_can_reply_post: 'everyone' } : account.identifier.startsWith('instagram') ? { post_type: 'reel', post_type_explicit: false } : {}),
          ...settings.get(account.id),
        } })),
      })) {
        setQuickStage('done'); quickInFlightRef.current = false;
        return;
      }
      useLaunchStore.setState({ integrations: freshAccounts });
      useLaunchStore
        .getState()
        .setSelectedIntegrations(
          candidates.map((account) => ({
            selectedIntegrations: account,
            settings: settings.get(account.id) || {},
          }))
        );
      useGuidedComposerStore.getState().setCaptionMode('generate');
      invalidateGeneration();
      quickGenerationStartedRef.current = false;
      setComposerStep('destinations');
      setQuickStage('generating');
    } catch (error) {
      if (composerMountedRef.current) {
        setQuickError(
          error instanceof Error ? error.message : 'Quick Upload could not start.'
        );
        setQuickStage('done');
        quickInFlightRef.current = false;
      }
    }
  };

  useEffect(() => {
    if (quickStage !== 'generating') return;
    if (generationStatus === 'failed') {
      setQuickSkips(current => [...current, ...selectedDestinations.map(account => ({ integration: account.id, message: 'Caption generation failed; use Customize.' }))]);
      setQuickError(
        generationError ||
          'Caption generation failed. Your video is preserved; use Customize.'
      );
      setQuickStage('done');
      quickInFlightRef.current = false;
      return;
    }
    if (generationReady) {
      const response = useGuidedComposerStore.getState().generatedResponse;
      const seeds = buildGuidedReviewDraftSeeds({
        destinations: selectedDestinations,
        generatedResponse: response,
        generationInputFingerprint,
        unsupportedDestinationIds: new Set(),
        fallbackCaption: '',
        originalCaption: '',
      });
      const newSkips: QuickUploadSkip[] = [];
      useGuidedComposerStore.getState().reconcileReviewDrafts(seeds);
      for (const seed of seeds) {
        const result = response?.results.find(
          (result) => result.platform === seed.platform
        );
        const limit = getGuidedReviewDestinationLimit({
          providerLimit: chars[seed.destinationId],
          platform: seed.platform,
        });
        const draft =
          useGuidedComposerStore.getState().reviewDrafts[seed.destinationId];
        const reason =
          quickUploadCopyReason(response, result) ||
          getGuidedReviewDraftValidation(draft, limit, true).errors[0];
        useGuidedComposerStore
          .getState()
          .setReviewDestinationEnabled(seed.destinationId, !reason);
        if (reason)
          newSkips.push({ integration: seed.destinationId, message: reason });
      }
      setQuickSkips((current) => [...current, ...newSkips]);
      if (newSkips.length === seeds.length) {
        setQuickError(
          'No captions are safe to publish without review. Your video is preserved; use Customize.'
        );
        setQuickStage('done');
        quickInFlightRef.current = false;
      } else {
        setQuickStage('publishing');
        setComposerStep('publish');
      }
    } else if (!quickGenerationStartedRef.current && !generationLoading) {
      quickGenerationStartedRef.current = true;
      void generateForReview();
    }
  }, [
    quickStage,
    generationStatus,
    generationError,
    generationReady,
    generationLoading,
    generationInputFingerprint,
    selectedDestinations,
    chars,
    generateForReview,
    setComposerStep,
  ]);

  const continueComposer = useCallback(() => {
    if (composerStep === 'destinations') {
      if (sourceType === 'text') {
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
      generationAbortControllerRef.current?.abort();
      generationAbortControllerRef.current = null;
      generationRequestActiveRef.current = false;
      if (!recovery.active) resetGuidedComposer();
    };
  }, [resetGuidedComposer, recovery.active]);

  return (
    <div data-composer-step={composerStep} className="guided-composer-shell flex h-full min-h-0 w-full flex-col overflow-hidden bg-newBgColor">
      <header className="guided-composer-header border-b border-newBorder bg-newBgColorInner px-[24px] py-[18px] mobile:px-[14px] mobile:py-[14px]">
        <div className="mx-auto flex w-full max-w-[1600px] min-w-0 flex-col gap-[16px]">
          <div className="mobile:hidden min-w-0">
            <div className="text-[13px] font-[700] uppercase tracking-[0.12em] text-textColor/55">
              Create post
            </div>
            <h1
              ref={headingRef}
              tabIndex={-1}
              className="mt-[4px] break-words text-[22px] font-[700] text-white outline-none mobile:text-[19px]"
            >
              {quickUpload ? 'Quick Upload' : currentStep.title}
            </h1>
            <p className="mt-[4px] max-w-[720px] break-words text-[13px] leading-[1.5] text-textColor/65">
              {currentStep.description}
            </p>
          </div>

          <nav hidden={quickUpload}
            aria-label="Post creation progress"
            className="guided-progress min-w-0 overflow-x-auto pb-[2px]"
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
                      aria-label={`${details.title} Step ${index + 1} of ${GUIDED_COMPOSER_STEPS.length}`}
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
          {composerStep === 'review' && !quickUpload && <GuidedComposerReview />}
          <div
            data-testid="guided-composer-upload-content"
            hidden={quickUpload || (composerStep !== 'upload' && composerStep !== 'review')}
            className={clsx("min-h-full", composerStep === 'review' && 'guided-review-existing-editor')}
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
            <GuidedComposerUploadDetails disabled={navigationLocked} />
          </div>
          {composerStep === 'destinations' && generationLoading && (
            <GuidedComposerGeneration progress={generationProgress} />
          )}
          {composerStep === 'destinations' && !generationLoading && !quickUpload && (
            <GuidedComposerDestinations disabled={navigationLocked} />
          )}
          {quickUpload && (
            <section aria-label="Quick Upload progress" className="mx-auto w-full max-w-[1120px] p-[20px] mobile:p-[14px]">
              <h2 className="text-[18px] font-bold">Quick Upload</h2>
              <p role="status">{quickStage === 'resolving' ? 'Checking connected accounts...' : quickStage === 'generating' ? generationProgress || 'Analyzing video and generating captions...' : 'Destination results'}</p>
              {quickError && <p role="alert">{quickError}</p>}
              {quickStage === 'generating' && selectedDestinations.map(account => <p key={account.id}>{account.name}: Processing</p>)}
              {quickSkips.map(skip => <p key={skip.integration} data-testid={`quick-skip-${skip.integration}`}><strong>{integrations.find(account => account.id === skip.integration)?.name || skip.integration}</strong>: {skip.message.startsWith('Reconnect') ? 'Reconnect required' : 'Skipped'} — {skip.message}</p>)}
              <button type="button" disabled={navigationLocked || publishSubmitting || recovery.publishLocked} onClick={() => { setQuickStage('idle'); quickInFlightRef.current = false; setComposerStep(generationReady ? 'review' : 'upload'); }} className="mt-[12px] min-h-[44px] rounded border border-newBorder px-[18px] disabled:opacity-40">Customize</button>
            </section>
          )}
          <GuidedComposerPublish
            quickUpload={quickUpload}
            active={composerStep === 'publish'}
            onSubmittingChange={setPublishSubmitting}
          />
        </GuidedComposerPublishBridgeProvider>
      </main>

      <footer className="guided-composer-footer border-t border-newBorder bg-newBgColorInner px-[24px] py-[14px] mobile:px-[14px]">
        <div className="mx-auto flex w-full max-w-[1600px] items-center justify-between gap-[12px] mobile:flex-col-reverse mobile:items-stretch">
          <button
            type="button"
            disabled={quickUpload || currentStepIndex === 0 || navigationLocked}
            onClick={previousComposerStep}
            className={clsx(composerStep === 'upload' && 'mobile:hidden', "flex h-[44px] min-w-[120px] items-center justify-center rounded-[8px] bg-btnSimple px-[18px] text-[14px] font-[700] disabled:cursor-not-allowed disabled:opacity-40 mobile:w-full")}
          >
            Back
          </button>

          {nextStep && !quickUpload && (
            <div className="flex min-w-0 flex-col items-end gap-[5px] mobile:items-stretch">
              {!!continueValidationMessage && (
                <div
                  role="status"
                  className={clsx(composerStep === 'upload' && !globalMedia.length && !global[0]?.content && 'mobile:hidden', "text-end text-[12px] text-textColor/55 mobile:text-start")}
                >
                  {continueValidationMessage}
                </div>
              )}
              {!!generationError &&
                composerStep === 'destinations' &&
                sourceType !== 'text' && (
                  <div
                    role="alert"
                    className="max-w-[460px] text-end text-[12px] text-red-400 mobile:text-start"
                  >
                    {generationError}
                  </div>
                )}
              {composerStep === 'upload' && globalMedia.length > 0 && (
                <>
                  <p id="quick-upload-warning" className="max-w-[480px] text-[12px] text-textColor/70">Quick Upload generates AI captions and publishes immediately to eligible accounts without individual review. Accounts needing settings or review will be skipped.</p>
                  <button type="button" aria-describedby="quick-upload-warning" disabled={navigationLocked || recovery.publishLocked || globalMedia.length !== 1 || !hasUploadedVideo} onClick={() => void startQuickUpload()} className="min-h-[44px] rounded-[8px] bg-btnPrimary px-[18px] font-bold text-white disabled:opacity-40 mobile:w-full">Quick Upload</button>
                </>
              )}
              <button
                type="button"
                aria-label={generationLoading ? 'Generating captions...' : sourceType !== 'text' && composerStep === 'destinations' && generationStatus === 'failed' ? 'Retry generation' : `Continue to ${GUIDED_COMPOSER_STEP_DETAILS[nextStep].title}`}
                disabled={continueDisabled}
                onClick={continueComposer}
                className="mobile-primary-action flex h-[44px] min-w-[190px] items-center justify-center rounded-[8px] bg-btnPrimary px-[18px] text-[14px] font-[700] text-white disabled:cursor-not-allowed disabled:opacity-50 mobile:w-full"
              >
                {generationLoading
                  ? 'Generating captions...'
                  : sourceType !== 'text' &&
                    composerStep === 'destinations' &&
                    generationStatus === 'failed'
                  ? 'Retry generation'
                  : <><span className="mobile:hidden">{composerStep === 'upload' ? 'Customize' : `Continue to ${GUIDED_COMPOSER_STEP_DETAILS[nextStep].title}`}</span>
                    <span className="hidden mobile:inline">{composerStep === 'upload' ? 'Customize' : 'Continue'}</span>
                    <svg className="hidden mobile:block" aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14m-6-6 6 6-6 6" /></svg></>}
              </button>
            </div>
          )}
        </div>
      </footer>
    </div>
  );
};
