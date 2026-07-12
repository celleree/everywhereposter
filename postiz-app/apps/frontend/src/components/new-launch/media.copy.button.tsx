'use client';

import React, { FC, useCallback, useEffect, useMemo, useState } from 'react';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
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
import { GenerateMediaCopyResponse } from '@gitroom/nestjs-libraries/dtos/copy-generation/generate.media.copy.response';

const stageLabelMap: Record<string, string> = {
  'copy-generation-started': 'Preparing media copy generation...',
  'source-brief-complete': 'Extracting grounded details from your media...',
  'platform-started': 'Generating a platform draft...',
  'platform-rewrite-started': 'Cleaning up generic phrasing...',
  'platform-complete': 'Finishing platform draft...',
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

const loadDefaultPlatforms = (integrations: Integrations[]) => {
  const defaults = integrations
    .map((integration) => mapIntegrationIdentifierToCopyPlatform(integration.identifier))
    .filter((platform): platform is CopyPlatform => !!platform);

  return Array.from(new Set(defaults));
};

const MediaCopyModal: FC<{
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
    upsertInternalValueText,
  } = useLaunchStore(
    useShallow((state) => ({
      selectedIntegrations: state.selectedIntegrations,
      setGlobalValueText: state.setGlobalValueText,
      upsertInternalValueText: state.upsertInternalValueText,
    }))
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
  const [statusText, setStatusText] = useState('');
  const [response, setResponse] = useState<GenerateMediaCopyResponse | null>(null);
  const selectedPlatforms = useMemo(
    () => loadDefaultPlatforms(selectedIntegrations.map((item) => item.integration)),
    [selectedIntegrations]
  );
  const [platforms, setPlatforms] = useState<CopyPlatform[]>(selectedPlatforms);
  const [editedDrafts, setEditedDrafts] = useState<Record<CopyPlatform, string>>(
    {} as Record<CopyPlatform, string>
  );

  useEffect(() => {
    setPlatforms(selectedPlatforms);
  }, [selectedPlatforms]);

  const togglePlatform = useCallback(
    (platform: CopyPlatform) => {
      setPlatforms((current) => {
        if (current.includes(platform)) {
          return current.filter((item) => item !== platform);
        }

        return [...current, platform];
      });
    },
    []
  );

  const generate = useCallback(async () => {
    if (!platforms.length) {
      toaster.show('Select at least one platform.', 'warning');
      return;
    }

    setLoading(true);
    setResponse(null);
    setStatusText(t('generating_copy', 'Generating copy...'));

    const requestBody = {
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
      ...(knowledgeFacts
        .split('\n')
        .map((fact) => fact.trim())
        .filter(Boolean).length
        ? {
            knowledgeBaseFacts: knowledgeFacts
              .split('\n')
              .map((fact) => fact.trim())
              .filter(Boolean)
              .map((text) => ({ text })),
          }
        : {}),
    };

    try {
      const request = await fetch('/posts/copy/generate', {
        method: 'POST',
        body: JSON.stringify(requestBody),
      });

      if (!request.body) {
        throw new Error('No response body returned');
      }

      const reader = request.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let finalResponse: GenerateMediaCopyResponse | null = null;
      let buffer = '';

      const parseLine = (line: string) => {
        if (!line.trim()) {
          return;
        }

        try {
          const parsed = JSON.parse(line);
          const stageName = parsed.name as string;
          setStatusText(
            stageLabelMap[stageName] ||
              t('processing_media_copy', 'Processing media copy...')
          );

          if (stageName === 'platform-started' && parsed.data?.platform) {
            const platform = parsed.data.platform as CopyPlatform;
            setStatusText(`Generating ${platformLabels[platform]}...`);
          }

          if (stageName === 'platform-rewrite-started' && parsed.data?.platform) {
            const platform = parsed.data.platform as CopyPlatform;
            setStatusText(
              `Refining ${platformLabels[platform]} to sound more natural...`
            );
          }

          if (stageName === 'completed') {
            finalResponse = parsed.data as GenerateMediaCopyResponse;
          }
        } catch {
          // Ignore malformed streaming messages.
        }
      };

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          parseLine(line);
        }
      }

      buffer += decoder.decode();
      parseLine(buffer);

      if (!finalResponse) {
        throw new Error('Copy generation did not return a final payload');
      }

      setResponse(finalResponse);
      setEditedDrafts(
        finalResponse.results.reduce(
          (all, result) => ({
            ...all,
            [result.platform]: result.draft,
          }),
          {} as Record<CopyPlatform, string>
        )
      );
      setStatusText('');
    } catch (error: any) {
      toaster.show(
        error?.message || 'Failed to generate media copy. Please try again.',
        'warning'
      );
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
    t,
    toaster,
    transcript,
  ]);

  const applyDrafts = useCallback(() => {
    if (!response?.results.length) {
      return;
    }

    let appliedToChannel = false;

    for (const result of response.results) {
      const draft = editedDrafts[result.platform] || result.draft;
      const matches = selectedIntegrations.filter(
        (integration) =>
          mapIntegrationIdentifierToCopyPlatform(integration.integration.identifier) ===
          result.platform
      );

      if (matches.length) {
        appliedToChannel = true;
        for (const integration of matches) {
          upsertInternalValueText(integration.integration.id, postIndex, draft);
        }
      }
    }

    if (!appliedToChannel) {
      const firstResult = response.results[0];
      setGlobalValueText(postIndex, editedDrafts[firstResult.platform] || firstResult.draft);
    }

    toaster.show(
      appliedToChannel
        ? 'Generated drafts were applied to matching selected channels.'
        : 'Generated draft was applied to the current post.',
      'success'
    );
    onClose();
  }, [
    editedDrafts,
    onClose,
    postIndex,
    response,
    selectedIntegrations,
    setGlobalValueText,
    toaster,
    upsertInternalValueText,
  ]);

  return (
    <div className="flex flex-col gap-[16px] text-textColor min-w-[720px] max-w-[820px]">
      <div className="text-[14px] text-gray-400">
        {mediaType === 'video'
          ? t(
              'video_copy_generation_hint',
              'Video drafts work best with a transcript. We will try best-effort transcription if you leave it blank.'
            )
          : t(
              'image_copy_generation_hint',
              'Generate grounded platform copy from the first attached media item.'
            )}
      </div>

      {!response && (
        <>
          <div className="flex flex-col gap-[8px]">
            <div className="text-[13px] font-[600]">Platforms</div>
            <div className="grid grid-cols-3 gap-[8px]">
              {COPY_PLATFORMS.map((platform) => (
                <label
                  key={platform}
                  className="bg-newBgColorInner rounded-[8px] px-[12px] py-[8px] flex items-center gap-[8px]"
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
            {!selectedPlatforms.length && (
              <div className="text-[13px] text-gray-400">
                {t(
                  'select_supported_platform_for_copy_generation',
                  'Select a supported platform to generate platform-specific copy.'
                )}
              </div>
            )}
          </div>

          <Textarea
            disableForm
            name="audience"
            label={t('audience_optional', 'Audience (optional)')}
            placeholder={t(
              'audience_placeholder',
              'Who should this post resonate with?'
            )}
            value={audience}
            onChange={(event) => setAudience(event.target.value)}
          />

          <div className="grid grid-cols-2 gap-[12px]">
            <Select
              disableForm
              name="goal"
              label={t('goal', 'Goal')}
              value={goal}
              onChange={(event) =>
                setGoal(event.target.value as 'attract' | 'nurture' | 'position' | 'convert')
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
              label={t('cta_strength', 'CTA strength')}
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
            label={t('cta_action_optional', 'CTA action (optional)')}
            placeholder={t(
              'cta_action_placeholder',
              'Example: ask for replies, visit the site, book a demo'
            )}
            value={ctaAction}
            onChange={(event) => setCtaAction(event.target.value)}
          />

          {mediaType === 'video' && (
            <Textarea
              disableForm
              name="transcript"
              label={t('transcript_optional', 'Transcript (optional)')}
              placeholder={t(
                'transcript_placeholder',
                'Paste a transcript here to make video drafts more grounded.'
              )}
              value={transcript}
              onChange={(event) => setTranscript(event.target.value)}
            />
          )}

          <Textarea
            disableForm
            name="knowledgeFacts"
            label={t('knowledge_base_facts_optional', 'Knowledge base facts (optional)')}
            placeholder={t(
              'knowledge_base_facts_placeholder',
              'Add one fact per line to steer the message.'
            )}
            value={knowledgeFacts}
            onChange={(event) => setKnowledgeFacts(event.target.value)}
          />

          {statusText ? (
            <div className="text-[13px] text-gray-400">{statusText}</div>
          ) : null}

          <div className="flex justify-end gap-[8px]">
            <Button secondary onClick={onClose}>
              {t('cancel', 'Cancel')}
            </Button>
            <Button loading={loading} disabled={!platforms.length} onClick={generate}>
              {t('generate_copy', 'Generate copy')}
            </Button>
          </div>
        </>
      )}

      {response && (
        <>
          {response.warnings.length > 0 && (
            <div className="rounded-[8px] bg-[#2A2020] border border-[#5A2F2F] px-[12px] py-[10px] text-[13px]">
              {response.warnings.map((warning) => (
                <div key={`${warning.code}-${warning.message}`}>{warning.message}</div>
              ))}
            </div>
          )}

          <div className="flex flex-col gap-[12px] max-h-[65vh] overflow-y-auto pe-[6px]">
            {response.results.map((result) => (
              <div
                key={result.platform}
                className="rounded-[12px] bg-newBgColorInner px-[14px] py-[14px] flex flex-col gap-[10px]"
              >
                <div className="flex items-center justify-between">
                  <div className="text-[15px] font-[600]">
                    {platformLabels[result.platform]}
                  </div>
                  <div className="text-[12px] text-gray-400">
                    {result.charCount} chars
                    {result.rewritten ? ' • rewritten' : ''}
                    {typeof result.antiGenericScore === 'number'
                      ? ` • score ${result.antiGenericScore}`
                      : ''}
                  </div>
                </div>
                <textarea
                  className="bg-input min-h-[150px] p-[16px] outline-none border-fifth border rounded-[8px] text-inputText placeholder-inputText"
                  value={editedDrafts[result.platform] || result.draft}
                  onChange={(event) =>
                    setEditedDrafts((current) => ({
                      ...current,
                      [result.platform]: event.target.value,
                    }))
                  }
                />
                {result.warnings.length > 0 && (
                  <div className="text-[12px] text-gray-400 flex flex-col gap-[4px]">
                    {result.warnings.map((warning) => (
                      <div key={`${result.platform}-${warning.code}`}>
                        {warning.message}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="flex justify-end gap-[8px]">
            <Button secondary onClick={onClose}>
              {t('close', 'Close')}
            </Button>
            <Button onClick={applyDrafts}>
              {t('apply_drafts', 'Apply drafts')}
            </Button>
          </div>
        </>
      )}
    </div>
  );
};

export const MediaCopyButton: FC<{
  media: { id: string; path: string }[];
  postIndex: number;
}> = ({ media, postIndex }) => {
  const t = useT();
  const modals = useModals();

  const firstMedia = media?.[0];
  const mediaType =
    firstMedia?.path?.toLowerCase?.()?.includes('.mp4') ? 'video' : 'image';

  const openModal = useCallback(() => {
    if (!firstMedia?.id) {
      return;
    }

    modals.openModal({
      title: t('generate_text_copy', 'Generate Text Copy'),
      size: 860,
      children: (close) => (
        <MediaCopyModal
          mediaId={firstMedia.id}
          mediaType={mediaType}
          postIndex={postIndex}
          onClose={close}
        />
      ),
    });
  }, [firstMedia?.id, mediaType, modals, postIndex, t]);

  return (
    <Button
      secondary
      className="!h-[30px] !px-[10px] text-[12px] rounded-[6px]"
      disabled={!firstMedia?.id}
      onClick={openModal}
    >
      {t('generate_copy', 'Generate copy')}
    </Button>
  );
};
