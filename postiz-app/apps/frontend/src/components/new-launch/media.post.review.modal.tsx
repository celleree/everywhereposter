'use client';

import React, { FC, useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@gitroom/react/form/button';
import { Textarea } from '@gitroom/react/form/textarea';
import { Select } from '@gitroom/react/form/select';
import { Checkbox } from '@gitroom/react/form/checkbox';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useLaunchStore } from '@gitroom/frontend/components/new-launch/store';
import { useShallow } from 'zustand/react/shallow';
import { Integrations } from '@gitroom/frontend/components/launches/calendar.context';
import {
  CopyPlatform,
  COPY_PLATFORMS,
  mapIntegrationIdentifierToCopyPlatform,
} from '@gitroom/nestjs-libraries/copy-generation/platform-rules';
import {
  GenerateMediaCopyResponse,
  ImagePlanItem,
} from '@gitroom/nestjs-libraries/dtos/copy-generation/generate.media.copy.response';
import {
  RenderedImagePlanResult,
  RenderImagePlansResponse,
} from '@gitroom/nestjs-libraries/dtos/copy-generation/render.image.plans.response';

const stageLabelMap: Record<string, string> = {
  'copy-generation-started': 'Preparing your post set...',
  'source-brief-complete': 'Understanding the video...',
  'platform-started': 'Generating a platform draft...',
  'platform-rewrite-started': 'Refining the platform draft...',
  'platform-complete': 'Finishing the platform draft...',
  completed: 'Done',
};

const platformLabels: Record<CopyPlatform, string> = {
  linkedin: 'LinkedIn',
  x: 'X',
  threads: 'Threads',
  facebook: 'Facebook',
  instagram: 'Instagram',
  tiktok: 'TikTok',
  youtube: 'YouTube',
  bluesky: 'Bluesky',
};

const imageTypeLabels: Record<ImagePlanItem['type'], string> = {
  video_frame: 'Video frame',
  quote_card: 'Quote card',
  ai_visual: 'AI visual',
  thumbnail: 'Thumbnail',
};

type ReviewTab = 'overview' | 'posts' | 'images' | 'accounts';

const loadDefaultPlatforms = (integrations: Integrations[]) =>
  Array.from(
    new Set(
      integrations
        .map((integration) =>
          mapIntegrationIdentifierToCopyPlatform(integration.identifier)
        )
        .filter((platform): platform is CopyPlatform => Boolean(platform))
    )
  );

const parseGenerationStream = async (
  request: Response,
  onStage: (name: string, data?: any) => void
) => {
  if (!request.body) {
    throw new Error('No response body returned');
  }

  const reader = request.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let finalResponse: GenerateMediaCopyResponse | null = null;

  const parseLine = (line: string) => {
    if (!line.trim()) return;
    try {
      const parsed = JSON.parse(line);
      onStage(parsed.name, parsed.data);
      if (parsed.name === 'completed') {
        finalResponse = parsed.data as GenerateMediaCopyResponse;
      }
    } catch {
      // Ignore malformed partial stream messages.
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
    throw new Error('Post generation did not return a final payload');
  }

  return finalResponse;
};

export const MediaPostReviewModal: FC<{
  mediaId: string;
  mediaType: 'image' | 'video';
  onClose: () => void;
  postIndex: number;
}> = ({ mediaId, mediaType, onClose, postIndex }) => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const {
    selectedIntegrations,
    setGlobalValueText,
    setGlobalValueMedia,
    upsertInternalValueText,
    setInternalValueMedia,
  } = useLaunchStore(
    useShallow((state) => ({
      selectedIntegrations: state.selectedIntegrations,
      setGlobalValueText: state.setGlobalValueText,
      setGlobalValueMedia: state.setGlobalValueMedia,
      upsertInternalValueText: state.upsertInternalValueText,
      setInternalValueMedia: state.setInternalValueMedia,
    }))
  );

  const selectedPlatforms = useMemo(
    () => loadDefaultPlatforms(selectedIntegrations.map((item) => item.integration)),
    [selectedIntegrations]
  );
  const [platforms, setPlatforms] = useState<CopyPlatform[]>(selectedPlatforms);
  const [activeAccountIds, setActiveAccountIds] = useState<string[]>(
    selectedIntegrations.map((item) => item.integration.id)
  );
  const [audience, setAudience] = useState('');
  const [goal, setGoal] = useState<'attract' | 'nurture' | 'position' | 'convert'>(
    'position'
  );
  const [ctaStrength, setCtaStrength] = useState<
    'none' | 'soft' | 'medium' | 'direct'
  >('soft');
  const [ctaAction, setCtaAction] = useState('');
  const [transcript, setTranscript] = useState('');
  const [knowledgeFacts, setKnowledgeFacts] = useState('');
  const [loading, setLoading] = useState(false);
  const [renderingPlanIds, setRenderingPlanIds] = useState<string[]>([]);
  const [statusText, setStatusText] = useState('');
  const [response, setResponse] = useState<GenerateMediaCopyResponse | null>(null);
  const [editedDrafts, setEditedDrafts] = useState<Record<string, string>>({});
  const [renderedAssets, setRenderedAssets] = useState<
    Record<string, RenderedImagePlanResult>
  >({});
  const [enabledPlanIds, setEnabledPlanIds] = useState<string[]>([]);
  const [tab, setTab] = useState<ReviewTab>('overview');

  useEffect(() => {
    setPlatforms(selectedPlatforms);
  }, [selectedPlatforms]);

  useEffect(() => {
    setActiveAccountIds(selectedIntegrations.map((item) => item.integration.id));
  }, [selectedIntegrations]);

  const togglePlatform = useCallback((platform: CopyPlatform) => {
    setPlatforms((current) =>
      current.includes(platform)
        ? current.filter((item) => item !== platform)
        : [...current, platform]
    );
  }, []);

  const renderPlans = useCallback(
    async (plans: ImagePlanItem[]) => {
      if (!plans.length) return;
      const planIds = plans.map((plan) => plan.id);
      setRenderingPlanIds((current) => Array.from(new Set([...current, ...planIds])));

      try {
        const request = await fetch('/image-assets/render', {
          method: 'POST',
          body: JSON.stringify({ mediaId, imagePlans: plans }),
        });
        const result = (await request.json()) as RenderImagePlansResponse;
        setRenderedAssets((current) => ({
          ...current,
          ...result.results.reduce(
            (all, item) => ({ ...all, [item.planId]: item }),
            {} as Record<string, RenderedImagePlanResult>
          ),
        }));
        setEnabledPlanIds((current) =>
          Array.from(
            new Set([
              ...current,
              ...result.results
                .filter((item) => item.status === 'completed' && item.media)
                .map((item) => item.planId),
            ])
          )
        );

        const failures = result.results.filter((item) => item.status === 'failed');
        if (failures.length) {
          toaster.show(
            `${failures.length} image asset${failures.length === 1 ? '' : 's'} could not be created. You can retry individually.`,
            'warning'
          );
        }
      } catch (error: any) {
        toaster.show(error?.message || 'Failed to create image assets.', 'warning');
      } finally {
        setRenderingPlanIds((current) =>
          current.filter((planId) => !planIds.includes(planId))
        );
      }
    },
    [fetch, mediaId, toaster]
  );

  const generate = useCallback(async () => {
    if (!platforms.length) {
      toaster.show('Select at least one platform.', 'warning');
      return;
    }

    setLoading(true);
    setResponse(null);
    setRenderedAssets({});
    setEnabledPlanIds([]);
    setStatusText(t('generating_post_set', 'Generating post set...'));

    try {
      const facts = knowledgeFacts
        .split('\n')
        .map((fact) => fact.trim())
        .filter(Boolean);
      const request = await fetch('/posts/copy/generate', {
        method: 'POST',
        body: JSON.stringify({
          mediaId,
          platforms,
          audience: audience || undefined,
          goal,
          ctaPreference: {
            strength: ctaStrength,
            ...(ctaAction ? { action: ctaAction } : {}),
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
          ...(facts.length
            ? { knowledgeBaseFacts: facts.map((text) => ({ text })) }
            : {}),
        }),
      });

      const finalResponse = await parseGenerationStream(request, (name, data) => {
        if (name === 'platform-started' && data?.platform) {
          setStatusText(`Generating ${platformLabels[data.platform as CopyPlatform]}...`);
          return;
        }
        if (name === 'platform-rewrite-started' && data?.platform) {
          setStatusText(`Refining ${platformLabels[data.platform as CopyPlatform]}...`);
          return;
        }
        setStatusText(
          stageLabelMap[name] || t('processing_post_set', 'Processing post set...')
        );
      });

      setResponse(finalResponse);
      setEditedDrafts(
        finalResponse.results.reduce(
          (all, result) => ({ ...all, [result.platform]: result.draft }),
          {} as Record<string, string>
        )
      );
      setStatusText('');
      setTab('overview');
      await renderPlans(finalResponse.imagePlans || []);
    } catch (error: any) {
      toaster.show(error?.message || 'Failed to generate the post set.', 'warning');
      setStatusText('');
    } finally {
      setLoading(false);
    }
  }, [
    audience,
    ctaAction,
    ctaStrength,
    fetch,
    goal,
    knowledgeFacts,
    mediaId,
    platforms,
    renderPlans,
    t,
    toaster,
    transcript,
  ]);

  const applyPostSet = useCallback(() => {
    if (!response?.results.length) return;

    let appliedCount = 0;
    for (const result of response.results) {
      const draft = editedDrafts[result.platform] ?? result.draft;
      const plan = response.imagePlans.find((item) => item.platform === result.platform);
      const rendered = plan ? renderedAssets[plan.id] : undefined;
      const replacementMedia =
        plan &&
        enabledPlanIds.includes(plan.id) &&
        rendered?.status === 'completed' &&
        rendered.media
          ? [{ id: rendered.media.id, path: rendered.media.path }]
          : undefined;
      const matches = selectedIntegrations.filter(
        (item) =>
          activeAccountIds.includes(item.integration.id) &&
          mapIntegrationIdentifierToCopyPlatform(item.integration.identifier) ===
            result.platform
      );

      for (const match of matches) {
        upsertInternalValueText(match.integration.id, postIndex, draft);
        if (replacementMedia) {
          setInternalValueMedia(match.integration.id, postIndex, replacementMedia);
        }
        appliedCount += 1;
      }
    }

    if (!appliedCount) {
      const firstResult = response.results[0];
      const firstPlan = response.imagePlans.find(
        (item) => item.platform === firstResult.platform
      );
      const firstRendered = firstPlan ? renderedAssets[firstPlan.id] : undefined;
      const replacementMedia =
        firstPlan &&
        enabledPlanIds.includes(firstPlan.id) &&
        firstRendered?.status === 'completed' &&
        firstRendered.media
          ? [{ id: firstRendered.media.id, path: firstRendered.media.path }]
          : undefined;
      setGlobalValueText(
        postIndex,
        editedDrafts[firstResult.platform] ?? firstResult.draft
      );
      if (replacementMedia) {
        setGlobalValueMedia(postIndex, replacementMedia);
      }
    }

    toaster.show(
      appliedCount
        ? `Post set applied to ${appliedCount} selected account${appliedCount === 1 ? '' : 's'}.`
        : 'Post set applied to the current post.',
      'success'
    );
    onClose();
  }, [
    activeAccountIds,
    editedDrafts,
    enabledPlanIds,
    onClose,
    postIndex,
    renderedAssets,
    response,
    selectedIntegrations,
    setGlobalValueMedia,
    setGlobalValueText,
    setInternalValueMedia,
    toaster,
    upsertInternalValueText,
  ]);

  const platformPlan = useCallback(
    (platform: CopyPlatform) =>
      response?.imagePlans.find((plan) => plan.platform === platform),
    [response]
  );

  const tabs: Array<{ id: ReviewTab; label: string }> = [
    { id: 'overview', label: 'Overview' },
    { id: 'posts', label: 'Text' },
    { id: 'images', label: 'Images' },
    { id: 'accounts', label: 'Accounts' },
  ];

  return (
    <div className="flex min-w-[760px] max-w-[900px] flex-col gap-[16px] text-textColor">
      {!response ? (
        <>
          <div className="text-[14px] text-gray-400">
            {mediaType === 'video'
              ? 'Create platform-specific text and image assets from this video.'
              : 'Create grounded platform copy from the attached media.'}
          </div>

          <div className="flex flex-col gap-[8px]">
            <div className="text-[13px] font-[600]">Platforms</div>
            <div className="grid grid-cols-3 gap-[8px]">
              {COPY_PLATFORMS.map((platform) => (
                <label
                  key={platform}
                  className="flex items-center gap-[8px] rounded-[8px] bg-newBgColorInner px-[12px] py-[8px]"
                >
                  <Checkbox
                    disableForm
                    checked={platforms.includes(platform)}
                    onChange={() => togglePlatform(platform)}
                    label={platformLabels[platform]}
                  />
                </label>
              ))}
            </div>
          </div>

          <Textarea
            disableForm
            name="audience"
            label="Audience (optional)"
            placeholder="Who should this post resonate with?"
            value={audience}
            onChange={(event) => setAudience(event.target.value)}
          />

          <div className="grid grid-cols-2 gap-[12px]">
            <Select
              disableForm
              name="goal"
              label="Goal"
              value={goal}
              onChange={(event) =>
                setGoal(
                  event.target.value as 'attract' | 'nurture' | 'position' | 'convert'
                )
              }
            >
              <option value="attract">Attract</option>
              <option value="nurture">Nurture</option>
              <option value="position">Position</option>
              <option value="convert">Convert</option>
            </Select>
            <Select
              disableForm
              name="ctaStrength"
              label="CTA strength"
              value={ctaStrength}
              onChange={(event) =>
                setCtaStrength(
                  event.target.value as 'none' | 'soft' | 'medium' | 'direct'
                )
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
            name="ctaAction"
            label="CTA action (optional)"
            placeholder="Example: visit the site, reply, or book a demo"
            value={ctaAction}
            onChange={(event) => setCtaAction(event.target.value)}
          />

          {mediaType === 'video' && (
            <Textarea
              disableForm
              name="transcript"
              label="Transcript (optional)"
              placeholder="Leave blank to use automatic transcription."
              value={transcript}
              onChange={(event) => setTranscript(event.target.value)}
            />
          )}

          <Textarea
            disableForm
            name="knowledgeFacts"
            label="Knowledge base facts (optional)"
            placeholder="Add one verified fact per line."
            value={knowledgeFacts}
            onChange={(event) => setKnowledgeFacts(event.target.value)}
          />

          {statusText ? <div className="text-[13px] text-gray-400">{statusText}</div> : null}
          <div className="flex justify-end gap-[8px]">
            <Button secondary onClick={onClose}>Cancel</Button>
            <Button loading={loading} disabled={!platforms.length} onClick={generate}>
              Generate post set
            </Button>
          </div>
        </>
      ) : (
        <>
          <div className="flex gap-[6px] border-b border-fifth pb-[10px]">
            {tabs.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`rounded-[7px] px-[12px] py-[7px] text-[13px] ${
                  tab === item.id ? 'bg-newBgColorInner font-[600]' : 'text-gray-400'
                }`}
                onClick={() => setTab(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>

          {response.warnings.length > 0 && (
            <div className="flex flex-col gap-[4px] rounded-[8px] border border-[#5A2F2F] bg-[#2A2020] px-[12px] py-[10px] text-[13px]">
              {response.warnings.map((warning) => (
                <div key={`${warning.code}-${warning.message}`}>{warning.message}</div>
              ))}
            </div>
          )}

          <div className="max-h-[66vh] overflow-y-auto pe-[6px]">
            {tab === 'overview' && (
              <div className="flex flex-col gap-[10px]">
                {response.results.map((result) => {
                  const plan = platformPlan(result.platform);
                  const rendered = plan ? renderedAssets[plan.id] : undefined;
                  const accounts = selectedIntegrations.filter(
                    (item) =>
                      activeAccountIds.includes(item.integration.id) &&
                      mapIntegrationIdentifierToCopyPlatform(item.integration.identifier) ===
                        result.platform
                  );
                  return (
                    <div key={result.platform} className="rounded-[12px] bg-newBgColorInner p-[14px]">
                      <div className="flex items-center justify-between gap-[12px]">
                        <div>
                          <div className="font-[600]">{platformLabels[result.platform]}</div>
                          <div className="text-[12px] text-gray-400">
                            {accounts.length} selected account{accounts.length === 1 ? '' : 's'}
                          </div>
                        </div>
                        <div className="text-[12px] text-gray-400">
                          {plan
                            ? rendered?.status === 'completed'
                              ? `${imageTypeLabels[plan.type]} ready`
                              : renderingPlanIds.includes(plan.id)
                                ? 'Creating image...'
                                : 'Image needs attention'
                            : 'Text only'}
                        </div>
                      </div>
                      <div className="mt-[8px] line-clamp-3 whitespace-pre-wrap text-[13px]">
                        {editedDrafts[result.platform] ?? result.draft}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {tab === 'posts' && (
              <div className="flex flex-col gap-[12px]">
                {response.results.map((result) => (
                  <div key={result.platform} className="flex flex-col gap-[8px] rounded-[12px] bg-newBgColorInner p-[14px]">
                    <div className="flex items-center justify-between">
                      <div className="font-[600]">{platformLabels[result.platform]}</div>
                      <div className="text-[12px] text-gray-400">{result.charCount} chars</div>
                    </div>
                    <textarea
                      className="min-h-[160px] rounded-[8px] border border-fifth bg-input p-[14px] text-inputText outline-none"
                      value={editedDrafts[result.platform] ?? result.draft}
                      onChange={(event) =>
                        setEditedDrafts((current) => ({
                          ...current,
                          [result.platform]: event.target.value,
                        }))
                      }
                    />
                    {result.warnings.length > 0 && (
                      <div className="flex flex-col gap-[4px] text-[12px] text-orange-300">
                        {result.warnings.map((warning) => (
                          <div key={`${result.platform}-${warning.code}-${warning.message}`}>
                            {warning.message}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {tab === 'images' && (
              <div className="flex flex-col gap-[12px]">
                {!response.imagePlans.length && (
                  <div className="rounded-[12px] bg-newBgColorInner p-[18px] text-[13px] text-gray-400">
                    No image asset was recommended for this post set.
                  </div>
                )}
                {response.imagePlans.map((plan) => {
                  const rendered = renderedAssets[plan.id];
                  const enabled = enabledPlanIds.includes(plan.id);
                  const isRendering = renderingPlanIds.includes(plan.id);
                  return (
                    <div key={plan.id} className="grid grid-cols-[220px_1fr] gap-[14px] rounded-[12px] bg-newBgColorInner p-[14px]">
                      <div className="flex min-h-[160px] items-center justify-center overflow-hidden rounded-[10px] bg-newSettings">
                        {rendered?.status === 'completed' && rendered.media?.path ? (
                          <img src={rendered.media.path} alt={plan.altText} className="h-full w-full object-cover" />
                        ) : (
                          <div className="px-[16px] text-center text-[12px] text-gray-400">
                            {isRendering
                              ? 'Creating image...'
                              : rendered?.error?.message || 'Image not available'}
                          </div>
                        )}
                      </div>
                      <div className="flex flex-col gap-[8px]">
                        <div className="flex items-start justify-between gap-[12px]">
                          <div>
                            <div className="font-[600]">{platformLabels[plan.platform]}</div>
                            <div className="text-[12px] text-gray-400">
                              {imageTypeLabels[plan.type]} · {plan.aspectRatio}
                            </div>
                          </div>
                          <Checkbox
                            disableForm
                            checked={enabled}
                            disabled={rendered?.status !== 'completed'}
                            onChange={() =>
                              setEnabledPlanIds((current) =>
                                current.includes(plan.id)
                                  ? current.filter((id) => id !== plan.id)
                                  : [...current, plan.id]
                              )
                            }
                            label="Use image"
                          />
                        </div>
                        <div className="text-[13px]">{plan.headline || plan.visualSummary}</div>
                        <div className="text-[12px] text-gray-400">{plan.rationale}</div>
                        {plan.warnings.map((warning) => (
                          <div key={warning} className="text-[12px] text-orange-300">{warning}</div>
                        ))}
                        <div className="mt-auto flex gap-[8px]">
                          <Button secondary loading={isRendering} onClick={() => renderPlans([plan])}>
                            {rendered?.status === 'completed' ? 'Regenerate' : 'Retry'}
                          </Button>
                          <Button
                            secondary
                            disabled={!enabled}
                            onClick={() =>
                              setEnabledPlanIds((current) =>
                                current.filter((id) => id !== plan.id)
                              )
                            }
                          >
                            Remove
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {tab === 'accounts' && (
              <div className="flex flex-col gap-[10px]">
                {selectedIntegrations.map((item) => {
                  const platform = mapIntegrationIdentifierToCopyPlatform(
                    item.integration.identifier
                  );
                  return (
                    <label key={item.integration.id} className="flex items-center justify-between rounded-[10px] bg-newBgColorInner px-[14px] py-[12px]">
                      <div className="flex items-center gap-[10px]">
                        {item.integration.picture ? (
                          <img src={item.integration.picture} alt="" className="h-[34px] w-[34px] rounded-full object-cover" />
                        ) : null}
                        <div>
                          <div className="text-[13px] font-[600]">{item.integration.name}</div>
                          <div className="text-[12px] text-gray-400">
                            {platform ? platformLabels[platform] : item.integration.display}
                          </div>
                        </div>
                      </div>
                      <Checkbox
                        disableForm
                        checked={activeAccountIds.includes(item.integration.id)}
                        onChange={() =>
                          setActiveAccountIds((current) =>
                            current.includes(item.integration.id)
                              ? current.filter((id) => id !== item.integration.id)
                              : [...current, item.integration.id]
                          )
                        }
                        label="Include"
                      />
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          <div className="flex justify-between gap-[8px] border-t border-fifth pt-[12px]">
            <Button secondary onClick={() => setResponse(null)}>Start over</Button>
            <div className="flex gap-[8px]">
              <Button secondary onClick={onClose}>Close</Button>
              <Button disabled={!activeAccountIds.length && Boolean(selectedIntegrations.length)} onClick={applyPostSet}>
                Apply post set
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};