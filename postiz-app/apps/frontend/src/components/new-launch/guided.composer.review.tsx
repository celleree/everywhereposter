'use client';

import React, { FC, useCallback, useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { useShallow } from 'zustand/react/shallow';
import ImageWithFallback from '@gitroom/react/helpers/image.with.fallback';
import { VideoFrame } from '@gitroom/react/helpers/video.frame';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { stripHtmlValidation } from '@gitroom/helpers/utils/strip.html.validation';
import { weightedLength } from '@gitroom/helpers/utils/count.length';
import type { Integrations } from '@gitroom/frontend/components/launches/calendar.context';
import {
  mapIntegrationIdentifierToCopyPlatform,
  PLATFORM_RULES,
} from '@gitroom/nestjs-libraries/copy-generation/platform-rules';
import type { CopyPlatform } from '@gitroom/nestjs-libraries/copy-generation/platform-rules';
import type {
  CopyGenerationWarning,
  GenerateMediaCopyResponse,
} from '@gitroom/nestjs-libraries/dtos/copy-generation/generate.media.copy.response';
import { requestMediaCopyGenerationForDestinations } from '@gitroom/frontend/components/new-launch/copy-generation.client';
import {
  getGuidedAvailableIntegrations,
  getGuidedPlatformIdentity,
} from '@gitroom/frontend/components/new-launch/guided.composer.destinations';
import {
  GuidedReviewCaptionSource,
  GuidedReviewDraft,
  GuidedReviewDraftSeed,
  useGuidedComposerStore,
} from '@gitroom/frontend/components/new-launch/guided.composer.store';
import { useLaunchStore } from '@gitroom/frontend/components/new-launch/store';
import { isGuidedMp4MovMedia } from '@gitroom/frontend/components/new-launch/guided.video.validation';

const SOURCE_LABELS: Record<GuidedReviewCaptionSource, string> = {
  generated: 'AI generated',
  original: 'Original caption',
  adapted: 'Adapted from your caption',
  edited: 'Edited by you',
};

export const getGuidedReviewCaptionSourceLabel = (
  source: GuidedReviewCaptionSource
) => SOURCE_LABELS[source];

const uniqueWarnings = (warnings: CopyGenerationWarning[]) =>
  warnings.filter(
    (warning, index) =>
      warnings.findIndex(
        (candidate) =>
          candidate.code === warning.code &&
          candidate.message === warning.message
      ) === index
  );

export const buildGuidedReviewDraftSeeds = ({
  destinations,
  generatedResponse,
  generationInputFingerprint,
  unsupportedDestinationIds,
  fallbackCaption,
  originalCaption,
}: {
  destinations: Integrations[];
  generatedResponse: GenerateMediaCopyResponse | null;
  generationInputFingerprint: string | null;
  unsupportedDestinationIds: Set<string>;
  fallbackCaption: string;
  originalCaption: string;
}): GuidedReviewDraftSeed[] =>
  destinations.map((destination) => {
    const platform = mapIntegrationIdentifierToCopyPlatform(
      destination.identifier
    );
    const result = generatedResponse?.results.find(
      (candidate) => candidate.platform === platform
    );
    const fallbackWarning: CopyGenerationWarning[] = result
      ? []
      : [
          {
            code: unsupportedDestinationIds.has(destination.id)
              ? 'PLATFORM_UNSUPPORTED'
              : 'PLATFORM_RESULT_MISSING',
            message: unsupportedDestinationIds.has(destination.id)
              ? 'Automatic caption generation is not available for this destination. Review the original caption before continuing.'
              : 'No generated caption was returned for this destination. Review the original caption before continuing.',
          },
        ];
    const caption = result?.draft ?? fallbackCaption;
    const baselineSource = result?.origin ?? 'original';
    const warnings = uniqueWarnings([
      ...(result?.warnings || []),
      ...fallbackWarning,
    ]);
    const sourceFingerprint = JSON.stringify({
      destinationId: destination.id,
      generationInputFingerprint,
      requestId: generatedResponse?.requestId || null,
      platform,
      result: result
        ? {
            draft: result.draft,
            origin: result.origin,
            warnings: result.warnings,
          }
        : null,
      fallbackCaption,
      warnings,
    });

    return {
      destinationId: destination.id,
      platform,
      sourceFingerprint,
      caption,
      baselineCaption: caption,
      baselineSource,
      originalCaption,
      warnings,
    };
  });

export const getGuidedReviewDestinationLimit = ({
  providerLimit,
  platform,
}: {
  providerLimit?: number;
  platform: CopyPlatform | null;
}) => {
  if (typeof providerLimit === 'number' && providerLimit > 0) {
    return providerLimit;
  }

  return platform ? PLATFORM_RULES[platform].hardCap : null;
};

export const getGuidedReviewDraftValidation = (
  draft: GuidedReviewDraft,
  limit: number | null,
  hasMedia: boolean
) => {
  let characterCount = draft.caption.length;
  if (draft.platform === 'x') {
    const normalizedCaption = stripHtmlValidation(
      'normal',
      draft.caption,
      true
    );
    characterCount = Math.max(
      weightedLength(normalizedCaption),
      normalizedCaption.length
    );
  }
  const errors: string[] = [];

  if (limit !== null && characterCount > limit) {
    errors.push(
      `Caption is ${
        characterCount - limit
      } characters over the ${limit}-character limit.`
    );
  }
  if (!draft.caption.trim() && !hasMedia) {
    errors.push('Add a caption or media before continuing.');
  }

  return {
    characterCount,
    errors,
    warnings: draft.warnings.map((warning) => warning.message),
  };
};

export const GuidedComposerReview: FC = () => {
  const fetch = useFetch();
  const { global, integrations, selectedIntegrations, chars } = useLaunchStore(
    useShallow((state) => ({
      global: state.global,
      integrations: state.integrations,
      selectedIntegrations: state.selectedIntegrations,
      chars: state.chars,
    }))
  );
  const {
    captionMode,
    sourceCaption,
    additionalContext,
    generatedResponse,
    generationInputFingerprint,
    unsupportedDestinations,
    reviewDrafts,
    reconcileReviewDrafts,
    editReviewCaption,
    resetReviewCaption,
    setReviewDestinationEnabled,
    startReviewRegeneration,
    completeReviewRegeneration,
    failReviewRegeneration,
  } = useGuidedComposerStore(
    useShallow((state) => ({
      captionMode: state.captionMode,
      sourceCaption: state.sourceCaption,
      additionalContext: state.additionalContext,
      generatedResponse: state.generatedResponse,
      generationInputFingerprint: state.generationInputFingerprint,
      unsupportedDestinations: state.unsupportedDestinations,
      reviewDrafts: state.reviewDrafts,
      reconcileReviewDrafts: state.reconcileReviewDrafts,
      editReviewCaption: state.editReviewCaption,
      resetReviewCaption: state.resetReviewCaption,
      setReviewDestinationEnabled: state.setReviewDestinationEnabled,
      startReviewRegeneration: state.startReviewRegeneration,
      completeReviewRegeneration: state.completeReviewRegeneration,
      failReviewRegeneration: state.failReviewRegeneration,
    }))
  );

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
        .filter((integration) => availableDestinationIds.has(integration.id)),
    [availableDestinationIds, selectedIntegrations]
  );
  const media = global[0]?.media || [];
  const video = media.find((item) => isGuidedMp4MovMedia(item));
  const legacyCaption = stripHtmlValidation(
    'normal',
    global[0]?.content || '',
    true
  );
  const fallbackCaption =
    captionMode !== 'generate' && sourceCaption.trim()
      ? sourceCaption
      : legacyCaption;
  const unsupportedDestinationIds = useMemo(
    () => new Set(unsupportedDestinations.map((destination) => destination.id)),
    [unsupportedDestinations]
  );
  const seeds = useMemo(
    () =>
      buildGuidedReviewDraftSeeds({
        destinations,
        generatedResponse,
        generationInputFingerprint,
        unsupportedDestinationIds,
        fallbackCaption,
        originalCaption:
          captionMode === 'generate'
            ? fallbackCaption
            : sourceCaption || fallbackCaption,
      }),
    [
      captionMode,
      destinations,
      fallbackCaption,
      generatedResponse,
      generationInputFingerprint,
      sourceCaption,
      unsupportedDestinationIds,
    ]
  );

  useEffect(() => {
    reconcileReviewDrafts(seeds);
  }, [reconcileReviewDrafts, seeds]);

  const visibleDrafts = useMemo(
    () =>
      destinations
        .map((destination) => reviewDrafts[destination.id])
        .filter((draft): draft is GuidedReviewDraft => Boolean(draft)),
    [destinations, reviewDrafts]
  );
  const [activeDestinationId, setActiveDestinationId] = useState<string | null>(
    null
  );
  const [showOriginal, setShowOriginal] = useState(false);

  useEffect(() => {
    if (
      !activeDestinationId ||
      !destinations.some(
        (destination) => destination.id === activeDestinationId
      )
    ) {
      setActiveDestinationId(destinations[0]?.id || null);
    }
  }, [activeDestinationId, destinations]);

  useEffect(() => {
    setShowOriginal(false);
  }, [activeDestinationId]);

  const activeDestination = destinations.find(
    (destination) => destination.id === activeDestinationId
  );
  const activeDraft = activeDestinationId
    ? reviewDrafts[activeDestinationId]
    : undefined;
  const activeLimit = activeDraft
    ? getGuidedReviewDestinationLimit({
        providerLimit: chars[activeDraft.destinationId],
        platform: activeDraft.platform,
      })
    : null;
  const activeValidation = activeDraft
    ? getGuidedReviewDraftValidation(activeDraft, activeLimit, media.length > 0)
    : null;

  const summary = useMemo(() => {
    let selected = 0;
    let ready = 0;
    let needsAttention = 0;

    visibleDrafts.forEach((draft) => {
      if (!draft.enabled) return;
      selected += 1;
      const limit = getGuidedReviewDestinationLimit({
        providerLimit: chars[draft.destinationId],
        platform: draft.platform,
      });
      const validation = getGuidedReviewDraftValidation(
        draft,
        limit,
        media.length > 0
      );
      if (
        validation.errors.length ||
        validation.warnings.length ||
        draft.regenerationError
      ) {
        needsAttention += 1;
      } else {
        ready += 1;
      }
    });

    return { selected, ready, needsAttention };
  }, [chars, media.length, visibleDrafts]);

  const regenerateDestination = useCallback(async () => {
    if (
      !activeDestination ||
      !activeDraft ||
      !activeDraft.platform ||
      !video ||
      activeDraft.regenerationStatus === 'loading'
    ) {
      return;
    }

    const sourceFingerprint = activeDraft.sourceFingerprint;
    const regenerationRequestToken = startReviewRegeneration(
      activeDestination.id
    );
    if (regenerationRequestToken === null) return;

    try {
      const response = await requestMediaCopyGenerationForDestinations(
        fetch,
        [activeDestination],
        {
          mediaId: video.id,
          captionMode,
          ...(captionMode !== 'generate' ? { sourceCaption } : {}),
          ...(additionalContext.trim()
            ? { additionalContext: additionalContext.trim() }
            : {}),
          goal: 'position',
        }
      );
      const result = response.response?.results.find(
        (candidate) => candidate.platform === activeDraft.platform
      );

      if (!result) {
        throw new Error(
          'No regenerated caption was returned for this destination.'
        );
      }

      completeReviewRegeneration(
        activeDestination.id,
        sourceFingerprint,
        regenerationRequestToken,
        result
      );
    } catch (error: any) {
      failReviewRegeneration(
        activeDestination.id,
        sourceFingerprint,
        regenerationRequestToken,
        error?.message || 'We could not regenerate this caption.'
      );
    }
  }, [
    activeDestination,
    activeDraft,
    additionalContext,
    captionMode,
    completeReviewRegeneration,
    failReviewRegeneration,
    fetch,
    sourceCaption,
    startReviewRegeneration,
    video,
  ]);

  const generalWarnings = uniqueWarnings(generatedResponse?.warnings || []);

  return (
    <div className="mx-auto w-full max-w-[1600px] px-[40px] py-[32px] mobile:px-[12px] mobile:py-[18px]">
      <section className="rounded-[20px] border border-newBorder bg-newBgColorInner p-[22px] mobile:rounded-[16px] mobile:p-[14px]">
        <div className="grid grid-cols-3 gap-[12px] mobile:grid-cols-1">
          {[
            ['Destinations selected', summary.selected],
            ['Ready', summary.ready],
            ['Needs attention', summary.needsAttention],
          ].map(([label, value]) => (
            <div
              key={label}
              className="rounded-[14px] border border-newBorder bg-newBgColor px-[16px] py-[13px]"
            >
              <div className="text-[11px] font-[700] uppercase tracking-[0.08em] text-textColor/50">
                {label}
              </div>
              <div className="mt-[3px] text-[22px] font-[700] text-white">
                {value}
              </div>
            </div>
          ))}
        </div>

        {!!generalWarnings.length && (
          <div className="mt-[14px] rounded-[12px] border border-orange-400/45 bg-orange-400/10 px-[14px] py-[11px] text-[12px] text-orange-200">
            {generalWarnings.map((warning) => (
              <div key={`${warning.code}-${warning.message}`}>
                {warning.message}
              </div>
            ))}
          </div>
        )}

        <div className="mt-[20px] grid min-w-0 grid-cols-[minmax(240px,0.72fr)_minmax(0,1.6fr)] gap-[18px] mobile:grid-cols-1">
          <div className="min-w-0">
            <h2 className="text-[14px] font-[700] text-white">Media preview</h2>
            <div className="mt-[9px] flex aspect-video min-h-[180px] items-center justify-center overflow-hidden rounded-[16px] border border-newBorder bg-black/35 mobile:min-h-[150px]">
              {video?.path ? (
                <VideoFrame url={video.path} />
              ) : media[0]?.path ? (
                <img
                  src={media[0].thumbnail || media[0].path}
                  alt="Post media preview"
                  className="h-full w-full object-contain"
                />
              ) : (
                <div className="px-[20px] text-center text-[12px] text-textColor/50">
                  Text-only post
                </div>
              )}
            </div>

            <h2 className="mt-[20px] text-[14px] font-[700] text-white">
              Destinations
            </h2>
            <div
              role="tablist"
              aria-label="Review destinations"
              className="mt-[9px] flex max-h-[340px] flex-col gap-[8px] overflow-y-auto pe-[2px] mobile:max-h-none mobile:flex-row mobile:overflow-x-auto mobile:pb-[4px]"
            >
              {destinations.map((destination) => {
                const draft = reviewDrafts[destination.id];
                const platformName = getGuidedPlatformIdentity(
                  destination.identifier
                ).label;
                const limit = draft
                  ? getGuidedReviewDestinationLimit({
                      providerLimit: chars[destination.id],
                      platform: draft.platform,
                    })
                  : null;
                const validation = draft
                  ? getGuidedReviewDraftValidation(
                      draft,
                      limit,
                      media.length > 0
                    )
                  : null;
                const needsAttention = Boolean(
                  validation?.errors.length ||
                    validation?.warnings.length ||
                    draft?.regenerationError
                );

                return (
                  <button
                    key={destination.id}
                    type="button"
                    role="tab"
                    aria-selected={activeDestinationId === destination.id}
                    onClick={() => setActiveDestinationId(destination.id)}
                    className={clsx(
                      'flex min-w-0 items-center gap-[10px] rounded-[12px] border px-[11px] py-[10px] text-left mobile:min-w-[230px]',
                      activeDestinationId === destination.id
                        ? 'border-ai bg-newBgLineColor'
                        : 'border-newBorder bg-newBgColor',
                      draft && !draft.enabled && 'opacity-55'
                    )}
                  >
                    <ImageWithFallback
                      fallbackSrc="/no-picture.jpg"
                      src={destination.picture || '/no-picture.jpg'}
                      alt=""
                      width={38}
                      height={38}
                      className="h-[38px] w-[38px] min-w-[38px] rounded-full object-cover"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-[700] text-white">
                        {destination.name}
                      </span>
                      <span className="block truncate text-[11px] text-textColor/55">
                        {platformName}
                      </span>
                    </span>
                    <span
                      className={clsx(
                        'h-[8px] w-[8px] min-w-[8px] rounded-full',
                        !draft?.enabled
                          ? 'bg-textColor/35'
                          : needsAttention
                          ? 'bg-orange-300'
                          : 'bg-green-400'
                      )}
                      aria-label={
                        !draft?.enabled
                          ? 'Disabled'
                          : needsAttention
                          ? 'Needs attention'
                          : 'Ready'
                      }
                    />
                  </button>
                );
              })}
            </div>
          </div>

          <div className="min-w-0 rounded-[16px] border border-newBorder bg-newBgColor p-[18px] mobile:p-[14px]">
            {!activeDestination || !activeDraft || !activeValidation ? (
              <div className="flex min-h-[320px] items-center justify-center text-[13px] text-textColor/50">
                Preparing destination drafts…
              </div>
            ) : (
              <div className={clsx(!activeDraft.enabled && 'opacity-65')}>
                <div className="flex items-start justify-between gap-[14px] mobile:flex-col">
                  <div className="min-w-0">
                    <div className="text-[16px] font-[700] text-white">
                      {activeDestination.name}
                    </div>
                    <div className="mt-[2px] text-[12px] text-textColor/55">
                      {
                        getGuidedPlatformIdentity(activeDestination.identifier)
                          .label
                      }{' '}
                      · {activeDestination.display}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setReviewDestinationEnabled(
                        activeDestination.id,
                        !activeDraft.enabled
                      )
                    }
                    disabled={activeDraft.regenerationStatus === 'loading'}
                    aria-label={`${
                      activeDraft.enabled ? 'Disable' : 'Include'
                    } ${activeDestination.name}`}
                    className="rounded-[8px] border border-newBorder bg-newBgColorInner px-[12px] py-[8px] text-[12px] font-[700] text-white disabled:cursor-not-allowed disabled:opacity-45 mobile:w-full"
                  >
                    {activeDraft.enabled
                      ? 'Disable destination'
                      : 'Include destination'}
                  </button>
                </div>

                <div className="mt-[15px] flex flex-wrap items-center justify-between gap-[8px]">
                  <span className="rounded-full bg-newBgLineColor px-[10px] py-[5px] text-[11px] font-[700] text-textColor/75">
                    {getGuidedReviewCaptionSourceLabel(activeDraft.source)}
                  </span>
                  <span
                    data-testid={`review-character-count-${activeDestination.id}`}
                    className={clsx(
                      'text-[12px] font-[600]',
                      activeValidation.errors.length
                        ? 'text-red-300'
                        : 'text-textColor/55'
                    )}
                  >
                    {activeValidation.characterCount}
                    {activeLimit !== null ? ` / ${activeLimit}` : ''} characters
                  </span>
                </div>

                <label
                  htmlFor={`review-caption-${activeDestination.id}`}
                  className="mt-[12px] block text-[12px] font-[700] text-textColor/70"
                >
                  Caption
                </label>
                <textarea
                  id={`review-caption-${activeDestination.id}`}
                  aria-label={`${activeDestination.name} caption`}
                  value={activeDraft.caption}
                  disabled={
                    !activeDraft.enabled ||
                    activeDraft.regenerationStatus === 'loading'
                  }
                  onChange={(event) =>
                    editReviewCaption(activeDestination.id, event.target.value)
                  }
                  className="mt-[7px] min-h-[220px] w-full resize-y rounded-[12px] border border-newBorder bg-input p-[14px] text-[14px] leading-[1.55] text-inputText outline-none focus:border-ai disabled:cursor-not-allowed disabled:opacity-60 mobile:min-h-[180px]"
                />

                {!!activeValidation.errors.length && (
                  <div
                    role="alert"
                    className="mt-[10px] rounded-[10px] border border-red-400/45 bg-red-400/10 px-[12px] py-[9px] text-[12px] text-red-200"
                  >
                    {activeValidation.errors.map((error) => (
                      <div key={error}>{error}</div>
                    ))}
                  </div>
                )}
                {!!activeValidation.warnings.length && (
                  <div className="mt-[10px] rounded-[10px] border border-orange-400/45 bg-orange-400/10 px-[12px] py-[9px] text-[12px] text-orange-200">
                    {activeValidation.warnings.map((warning) => (
                      <div key={warning}>{warning}</div>
                    ))}
                  </div>
                )}
                {!!activeDraft.regenerationError && (
                  <div
                    role="status"
                    className="mt-[10px] rounded-[10px] border border-orange-400/45 bg-orange-400/10 px-[12px] py-[9px] text-[12px] text-orange-200"
                  >
                    {activeDraft.regenerationError}
                  </div>
                )}

                {activeDraft.baselineSource === 'adapted' && showOriginal && (
                  <div className="mt-[10px] rounded-[10px] border border-newBorder bg-newBgColorInner px-[12px] py-[10px]">
                    <div className="text-[11px] font-[700] uppercase tracking-[0.06em] text-textColor/50">
                      Your original caption
                    </div>
                    <div className="mt-[6px] whitespace-pre-wrap text-[13px] leading-[1.5] text-textColor/75">
                      {activeDraft.originalCaption}
                    </div>
                  </div>
                )}

                <div className="mt-[14px] flex flex-wrap gap-[8px]">
                  {activeDraft.baselineSource === 'adapted' && (
                    <button
                      type="button"
                      disabled={!activeDraft.enabled}
                      onClick={() => setShowOriginal((current) => !current)}
                      className="rounded-[8px] border border-newBorder bg-newBgColorInner px-[12px] py-[8px] text-[12px] font-[700] text-white disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      {showOriginal ? 'Hide original' : 'View original'}
                    </button>
                  )}
                  <button
                    type="button"
                    aria-label={`Reset ${activeDestination.name} caption`}
                    disabled={
                      !activeDraft.enabled ||
                      activeDraft.regenerationStatus === 'loading' ||
                      (activeDraft.caption === activeDraft.baselineCaption &&
                        activeDraft.source === activeDraft.baselineSource)
                    }
                    onClick={() => resetReviewCaption(activeDestination.id)}
                    className="rounded-[8px] border border-newBorder bg-newBgColorInner px-[12px] py-[8px] text-[12px] font-[700] text-white disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    Reset
                  </button>
                  <button
                    type="button"
                    aria-label={`Regenerate ${activeDestination.name} caption`}
                    disabled={
                      !activeDraft.enabled ||
                      !activeDraft.platform ||
                      !video ||
                      activeDraft.regenerationStatus === 'loading'
                    }
                    onClick={() => void regenerateDestination()}
                    className="rounded-[8px] bg-btnPrimary px-[13px] py-[8px] text-[12px] font-[700] text-white disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    {activeDraft.regenerationStatus === 'loading'
                      ? 'Regenerating…'
                      : 'Regenerate'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
};
