'use client';

import React, { FC, useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@gitroom/react/form/button';
import { Checkbox } from '@gitroom/react/form/checkbox';
import { Select } from '@gitroom/react/form/select';
import { Textarea } from '@gitroom/react/form/textarea';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useLaunchStore } from '@gitroom/frontend/components/new-launch/store';
import { useShallow } from 'zustand/react/shallow';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import { mapIntegrationIdentifierToCopyPlatform } from '@gitroom/nestjs-libraries/copy-generation/platform-rules';
import { GenerateMediaCopyResponse } from '@gitroom/nestjs-libraries/dtos/copy-generation/generate.media.copy.response';
import {
  RenderedImagePlanResult,
  RenderImagePlansResponse,
} from '@gitroom/nestjs-libraries/dtos/copy-generation/render.image.plans.response';
import {
  buildCarouselSlides,
  CAROUSEL_MAX_SLIDES,
  CAROUSEL_PLATFORMS,
  CAROUSEL_PLATFORM_LABELS,
  CAROUSEL_SLIDE_TEXT_MAX_LENGTH,
  CarouselPlatform,
  CarouselSlidePlan,
  chunkCarouselRenderPlans,
  getGeneratedCarouselPlatforms,
  isCarouselPlatform,
  isCarouselSlideTextEditable,
  limitCarouselSlideText,
  normalizeCarouselIntegrationSettings,
  reindexCarouselSlides,
  updateCarouselPlatformSelection,
} from '@gitroom/frontend/components/new-launch/carousel.post.helpers';

const parseGenerationStream = async (request: Response) => {
  if (!request.ok) {
    const payload = await request.json().catch(() => null);
    throw new Error(payload?.message || 'Carousel generation failed.');
  }
  if (!request.body) throw new Error('No response body returned.');

  const reader = request.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let finalResponse: GenerateMediaCopyResponse | null = null;

  const parseLine = (line: string) => {
    if (!line.trim()) return;
    try {
      const parsed = JSON.parse(line);
      if (parsed.name === 'completed') {
        finalResponse = parsed.data as GenerateMediaCopyResponse;
      }
    } catch {
      // Ignore incomplete stream fragments.
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    lines.forEach(parseLine);
  }

  buffer += decoder.decode();
  parseLine(buffer);
  if (!finalResponse) {
    throw new Error('Carousel generation returned no final response.');
  }
  return finalResponse;
};

export const MediaCarouselReviewModal: FC<{
  mediaId: string;
  onClose: () => void;
  postIndex: number;
}> = ({ mediaId, onClose, postIndex }) => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const {
    selectedIntegrations,
    global,
    internal,
    setGlobalValueText,
    setGlobalValueMedia,
    setInternalValue,
    addInternalValue,
    setSelectedIntegrations,
  } = useLaunchStore(
    useShallow((state) => ({
      selectedIntegrations: state.selectedIntegrations,
      global: state.global,
      internal: state.internal,
      setGlobalValueText: state.setGlobalValueText,
      setGlobalValueMedia: state.setGlobalValueMedia,
      setInternalValue: state.setInternalValue,
      addInternalValue: state.addInternalValue,
      setSelectedIntegrations: state.setSelectedIntegrations,
    }))
  );

  const hasSelectedAccounts = selectedIntegrations.length > 0;
  const availablePlatforms = useMemo<CarouselPlatform[]>(() => {
    if (!hasSelectedAccounts) return [...CAROUSEL_PLATFORMS];
    return Array.from(
      new Set(
        selectedIntegrations
          .map((item) =>
            mapIntegrationIdentifierToCopyPlatform(item.integration.identifier)
          )
          .filter(isCarouselPlatform)
      )
    );
  }, [hasSelectedAccounts, selectedIntegrations]);

  const [platforms, setPlatforms] = useState<CarouselPlatform[]>(() =>
    hasSelectedAccounts ? availablePlatforms : availablePlatforms.slice(0, 1)
  );
  const [audience, setAudience] = useState('');
  const [goal, setGoal] = useState<
    'attract' | 'nurture' | 'position' | 'convert'
  >('position');
  const [ctaStrength, setCtaStrength] = useState<
    'none' | 'soft' | 'medium' | 'direct'
  >('soft');
  const [ctaAction, setCtaAction] = useState('');
  const [transcript, setTranscript] = useState('');
  const [loading, setLoading] = useState(false);
  const [renderingIds, setRenderingIds] = useState<string[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [slides, setSlides] = useState<
    Partial<Record<CarouselPlatform, CarouselSlidePlan[]>>
  >({});
  const [rendered, setRendered] = useState<
    Record<string, RenderedImagePlanResult>
  >({});

  useEffect(() => {
    setPlatforms(
      hasSelectedAccounts ? availablePlatforms : availablePlatforms.slice(0, 1)
    );
  }, [availablePlatforms, hasSelectedAccounts]);

  const renderSlides = useCallback(
    async (plans: CarouselSlidePlan[]) => {
      if (!plans.length) return;
      const ids = plans.map((plan) => plan.id);
      setRenderingIds((current) =>
        Array.from(new Set([...current, ...ids]))
      );

      try {
        const results: RenderedImagePlanResult[] = [];
        let requestFailureCount = 0;

        for (const batch of chunkCarouselRenderPlans(plans)) {
          try {
            const request = await fetch('/image-assets/render', {
              method: 'POST',
              body: JSON.stringify({ mediaId, imagePlans: batch }),
            });
            const payload = (await request
              .json()
              .catch(() => null)) as RenderImagePlansResponse | null;
            if (!request.ok || !payload?.results) {
              throw new Error('Failed to render carousel slide batch.');
            }
            results.push(...payload.results);
          } catch {
            requestFailureCount += batch.length;
          }
        }

        if (results.length) {
          setRendered((current) => ({
            ...current,
            ...results.reduce(
              (all, item) => ({ ...all, [item.planId]: item }),
              {} as Record<string, RenderedImagePlanResult>
            ),
          }));
        }

        const failedResultCount = results.filter(
          (item) => item.status === 'failed'
        ).length;
        const failureCount = failedResultCount + requestFailureCount;
        if (failureCount) {
          toaster.show(
            `${failureCount} carousel slide${
              failureCount === 1 ? '' : 's'
            } failed to render. Regenerate the affected slides.`,
            'warning'
          );
        }
      } finally {
        setRenderingIds((current) =>
          current.filter((id) => !ids.includes(id))
        );
      }
    },
    [fetch, mediaId, toaster]
  );

  const generate = useCallback(async () => {
    if (!platforms.length) {
      toaster.show('Select at least one carousel platform.', 'warning');
      return;
    }

    const requestedPlatforms = [...platforms];
    setLoading(true);
    setSlides({});
    setRendered({});

    try {
      const request = await fetch('/posts/copy/generate', {
        method: 'POST',
        body: JSON.stringify({
          mediaId,
          platforms: requestedPlatforms,
          audience: audience || undefined,
          goal,
          ctaPreference: {
            strength: ctaStrength,
            ...(ctaAction.trim() ? { action: ctaAction.trim() } : {}),
          },
          ...(transcript.trim()
            ? {
                transcript: {
                  text: transcript.trim(),
                  source: 'manual',
                  confidence: 0.92,
                },
              }
            : {}),
        }),
      });

      const response = await parseGenerationStream(request);
      const nextDrafts = response.results.reduce(
        (all, result) => ({ ...all, [result.platform]: result.draft }),
        {} as Record<string, string>
      );
      const nextSlides = response.results.reduce(
        (all, result) => {
          if (!isCarouselPlatform(result.platform)) return all;
          const basePlan = response.imagePlans.find(
            (plan) => plan.platform === result.platform
          );
          all[result.platform] = buildCarouselSlides(result, basePlan, {
            includeCta: ctaStrength !== 'none',
          });
          return all;
        },
        {} as Partial<Record<CarouselPlatform, CarouselSlidePlan[]>>
      );
      const generatedPlatforms = getGeneratedCarouselPlatforms(nextSlides);

      if (!generatedPlatforms.length) {
        throw new Error('No carousel platforms generated successfully.');
      }

      const skippedPlatforms = requestedPlatforms.filter(
        (platform) => !generatedPlatforms.includes(platform)
      );
      setDrafts(nextDrafts);
      setSlides(nextSlides);
      setPlatforms(generatedPlatforms);

      if (skippedPlatforms.length) {
        toaster.show(
          `Skipped ${skippedPlatforms
            .map((platform) => CAROUSEL_PLATFORM_LABELS[platform])
            .join(', ')} because generation failed. The successful carousels can still be applied.`,
          'warning'
        );
      }

      await renderSlides(Object.values(nextSlides).flat());
    } catch (error: any) {
      toaster.show(
        error?.message || 'Failed to generate carousel posts.',
        'warning'
      );
    } finally {
      setLoading(false);
    }
  }, [
    audience,
    ctaAction,
    ctaStrength,
    fetch,
    goal,
    mediaId,
    platforms,
    renderSlides,
    toaster,
    transcript,
  ]);

  const updateSlides = useCallback(
    (
      platform: CarouselPlatform,
      updater: (current: CarouselSlidePlan[]) => CarouselSlidePlan[]
    ) => {
      setSlides((current) => ({
        ...current,
        [platform]: reindexCarouselSlides(
          updater(current[platform] || [])
        ),
      }));
    },
    []
  );

  const moveSlide = useCallback(
    (platform: CarouselPlatform, index: number, direction: -1 | 1) => {
      updateSlides(platform, (current) => {
        const target = index + direction;
        if (target < 0 || target >= current.length) return current;
        const next = [...current];
        [next[index], next[target]] = [next[target], next[index]];
        return next;
      });
    },
    [updateSlides]
  );

  const duplicateSlide = useCallback(
    (platform: CarouselPlatform, index: number) => {
      updateSlides(platform, (current) => {
        if (current.length >= CAROUSEL_MAX_SLIDES) return current;
        const source = current[index];
        const duplicate = { ...source, id: makeId(12) };
        const sourceAsset = rendered[source.id];
        if (sourceAsset) {
          setRendered((all) => ({
            ...all,
            [duplicate.id]: { ...sourceAsset, planId: duplicate.id },
          }));
        }
        const next = [...current];
        next.splice(index + 1, 0, duplicate);
        return next;
      });
    },
    [rendered, updateSlides]
  );

  const apply = useCallback(() => {
    if (renderingIds.length) {
      toaster.show('Wait for carousel rendering to finish.', 'warning');
      return;
    }

    const activePlatforms = getGeneratedCarouselPlatforms(slides).filter(
      (platform) => platforms.includes(platform)
    );
    if (!activePlatforms.length) {
      toaster.show('No completed carousel platforms are available.', 'warning');
      return;
    }
    if (!hasSelectedAccounts && activePlatforms.length !== 1) {
      toaster.show(
        'Choose one platform version when applying to the global post.',
        'warning'
      );
      return;
    }

    for (const platform of activePlatforms) {
      const platformSlides = slides[platform] || [];
      if (platformSlides.length < 2) {
        toaster.show(
          `${CAROUSEL_PLATFORM_LABELS[platform]} needs at least two slides.`,
          'warning'
        );
        return;
      }
      if (
        platformSlides.some(
          (slide) =>
            rendered[slide.id]?.status !== 'completed' ||
            !rendered[slide.id]?.media
        )
      ) {
        toaster.show(
          `Finish rendering every ${CAROUSEL_PLATFORM_LABELS[platform]} slide before applying.`,
          'warning'
        );
        return;
      }
    }

    if (hasSelectedAccounts && activePlatforms.includes('instagram')) {
      setSelectedIntegrations(
        selectedIntegrations.map((item) => {
          const platform = mapIntegrationIdentifierToCopyPlatform(
            item.integration.identifier
          );
          return {
            selectedIntegrations: item.integration,
            settings: normalizeCarouselIntegrationSettings(
              platform,
              item.settings
            ),
          };
        })
      );
    }

    let applied = 0;
    for (const platform of activePlatforms) {
      const media = (slides[platform] || []).map((slide) => ({
        ...rendered[slide.id].media!,
      }));
      const content = drafts[platform] || '';
      const matches = selectedIntegrations.filter(
        (item) =>
          mapIntegrationIdentifierToCopyPlatform(
            item.integration.identifier
          ) === platform
      );

      for (const match of matches) {
        const existingInternal = internal.find(
          (item) => item.integration.id === match.integration.id
        );
        const existingValues = existingInternal?.integrationValue || global;
        const rowCount = Math.max(
          existingValues.length,
          global.length,
          postIndex + 1
        );
        const nextValues = Array.from({ length: rowCount }, (_, index) => {
          const sourceValue = existingValues[index] ||
            global[index] || {
              id: makeId(10),
              content: '',
              delay: 0,
              media: [],
            };
          return index === postIndex
            ? { ...sourceValue, content, media }
            : sourceValue;
        });

        if (existingInternal) {
          setInternalValue(match.integration.id, nextValues);
        } else {
          addInternalValue(postIndex, match.integration.id, nextValues);
        }
        applied += 1;
      }
    }

    if (!hasSelectedAccounts) {
      const platform = activePlatforms[0];
      setGlobalValueText(postIndex, drafts[platform] || '');
      setGlobalValueMedia(
        postIndex,
        (slides[platform] || []).map((slide) => ({
          ...rendered[slide.id].media!,
        }))
      );
    } else if (!applied) {
      toaster.show(
        'No selected account matches the generated carousel platforms.',
        'warning'
      );
      return;
    }

    toaster.show(
      applied
        ? `Carousel posts applied to ${applied} selected account${
            applied === 1 ? '' : 's'
          }.`
        : 'Carousel applied to the current post.',
      'success'
    );
    onClose();
  }, [
    addInternalValue,
    drafts,
    global,
    hasSelectedAccounts,
    internal,
    onClose,
    platforms,
    postIndex,
    rendered,
    renderingIds,
    selectedIntegrations,
    setGlobalValueMedia,
    setGlobalValueText,
    setInternalValue,
    setSelectedIntegrations,
    slides,
    toaster,
  ]);

  const hasSlides = Object.values(slides).some((items) => items?.length);

  return (
    <div className="flex min-w-[820px] max-w-[1040px] flex-col gap-[16px] text-textColor">
      {!hasSlides ? (
        <>
          <div className="text-[14px] text-gray-400">
            Generate an ordered, editable image carousel from the uploaded
            video. Only platforms with multi-image publishing are shown.
          </div>
          {!hasSelectedAccounts && (
            <div className="rounded-[8px] bg-newBgColorInner px-[12px] py-[9px] text-[12px] text-gray-400">
              No accounts are selected. Choose one platform version to apply to
              the global post.
            </div>
          )}

          <div className="grid grid-cols-3 gap-[8px]">
            {CAROUSEL_PLATFORMS.map((platform) => {
              const available = availablePlatforms.includes(platform);
              return (
                <label
                  key={platform}
                  className="rounded-[8px] bg-newBgColorInner px-[12px] py-[8px]"
                >
                  <Checkbox
                    disableForm
                    checked={platforms.includes(platform)}
                    disabled={!available}
                    onChange={() =>
                      setPlatforms((current) =>
                        updateCarouselPlatformSelection(
                          current,
                          platform,
                          hasSelectedAccounts
                        )
                      )
                    }
                    label={CAROUSEL_PLATFORM_LABELS[platform]}
                  />
                </label>
              );
            })}
          </div>

          <Textarea
            disableForm
            name="carouselAudience"
            label={t('audience_optional', 'Audience (optional)')}
            value={audience}
            onChange={(event) => setAudience(event.target.value)}
          />

          <div className="grid grid-cols-2 gap-[12px]">
            <Select
              disableForm
              name="carouselGoal"
              label={t('goal', 'Goal')}
              value={goal}
              onChange={(event) =>
                setGoal(event.target.value as typeof goal)
              }
            >
              <option value="attract">Attract</option>
              <option value="nurture">Nurture</option>
              <option value="position">Position</option>
              <option value="convert">Convert</option>
            </Select>
            <Select
              disableForm
              name="carouselCtaStrength"
              label={t('cta_strength', 'CTA strength')}
              value={ctaStrength}
              onChange={(event) =>
                setCtaStrength(event.target.value as typeof ctaStrength)
              }
            >
              <option value="none">None</option>
              <option value="soft">Soft</option>
              <option value="medium">Medium</option>
              <option value="direct">Direct</option>
            </Select>
          </div>

          <Textarea
            disableForm
            name="carouselCtaAction"
            label={t('cta_action_optional', 'CTA action (optional)')}
            value={ctaAction}
            onChange={(event) => setCtaAction(event.target.value)}
          />
          <Textarea
            disableForm
            name="carouselTranscript"
            label={t('transcript_optional', 'Transcript (optional)')}
            placeholder={t(
              'transcript_automatic_placeholder',
              'Leave blank to use automatic transcription.'
            )}
            value={transcript}
            onChange={(event) => setTranscript(event.target.value)}
          />

          <div className="flex justify-end gap-[8px]">
            <Button secondary onClick={onClose}>
              {t('cancel', 'Cancel')}
            </Button>
            <Button
              loading={loading}
              disabled={!platforms.length}
              onClick={generate}
            >
              Generate carousel
            </Button>
          </div>
        </>
      ) : (
        <>
          <div className="max-h-[70vh] overflow-y-auto pe-[6px]">
            <div className="flex flex-col gap-[18px]">
              {platforms.map((platform) => (
                <section
                  key={platform}
                  className="rounded-[12px] bg-newBgColorInner p-[14px]"
                >
                  <div className="mb-[12px]">
                    <div className="font-[600]">
                      {CAROUSEL_PLATFORM_LABELS[platform]}
                    </div>
                    <div className="text-[12px] text-gray-400">
                      {(slides[platform] || []).length} slides · maximum{' '}
                      {CAROUSEL_MAX_SLIDES}
                    </div>
                  </div>

                  <textarea
                    className="mb-[14px] min-h-[110px] w-full rounded-[8px] border border-fifth bg-input p-[12px] text-inputText outline-none"
                    value={drafts[platform] || ''}
                    onChange={(event) =>
                      setDrafts((current) => ({
                        ...current,
                        [platform]: event.target.value,
                      }))
                    }
                  />

                  <div className="flex gap-[12px] overflow-x-auto pb-[6px]">
                    {(slides[platform] || []).map((slide, index) => {
                      const asset = rendered[slide.id];
                      const isRendering = renderingIds.includes(slide.id);
                      const isTextEditable = isCarouselSlideTextEditable(slide);
                      const slideText = slide.headline || slide.visualSummary;
                      return (
                        <div
                          key={slide.id}
                          className="w-[230px] shrink-0 rounded-[10px] bg-newSettings p-[10px]"
                        >
                          <div className="mb-[8px] text-[12px] text-gray-400">
                            Slide {index + 1} · {slide.role}
                          </div>
                          <div className="mb-[8px] flex h-[210px] items-center justify-center overflow-hidden rounded-[8px] bg-newBgColorInner">
                            {asset?.status === 'completed' &&
                            asset.media?.path ? (
                              <img
                                src={asset.media.path}
                                alt={slide.altText}
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              <div className="px-[12px] text-center text-[12px] text-gray-400">
                                {isRendering
                                  ? 'Rendering…'
                                  : asset?.error?.message || 'Not rendered'}
                              </div>
                            )}
                          </div>

                          {isTextEditable ? (
                            <>
                              <textarea
                                className="min-h-[84px] w-full rounded-[7px] border border-fifth bg-input p-[8px] text-[12px] text-inputText outline-none"
                                value={slideText}
                                maxLength={CAROUSEL_SLIDE_TEXT_MAX_LENGTH}
                                disabled={isRendering}
                                onChange={(event) => {
                                  const nextText = limitCarouselSlideText(
                                    event.target.value
                                  );
                                  if (nextText === slideText) return;

                                  setRendered((current) => {
                                    if (!current[slide.id]) return current;
                                    const next = { ...current };
                                    delete next[slide.id];
                                    return next;
                                  });
                                  updateSlides(platform, (current) =>
                                    current.map((item, itemIndex) =>
                                      itemIndex === index
                                        ? {
                                            ...item,
                                            headline: nextText,
                                            visualSummary: nextText,
                                            altText: nextText,
                                          }
                                        : item
                                    )
                                  );
                                }}
                              />
                              <div className="mb-[8px] text-right text-[11px] text-gray-400">
                                {slideText.length}/
                                {CAROUSEL_SLIDE_TEXT_MAX_LENGTH}
                              </div>
                            </>
                          ) : (
                            <div className="mb-[8px] min-h-[84px] rounded-[7px] border border-fifth bg-input p-[8px] text-[12px] text-gray-400">
                              This visual type does not render slide text. Use
                              Regenerate to refresh the image without changing
                              its caption.
                            </div>
                          )}

                          <div className="grid grid-cols-2 gap-[6px]">
                            <Button
                              secondary
                              disabled={index === 0}
                              onClick={() => moveSlide(platform, index, -1)}
                            >
                              Left
                            </Button>
                            <Button
                              secondary
                              disabled={
                                index === (slides[platform] || []).length - 1
                              }
                              onClick={() => moveSlide(platform, index, 1)}
                            >
                              Right
                            </Button>
                            <Button
                              secondary
                              disabled={
                                (slides[platform] || []).length >=
                                CAROUSEL_MAX_SLIDES
                              }
                              onClick={() => duplicateSlide(platform, index)}
                            >
                              Duplicate
                            </Button>
                            <Button
                              secondary
                              loading={isRendering}
                              onClick={() => renderSlides([slide])}
                            >
                              Regenerate
                            </Button>
                            <Button
                              secondary
                              disabled={(slides[platform] || []).length <= 2}
                              onClick={() =>
                                updateSlides(platform, (current) =>
                                  current.filter(
                                    (_, itemIndex) => itemIndex !== index
                                  )
                                )
                              }
                            >
                              Remove
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          </div>

          <div className="flex justify-between gap-[8px] border-t border-fifth pt-[12px]">
            <Button
              secondary
              onClick={() => {
                setSlides({});
                setRendered({});
                setPlatforms(
                  hasSelectedAccounts
                    ? availablePlatforms
                    : availablePlatforms.slice(0, 1)
                );
              }}
            >
              Start over
            </Button>
            <div className="flex gap-[8px]">
              <Button secondary onClick={onClose}>
                {t('close', 'Close')}
              </Button>
              <Button
                disabled={Boolean(renderingIds.length)}
                onClick={apply}
              >
                Apply carousels
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
