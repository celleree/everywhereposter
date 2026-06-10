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
import { AddEditModalProps } from '@gitroom/frontend/components/new-launch/add.edit.modal';
import clsx from 'clsx';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { PicksSocialsComponent } from '@gitroom/frontend/components/new-launch/picks.socials.component';
import { EditorWrapper } from '@gitroom/frontend/components/new-launch/editor';
import { SelectCurrent } from '@gitroom/frontend/components/new-launch/select.current';
import { ShowAllProviders } from '@gitroom/frontend/components/new-launch/providers/show.all.providers';
import { useExistingData } from '@gitroom/frontend/components/launches/helpers/use.existing.data';
import { useLaunchStore } from '@gitroom/frontend/components/new-launch/store';
import { DatePicker } from '@gitroom/frontend/components/launches/helpers/date.picker';
import { useShallow } from 'zustand/react/shallow';
import { RepeatComponent } from '@gitroom/frontend/components/launches/repeat.component';
import { TagsComponent } from '@gitroom/frontend/components/launches/tags.component';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { weightedLength } from '@gitroom/helpers/utils/count.length';
import { deleteDialog } from '@gitroom/react/helpers/delete.dialog';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { capitalize } from 'lodash';
import { SelectCustomer } from '@gitroom/frontend/components/launches/select.customer';
import { CopilotPopup } from '@copilotkit/react-ui';
import { useCopilotReadable } from '@copilotkit/react-core';
import { DummyCodeComponent } from '@gitroom/frontend/components/new-launch/dummy.code.component';
import { stripHtmlValidation } from '@gitroom/helpers/utils/strip.html.validation';
import {
  SettingsIcon,
  ChevronDownIcon,
  CloseIcon,
  TrashIcon,
  DropdownArrowSmallIcon,
} from '@gitroom/frontend/components/ui/icons';
import { useShortlinkPreference } from '@gitroom/frontend/components/settings/shortlink-preference.component';
import dayjs from 'dayjs';
import { Button } from '@gitroom/react/form/button';
import { useDropzone } from 'react-dropzone';
import { useUppyUploader } from '@gitroom/frontend/components/media/new.uploader';
import { MediaBox } from '@gitroom/frontend/components/media/media.component';
import { Dashboard } from '@uppy/react';
import { VideoOrImage } from '@gitroom/react/helpers/video.or.image';
import { useMediaDirectory } from '@gitroom/react/helpers/use.media.directory';
import {
  CopyPlatform,
  mapIntegrationIdentifierToCopyPlatform,
} from '@gitroom/nestjs-libraries/copy-generation/platform-rules';
import { GenerateMediaCopyResponse } from '@gitroom/nestjs-libraries/dtos/copy-generation/generate.media.copy.response';

const MAX_UPLOAD_SIZE = 1024 * 1024 * 1024; // 1 GB

const AI_PRESETS = [
  {
    id: 'rewrite-linkedin',
    platform: 'linkedin',
    title: 'Generate LinkedIn post',
    helper: 'Professional and useful.',
    buildMessage: (platformText: string) =>
      `Generate a LinkedIn post using the uploaded media context, current draft, and selected accounts: ${platformText}. Keep it clear, useful, and professional. Apply the result with the setPosts action.`,
  },
  {
    id: 'rewrite-x',
    platform: 'x',
    title: 'Generate X post',
    helper: 'Short and feed-native.',
    buildMessage: (platformText: string) =>
      `Generate an X post using the uploaded media context, current draft, and selected accounts: ${platformText}. Keep it concise, specific, and platform-native. Apply the result with the setPosts action.`,
  },
  {
    id: 'generate-facebook',
    platform: 'facebook',
    title: 'Generate Facebook post',
    helper: 'Friendly and readable.',
    buildMessage: (platformText: string) =>
      `Generate a Facebook post using the uploaded media context, current draft, and selected accounts: ${platformText}. Make it warm, readable, and easy to engage with. Apply the result with the setPosts action.`,
  },
  {
    id: 'generate-instagram',
    platform: 'instagram',
    title: 'Generate Instagram caption',
    helper: 'Visual and caption-native.',
    buildMessage: (platformText: string) =>
      `Generate an Instagram caption using the uploaded media context, current draft, and selected accounts: ${platformText}. Make the first line clear, keep it grounded in the media, and apply the result with the setPosts action.`,
  },
  {
    id: 'generate-bluesky',
    platform: 'bluesky',
    title: 'Generate Bluesky post',
    helper: 'Conversational and direct.',
    buildMessage: (platformText: string) =>
      `Generate a Bluesky post using the uploaded media context, current draft, and selected accounts: ${platformText}. Keep it conversational, direct, and not overly polished. Apply the result with the setPosts action.`,
  },
] as const;

function countCharacters(text: string, type: string): number {
  if (type !== 'x') {
    return text.length;
  }
  return weightedLength(text);
}

export const ManageModal: FC<AddEditModalProps> = (props) => {
  const t = useT();
  const fetch = useFetch();
  const ref = useRef<any>(null);
  const existingData = useExistingData();
  const [loading, setLoading] = useState(false);
  const toaster = useToaster();
  const modal = useModals();
  const [showSettings, setShowSettings] = useState(false);
  const [activeAiPreset, setActiveAiPreset] = useState<string>(
    AI_PRESETS[0].id
  );
  const [copilotSeed] = useState(0);
  const [queuedAiPreset, setQueuedAiPreset] = useState('');
  const [copyGenerationLoading, setCopyGenerationLoading] = useState(false);
  const [copyGenerationStatus, setCopyGenerationStatus] = useState('');
  const { data: shortlinkPreferenceData } = useShortlinkPreference();

  const { addEditSets, mutate, customClose, dummy, standaloneCreate } = props;

  const {
    selectedIntegrations,
    hide,
    date,
    setDate,
    repeater,
    setRepeater,
    tags,
    setTags,
    integrations,
    setSelectedIntegrations,
    setGlobalValueText,
    upsertInternalValueText,
    locked,
    current,
    activateExitButton,
    setHide,
    global,
    appendGlobalValueMedia,
  } = useLaunchStore(
    useShallow((state) => ({
      hide: state.hide,
      setHide: state.setHide,
      date: state.date,
      setDate: state.setDate,
      current: state.current,
      repeater: state.repeater,
      setRepeater: state.setRepeater,
      tags: state.tags,
      setTags: state.setTags,
      selectedIntegrations: state.selectedIntegrations,
      integrations: state.integrations,
      setSelectedIntegrations: state.setSelectedIntegrations,
      setGlobalValueText: state.setGlobalValueText,
      upsertInternalValueText: state.upsertInternalValueText,
      locked: state.locked,
      activateExitButton: state.activateExitButton,
      global: state.global,
      appendGlobalValueMedia: state.appendGlobalValueMedia,
    }))
  );

  useEffect(() => {
    if (hide) {
      setHide(false);
    }
  }, [hide, setHide]);

  useEffect(() => {
    if (current === 'global') {
      setShowSettings(false);
    }
  }, [current]);

  const currentIntegrationText = useMemo(() => {
    if (current === 'global') {
      return (
        <div className="flex min-w-0 items-center gap-[10px]">
          <div className="relative">
            <SettingsIcon size={15} className="text-white" />
          </div>
          <div className="min-w-0 break-words">
            {t('channel_settings', 'Advanced settings')}
          </div>
        </div>
      );
    }

    const currentIntegration = integrations.find((p) => p.id === current)!;

    return (
      <div className="flex min-w-0 items-center gap-[10px]">
        <div className="relative">
          <img
            src={`/icons/platforms/${currentIntegration.identifier}.png`}
            className="h-[20px] w-[20px] rounded-[4px]"
            alt={currentIntegration.identifier}
          />
          <SettingsIcon
            size={15}
            className="absolute -bottom-[5px] -end-[5px] text-white"
          />
        </div>
        <div className="min-w-0 break-words">
          {currentIntegration.name} {t('channel_settings', 'Advanced settings')}
        </div>
      </div>
    );
  }, [current, integrations, t]);

  const existingRootPost = useMemo(() => {
    const posts = existingData?.posts || [];
    const rootPosts = posts.filter((post) => !post.parentPostId);
    const targetIntegrationId =
      current !== 'global' ? current : existingData.integration;

    return (
      rootPosts.find((post) => post.integrationId === targetIntegrationId) ||
      rootPosts.find((post) => post.integrationId === existingData.integration) ||
      rootPosts[0] ||
      posts[0]
    );
  }, [current, existingData.integration, existingData.posts]);
  const previewPostIdsByIntegration = useMemo(() => {
    return (existingData?.posts || []).reduce<Record<string, string>>(
      (acc, post) => {
        if (
          post.state === 'PUBLISHED' &&
          !post.parentPostId &&
          post.integrationId &&
          post.id
        ) {
          acc[post.integrationId] = post.id;
        }

        return acc;
      },
      {}
    );
  }, [existingData.posts]);
  const existingIntegration = useMemo(
    () =>
      integrations.find(
        (integration) => integration.id === existingData.integration
      ),
    [integrations, existingData.integration]
  );
  const publishedCapabilities = existingIntegration?.publishedCapabilities;
  const isPublishedPost = existingRootPost?.state === 'PUBLISHED';
  const isRemoteDeletedPost = existingRootPost?.state === 'DELETED_REMOTE';
  const isPublishedManagementView = isPublishedPost;
  const showPublishedActions =
    !!existingData?.integration && (isPublishedPost || isRemoteDeletedPost);
  const missingPublishedReleaseId =
    !!existingData?.integration &&
    (!existingRootPost?.releaseId || existingRootPost?.releaseId === 'missing');
  const globalMedia = global?.[0]?.media || [];
  const selectedCopyPlatforms = useMemo(
    () =>
      new Set(
        selectedIntegrations
          .map(({ integration }) =>
            mapIntegrationIdentifierToCopyPlatform(integration.identifier)
          )
          .filter((platform): platform is CopyPlatform => !!platform)
      ),
    [selectedIntegrations]
  );
  const availableAiPresets = useMemo(
    () =>
      AI_PRESETS.filter((preset) =>
        selectedCopyPlatforms.has(preset.platform as CopyPlatform)
      ),
    [selectedCopyPlatforms]
  );
  const selectedPlatformText = useMemo(() => {
    if (!selectedIntegrations.length) {
      return 'the selected platforms';
    }

    return selectedIntegrations
      .map(({ integration }) => integration.name)
      .join(', ');
  }, [selectedIntegrations]);

  useCopilotReadable({
    description: 'Selected social accounts for the current composer',
    value: selectedIntegrations.map(({ integration }) => ({
      id: integration.id,
      name: integration.name,
      platform: integration.identifier,
    })),
  });

  useCopilotReadable({
    description: 'Shared uploaded media attached to the current composer',
    value: globalMedia.map((media: any) => ({
      id: media.id,
      path: media.path,
      alt: media.alt || '',
    })),
  });

  useEffect(() => {
    if (isPublishedManagementView && current !== 'global') {
      setShowSettings(true);
    }
  }, [current, isPublishedManagementView]);

  useEffect(() => {
    if (!availableAiPresets.length) {
      setQueuedAiPreset('');
      return;
    }

    if (
      queuedAiPreset &&
      !availableAiPresets.some((preset) => preset.id === queuedAiPreset)
    ) {
      setQueuedAiPreset('');
    }

    if (!availableAiPresets.some((preset) => preset.id === activeAiPreset)) {
      setActiveAiPreset(availableAiPresets[0].id);
    }
  }, [activeAiPreset, availableAiPresets, queuedAiPreset]);

  const copilotSuggestions = useMemo(() => {
    if (!availableAiPresets.length) {
      return [];
    }

    const active =
      availableAiPresets.find((preset) => preset.id === activeAiPreset) ||
      availableAiPresets[0];
    const rest = availableAiPresets
      .filter((preset) => preset.id !== active.id)
      .slice(0, 5);

    return [active, ...rest].map((preset) => ({
      title: preset.title,
      message: preset.buildMessage(selectedPlatformText),
    }));
  }, [activeAiPreset, availableAiPresets, selectedPlatformText]);

  const updatePublishedDisabledReason = useMemo(() => {
    if (!showPublishedActions) {
      return '';
    }

    if (isRemoteDeletedPost) {
      return t(
        'this_post_was_already_deleted_on_the_platform',
        'This post was already deleted on the platform.'
      );
    }

    if (missingPublishedReleaseId) {
      return t(
        'published_post_is_missing_platform_id',
        'This published post is missing its platform ID, so it cannot be updated.'
      );
    }

    if (publishedCapabilities?.requiresReconnect) {
      return (
        publishedCapabilities.reason ||
        t(
          'reconnect_channel_to_manage_published_posts',
          'Reconnect this channel to manage published posts.'
        )
      );
    }

    if (publishedCapabilities?.editMode === 'none') {
      return (
        publishedCapabilities.reason ||
        t(
          'provider_does_not_support_published_edits',
          'This platform does not support editing published posts yet.'
        )
      );
    }

    return '';
  }, [
    showPublishedActions,
    isRemoteDeletedPost,
    missingPublishedReleaseId,
    publishedCapabilities,
    t,
  ]);

  const deleteOnPlatformDisabledReason = useMemo(() => {
    if (!showPublishedActions) {
      return '';
    }

    if (isRemoteDeletedPost) {
      return t(
        'this_post_was_already_deleted_on_the_platform',
        'This post was already deleted on the platform.'
      );
    }

    if (missingPublishedReleaseId) {
      return t(
        'published_post_is_missing_platform_id',
        'This published post is missing its platform ID, so it cannot be deleted on the platform.'
      );
    }

    if (publishedCapabilities?.requiresReconnect) {
      return (
        publishedCapabilities.reason ||
        t(
          'reconnect_channel_to_manage_published_posts',
          'Reconnect this channel to manage published posts.'
        )
      );
    }

    if (!publishedCapabilities?.canDeletePublished) {
      return (
        publishedCapabilities?.reason ||
        t(
          'provider_does_not_support_published_deletes',
          'This platform does not support deleting published posts yet.'
        )
      );
    }

    return '';
  }, [
    showPublishedActions,
    isRemoteDeletedPost,
    missingPublishedReleaseId,
    publishedCapabilities,
    t,
  ]);

  const publishedActionHint = useMemo(() => {
    if (!showPublishedActions) {
      return '';
    }

    if (isRemoteDeletedPost) {
      return t(
        'deleted_on_platform_can_republish',
        'This post was already deleted on the platform. You can republish it or remove it from Publish Everywhere.'
      );
    }

    return (
      updatePublishedDisabledReason ||
      deleteOnPlatformDisabledReason ||
      publishedCapabilities?.constraints?.[0] ||
      ''
    );
  }, [
    showPublishedActions,
    isRemoteDeletedPost,
    updatePublishedDisabledReason,
    deleteOnPlatformDisabledReason,
    publishedCapabilities,
    t,
  ]);

  const changeCustomer = useCallback(
    (customer: string) => {
      const neededIntegrations = integrations.filter(
        (p) => p?.customer?.id === customer
      );
      setSelectedIntegrations(
        neededIntegrations.map((p) => ({
          settings: {},
          selectedIntegrations: p,
        }))
      );
    },
    [integrations, setSelectedIntegrations]
  );

  const askClose = useCallback(async () => {
    if (!activateExitButton || dummy) {
      return;
    }

    if (
      await deleteDialog(
        t(
          'are_you_sure_you_want_to_close_this_modal_all_data_will_be_lost',
          'Are you sure you want to close this modal? (all data will be lost)'
        ),
        t('yes_close_it', 'Yes, close it!')
      )
    ) {
      if (customClose) {
        customClose();
        return;
      }
      modal.closeAll();
    }
  }, [activateExitButton, customClose, dummy, modal, t]);

  const deletePost = useCallback(async () => {
    setLoading(true);
    const confirmationMessage = showPublishedActions
      ? t(
          'are_you_sure_you_want_to_remove_this_post_from_publish_everywhere',
          'Are you sure you want to remove this post from Publish Everywhere? This does not change the live platform post.'
        )
      : t(
          'are_you_sure_you_want_to_delete_post',
          'Are you sure you want to delete this post?'
        );
    if (
      !(await deleteDialog(
        confirmationMessage,
        showPublishedActions
          ? t('yes_remove_it', 'Yes, remove it!')
          : t('yes_delete_it', 'Yes, delete it!')
      ))
    ) {
      setLoading(false);
      return;
    }
    await fetch(`/posts/${existingData.group}`, {
      method: 'DELETE',
    });
    mutate();
    modal.closeAll();
  }, [existingData.group, fetch, modal, mutate, showPublishedActions, t]);

  const deletePublishedPost = useCallback(async () => {
    if (!existingData.group || deleteOnPlatformDisabledReason) {
      return;
    }

    setLoading(true);

    if (
      !(await deleteDialog(
        t(
          'are_you_sure_you_want_to_delete_this_post_on_the_platform',
          'Are you sure you want to delete this post on the live platform?'
        ),
        t('yes_delete_on_platform', 'Yes, delete it!')
      ))
    ) {
      setLoading(false);
      return;
    }

    const response = await fetch(`/posts/${existingData.group}/published`, {
      method: 'DELETE',
    });

    if (!response.ok) {
      let message = t(
        'failed_to_delete_the_published_post',
        'Failed to delete the published post.'
      );

      try {
        const raw = await response.text();
        if (raw) {
          const parsed = JSON.parse(raw);
          message = Array.isArray(parsed?.message)
            ? parsed.message.join(', ')
            : parsed?.message || parsed?.error || raw;
        }
      } catch {
        // Keep the fallback message when the response is not JSON.
      }

      toaster.show(message, 'warning');
      setLoading(false);
      return;
    }

    mutate();
    toaster.show(
      t(
        'published_post_deleted_on_platform',
        'Published post deleted on platform'
      )
    );
    modal.closeAll();
  }, [
    existingData.group,
    deleteOnPlatformDisabledReason,
    fetch,
    modal,
    mutate,
    t,
    toaster,
  ]);

  const applyGeneratedCopy = useCallback(
    (response: GenerateMediaCopyResponse) => {
      let appliedToChannel = false;

      for (const result of response.results) {
        const matches = selectedIntegrations.filter(
          ({ integration }) =>
            mapIntegrationIdentifierToCopyPlatform(integration.identifier) ===
            result.platform
        );

        if (!matches.length) {
          continue;
        }

        appliedToChannel = true;
        for (const { integration } of matches) {
          upsertInternalValueText(integration.id, 0, result.draft);
        }
      }

      if (!appliedToChannel && response.results[0]?.draft) {
        setGlobalValueText(0, response.results[0].draft);
      }

      toaster.show(
        appliedToChannel
          ? t(
              'generated_copy_applied_to_selected_channels',
              'Generated copy applied to selected channels.'
            )
          : t('generated_copy_applied', 'Generated copy applied.'),
        'success'
      );
    },
    [
      selectedIntegrations,
      setGlobalValueText,
      t,
      toaster,
      upsertInternalValueText,
    ]
  );

  const generateCopyForPreset = useCallback(
    async (presetId: string, media?: { id?: string; path?: string }) => {
      const preset = availableAiPresets.find((item) => item.id === presetId);
      const sourceMedia = media || globalMedia[0];

      if (!preset) {
        setQueuedAiPreset('');
        return;
      }

      setActiveAiPreset(preset.id);

      if (!sourceMedia?.id) {
        setQueuedAiPreset(preset.id);
        setCopyGenerationStatus(
          t(
            'copy_generation_waiting_for_upload',
            'Copy will generate automatically after upload.'
          )
        );
        return;
      }

      setQueuedAiPreset('');
      setCopyGenerationLoading(true);
      setCopyGenerationStatus(t('generating_copy', 'Generating copy...'));

      try {
        const request = await fetch('/posts/copy/generate', {
          method: 'POST',
          body: JSON.stringify({
            mediaId: sourceMedia.id,
            platforms: [preset.platform],
            goal: 'position',
            ctaPreference: {
              strength: 'soft',
            },
          }),
        });

        if (!request.ok) {
          let message = t('failed_to_generate_copy', 'Failed to generate copy.');

          try {
            const raw = await request.text();
            if (raw) {
              const parsed = JSON.parse(raw);
              message = Array.isArray(parsed?.message)
                ? parsed.message.join(', ')
                : parsed?.message || parsed?.error || raw;
            }
          } catch {
            // Keep the fallback message when the response is not JSON.
          }

          throw new Error(message);
        }

        if (!request.body) {
          throw new Error(
            t(
              'copy_generation_missing_response',
              'Copy generation returned no response.'
            )
          );
        }

        const reader = request.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let finalResponse: GenerateMediaCopyResponse | null = null;

        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }

          const chunk = decoder.decode(value, { stream: true });
          for (const line of chunk.split('\n').filter(Boolean)) {
            try {
              const parsed = JSON.parse(line);
              if (parsed.name === 'completed') {
                finalResponse = parsed.data as GenerateMediaCopyResponse;
              }
            } catch {
              // Ignore incomplete streaming chunks.
            }
          }
        }

        if (!finalResponse) {
          throw new Error(
            t(
              'copy_generation_missing_final_payload',
              'Copy generation did not return a final payload.'
            )
          );
        }

        applyGeneratedCopy(finalResponse);
      } catch (error) {
        toaster.show(
          error instanceof Error
            ? error.message
            : t('failed_to_generate_copy', 'Failed to generate copy.'),
          'warning'
        );
      } finally {
        setCopyGenerationLoading(false);
        setCopyGenerationStatus('');
      }
    },
    [applyGeneratedCopy, availableAiPresets, fetch, globalMedia, t, toaster]
  );

  const handleAiPreset = useCallback(
    (presetId: string) => {
      generateCopyForPreset(presetId);
    },
    [generateCopyForPreset]
  );

  const handleUpload = useCallback(
    (media: any[]) => {
      appendGlobalValueMedia(0, media);

      if (queuedAiPreset && media?.[0]?.id) {
        generateCopyForPreset(queuedAiPreset, media[0]);
      }
    },
    [appendGlobalValueMedia, generateCopyForPreset, queuedAiPreset]
  );

  const schedule = useCallback(
    (type: 'draft' | 'now' | 'schedule' | 'update') => async () => {
      if (
        (type === 'now' || type === 'schedule') &&
        (existingData?.posts?.[0]?.state === 'PUBLISHED' ||
          (existingData?.posts?.[0]?.state === 'QUEUE' &&
            dayjs().isAfter(date.utc())))
      ) {
        const whatToDo = await new Promise((resolve) => {
          modal.openModal({
            title: 'What do you want to do?',
            children: (
              <div className="flex flex-col">
                <div className="mb-[20px] text-[20px]">
                  This post was already published, what do you want to do?
                </div>
                <div className="flex w-full gap-[10px]">
                  <div className="flex flex-1">
                    <Button
                      type="button"
                      className="flex-1"
                      onClick={() => resolve('update')}
                    >
                      Just update the post details
                    </Button>
                  </div>
                  <div className="flex flex-1">
                    <Button
                      type="button"
                      className="flex-1"
                      onClick={() => resolve('republish')}
                    >
                      Republish the post
                    </Button>
                  </div>
                </div>
              </div>
            ),
          });
        });

        if (whatToDo === 'update') {
          type = 'update';
        }
      }

      setLoading(true);
      const checkAllValid = await ref.current.checkAllValid();

      const notEnoughChars = checkAllValid.filter((p: any) => {
        return p.values.some((a: any) => {
          return (
            countCharacters(
              stripHtmlValidation('normal', a.content, true),
              p?.integration?.identifier || ''
            ) === 0 && a.media?.length === 0
          );
        });
      });

      for (const item of notEnoughChars) {
        toaster.show(
          `${capitalize(item.integration.identifier.split('-')[0])} (${
            item.integration.name
          }):` +
            ' ' +
            t(
              'post_needs_content_or_image',
              'Your post should have at least one character or one image.'
            ),
          'warning'
        );
        setLoading(false);
        item.preview();
        return;
      }

      if (type !== 'draft') {
        for (const item of checkAllValid) {
          if (item.valid === false) {
            toaster.show(
              `${capitalize(item.integration.identifier.split('-')[0])} (${
                item.integration.name
              }): ${t('please_fix_your_settings', 'Please fix your settings')}`,
              'warning'
            );
            item.fix();
            setLoading(false);
            setShowSettings(true);
            return;
          }

          if (item.errors !== true) {
            toaster.show(
              `${capitalize(item.integration.identifier.split('-')[0])} (${
                item.integration.name
              }): ${item.errors}`,
              'warning'
            );
            item.preview();
            setLoading(false);
            setShowSettings(false);
            return;
          }
        }

        const sliceNeeded = checkAllValid.filter((p: any) => {
          return p.values.some((a: any) => {
            const strip = stripHtmlValidation('normal', a.content, true);
            const weighted = countCharacters(
              strip,
              p?.integration?.identifier || ''
            );
            const totalCharacters = weighted > strip.length ? weighted : strip.length;

            return totalCharacters > (p.maximumCharacters || 1000000);
          });
        });

        for (const item of sliceNeeded) {
          toaster.show(
            `${item?.integration?.name} (${item?.integration?.identifier}) ${t(
              'post_is_too_long',
              'post is too long, please fix it'
            )}`,
            'warning'
          );
          item.preview();
          setLoading(false);
          return;
        }
      }

      const shortlinkPreference = shortlinkPreferenceData?.shortlink || 'ASK';

      let shortLink = false;

      if (!dummy && shortlinkPreference !== 'NO') {
        const shortLinkUrl = await (
          await fetch('/posts/should-shortlink', {
            method: 'POST',
            body: JSON.stringify({
              messages: checkAllValid.flatMap((p: any) =>
                p.values.flatMap((a: any) => a.content)
              ),
            }),
          })
        ).json();

        if (shortLinkUrl.ask) {
          if (shortlinkPreference === 'YES') {
            shortLink = true;
          } else {
            shortLink = await deleteDialog(
              t(
                'shortlink_urls_question',
                'Do you want to shortlink the URLs? it will let you get statistics over clicks'
              ),
              t('yes_shortlink_it', 'Yes, shortlink it!')
            );
          }
        }
      }

      const group = existingData.group || makeId(10);
      const data = {
        type,
        ...(repeater ? { inter: repeater } : {}),
        tags,
        shortLink,
        date: date.utc().format('YYYY-MM-DDTHH:mm:ss'),
        posts: checkAllValid.map((post: any) => ({
          integration: {
            id: post.integration.id,
          },
          group,
          settings: { ...(post.settings || {}) },
          value: post.values.map((value: any) => ({
            ...(value.id ? { id: value.id } : {}),
            content: value.content,
            delay: value.delay || 0,
            image:
              (value?.media || []).map(
                ({ id, path, alt, thumbnail, thumbnailTimestamp }: any) => ({
                  id,
                  path,
                  alt,
                  thumbnail,
                  thumbnailTimestamp,
                })
              ) || [],
          })),
        })),
      };

      if (dummy) {
        modal.openModal({
          title: '',
          children: <DummyCodeComponent code={data} />,
          classNames: {
            modal: 'w-[100%] bg-transparent text-textColor',
          },
          size: '100%',
          withCloseButton: false,
          closeOnEscape: true,
          closeOnClickOutside: true,
        });

        setLoading(false);
      }

      if (!dummy) {
        try {
          if (addEditSets) {
            await addEditSets(data);
          } else {
            const response = await fetch('/posts', {
              method: 'POST',
              body: JSON.stringify(data),
            });

            if (!response.ok) {
              let message = t('failed_to_save_post', 'Failed to save post');

              try {
                const raw = await response.text();
                if (raw) {
                  const parsed = JSON.parse(raw);
                  message = Array.isArray(parsed?.message)
                    ? parsed.message.join(', ')
                    : parsed?.message || parsed?.error || raw;
                }
              } catch {
                // Keep the fallback message if the response is not JSON.
              }

              toaster.show(message, 'warning');
              setLoading(false);
              return;
            }
          }
        } catch (error) {
          toaster.show(
            error instanceof Error
              ? error.message
              : t('failed_to_save_post', 'Failed to save post'),
            'warning'
          );
          setLoading(false);
          return;
        }

        if (!addEditSets) {
          mutate();
          toaster.show(
            !existingData.integration
              ? t('added_successfully', 'Added successfully')
              : t('updated_successfully', 'Updated successfully')
          );
        }
        if (customClose) {
          setTimeout(() => {
            customClose();
          }, 2000);
        }

        if (!addEditSets) {
          modal.closeAll();
        }
      }
    },
    [
      addEditSets,
      customClose,
      date,
      dummy,
      existingData.group,
      existingData.integration,
      existingData.posts,
      fetch,
      modal,
      mutate,
      repeater,
      shortlinkPreferenceData,
      t,
      tags,
      toaster,
    ]
  );

  return (
    <div className="relative flex h-full w-full flex-1 overflow-x-hidden overflow-y-auto p-[40px] mobile:h-auto mobile:min-h-full mobile:max-w-[100vw] mobile:min-w-0 mobile:overflow-y-visible mobile:p-0">
      <div className="flex h-fit min-h-full min-w-0 flex-1 flex-col rounded-[20px] bg-newBgColorInner mobile:w-full mobile:max-w-full mobile:overflow-x-hidden mobile:rounded-none">
        <div className="flex min-w-0 mobile:block mobile:w-full mobile:flex-none mobile:overflow-x-hidden">
          <div className="flex min-w-0 flex-1 flex-col border-e border-newBorder mobile:block mobile:w-full mobile:border-e-0 mobile:border-b">
            <div className="flex min-h-[65px] min-w-0 items-center bg-newBgColor px-[20px] text-[20px] font-[600] rounded-s-[20px] !rounded-b-[0] mobile:min-h-0 mobile:w-full mobile:items-start mobile:rounded-none mobile:px-[14px] mobile:py-[14px] mobile:text-[18px]">
              <div className="flex min-w-0 flex-1 flex-col">
                <div>
                  {isPublishedManagementView
                    ? t('published_post', 'Published post')
                    : t('upload', 'Upload')}
                </div>
                {isPublishedManagementView && (
                  <div className="mt-[4px] text-[13px] font-[500] text-textColor/65">
                    {t(
                      'published_post_management_hint',
                      'Review metrics and platform settings.'
                    )}
                  </div>
                )}
              </div>
            </div>
            <div className="min-w-0 overflow-x-hidden mobile:w-full">
              <div
                id="social-content"
                className="flex w-full min-w-0 max-w-full flex-col gap-[24px] overflow-x-hidden p-[20px] mobile:gap-[16px] mobile:px-[12px] mobile:py-[12px]"
              >
                {!isPublishedManagementView && (
                  <>
                    <ComposerSection
                      step="1"
                      title="Upload media"
                      description="Add images or video, then choose where to post."
                    >
                      <ComposerUploadCard
                        disabled={locked}
                        media={globalMedia}
                        onUpload={handleUpload}
                      />
                    </ComposerSection>

                    <ComposerSection
                      step="2"
                      title="Choose platforms"
                      description="Select where this post should go."
                    >
                      <div className="mb-[14px] flex min-w-0 flex-wrap items-center justify-between gap-[12px] mobile:flex-col mobile:items-stretch">
                        <div className="min-w-0 text-[13px] text-textColor/65">
                          {selectedIntegrations.length > 0
                            ? `${selectedIntegrations.length} account${
                                selectedIntegrations.length > 1 ? 's' : ''
                              } selected`
                            : 'No accounts selected'}
                        </div>
                        {!dummy && (
                          <SelectCustomer
                            onChange={changeCustomer}
                            integrations={integrations}
                          />
                        )}
                      </div>
                      <div className="min-w-0 max-w-full overflow-x-hidden">
                        <PicksSocialsComponent toolTip={true} />
                      </div>
                    </ComposerSection>

                    <ComposerSection
                      step="3"
                      title="Generate copy"
                      description="Create captions from your uploaded media."
                    >
                      <div className="grid min-w-0 max-w-full grid-cols-1 gap-[10px] md:grid-cols-2 mobile:gap-[8px]">
                        {availableAiPresets.map((preset) => (
                          <button
                            key={preset.id}
                            type="button"
                            disabled={copyGenerationLoading}
                            onClick={() => handleAiPreset(preset.id)}
                            className={clsx(
                              'min-w-0 max-w-full rounded-[12px] border px-[14px] py-[12px] text-start transition-all disabled:cursor-not-allowed disabled:opacity-70 mobile:px-[12px] mobile:py-[12px]',
                              activeAiPreset === preset.id ||
                                queuedAiPreset === preset.id
                                ? 'border-[#7C4DFF] bg-[#22163B]'
                                : 'border-newBorder bg-newBgColor [@media(hover:hover)]:hover:border-[#7C4DFF] [@media(hover:hover)]:hover:bg-newBgLineColor/70'
                            )}
                          >
                            <div className="text-[15px] font-[700] text-white">
                              {preset.title}
                            </div>
                            <div className="mt-[4px] text-[13px] text-textColor/65">
                              {preset.helper}
                            </div>
                          </button>
                        ))}
                      </div>
                      {!availableAiPresets.length && (
                        <div className="rounded-[12px] border border-newBorder bg-newBgColor px-[14px] py-[12px] text-[13px] text-textColor/65">
                          {t(
                            'select_supported_platform_for_copy_generation',
                            'Select a supported platform to generate platform-specific copy.'
                          )}
                        </div>
                      )}
                      {!!copyGenerationStatus && (
                        <div className="mt-[10px] text-[13px] text-textColor/65">
                          {copyGenerationStatus}
                        </div>
                      )}
                    </ComposerSection>

                    <ComposerSection
                      step="4"
                      title="Review and edit"
                      description="Edit the shared post or a platform version."
                    >
                      {!existingData.integration &&
                        selectedIntegrations.length > 0 && (
                          <div className="mb-[16px] min-w-0 max-w-full overflow-x-hidden">
                            <SelectCurrent />
                          </div>
                        )}
                      <div className="flex min-w-0 max-w-full flex-1 overflow-x-hidden mobile:block">
                        {!hide && <EditorWrapper totalPosts={1} value="" />}
                      </div>
                      <div id="social-empty" className="pb-[4px]" />
                    </ComposerSection>
                  </>
                )}

                {current !== 'global' && (
                  <ComposerSection
                    step={isPublishedManagementView ? undefined : '5'}
                    title={
                      isPublishedManagementView
                        ? t('platform_settings', 'Platform settings')
                        : 'Advanced settings'
                    }
                    description={
                      isPublishedManagementView
                        ? t(
                            'published_platform_settings_hint',
                            'Review saved platform settings.'
                          )
                        : 'Optional platform settings.'
                    }
                  >
                    <div
                      id="wrapper-settings"
                      className="min-w-0 max-w-full overflow-x-hidden select-none"
                    >
                      <div className="flex min-w-0 max-w-full flex-col overflow-hidden rounded-[16px] border border-newBorder bg-newSettings">
                        <button
                          type="button"
                          onClick={() => setShowSettings(!showSettings)}
                          className={clsx(
                            'flex min-w-0 items-center gap-[8px] bg-[#612BD3] p-[14px] text-left',
                            showSettings ? 'rounded-b-none' : ''
                          )}
                        >
                          <div className="min-w-0 flex-1 text-[14px] font-[600] text-white">
                            {currentIntegrationText}
                          </div>
                          <ChevronDownIcon
                            rotated={showSettings}
                            className="text-white"
                          />
                        </button>
                        <div
                          className={clsx(
                            'relative text-[14px] font-[500] text-textColor',
                            !showSettings && 'hidden'
                          )}
                        >
                          <div
                            id="social-settings"
                            className="flex min-w-0 max-w-full flex-col gap-[20px] bg-newBgColor p-[12px] mobile:px-[2px]"
                          />
                        </div>
                        <style>
                          {`#social-settings [data-id="${current}"] {display: block !important;}`}
                        </style>
                      </div>
                    </div>
                  </ComposerSection>
                )}

              </div>
            </div>
          </div>

          <div className="flex w-[580px] min-w-0 max-w-full flex-col mobile:w-full mobile:overflow-x-hidden">
            <div className="flex min-h-[65px] min-w-0 items-center bg-newBgColor px-[20px] text-[20px] font-[600] rounded-e-[20px] !rounded-b-[0] mobile:min-h-0 mobile:w-full mobile:items-start mobile:rounded-none mobile:px-[14px] mobile:py-[14px] mobile:text-[18px]">
              <div className="flex min-w-0 flex-1 flex-col">
                <div>{t('post_preview', 'Post Preview')}</div>
                <div className="mt-[4px] text-[13px] font-[500] text-textColor/65">
                  {isPublishedManagementView
                    ? t(
                        'published_preview_hint',
                        'Published post preview.'
                      )
                    : 'Preview updates as you edit.'}
                </div>
              </div>
              <div className="cursor-pointer">
                <CloseIcon onClick={askClose} className="text-[#A3A3A3]" />
              </div>
            </div>
            <div className="min-w-0 overflow-x-hidden p-[20px] mobile:w-full mobile:min-h-[220px] mobile:px-[12px] mobile:py-[12px]">
              <div id="composer-preview-content" className="min-w-0 max-w-full overflow-x-hidden">
                <ShowAllProviders
                  ref={ref}
                  previewPostIdsByIntegration={previewPostIdsByIntegration}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="flex min-h-[84px] min-w-0 items-center border-t border-newBorder py-[16px] select-none mobile:relative mobile:flex-col mobile:items-stretch mobile:gap-[12px] mobile:overflow-x-hidden mobile:py-[12px]">
          <div className="flex min-w-0 flex-1 gap-[8px] ps-[20px] mobile:flex-col mobile:px-[12px] mobile:[&>*]:ml-0 mobile:[&>*]:w-full">
            {!dummy && (
              <TagsComponent
                name="tags"
                label={t('tags', 'Tags')}
                initial={tags}
                onChange={(e) => {
                  setTags(e.target.value);
                }}
              />
            )}

            {!dummy && (
              <RepeatComponent repeat={repeater} onChange={setRepeater} />
            )}
          </div>
          <div className="flex min-w-0 max-w-full flex-col items-end gap-[8px] pe-[20px] mobile:items-stretch mobile:px-[12px]">
            <div className="flex min-w-0 max-w-full items-center justify-end gap-[8px] mobile:flex-col mobile:items-stretch">
              {showPublishedActions && (
                <span
                  className="mobile:w-full"
                  title={deleteOnPlatformDisabledReason || undefined}
                >
                  <button
                    disabled={
                      !!deleteOnPlatformDisabledReason || loading || locked
                    }
                    onClick={deletePublishedPost}
                    className="flex cursor-pointer items-center gap-[8px] text-[15px] font-[600] text-[#FF8A5C] disabled:cursor-not-allowed disabled:opacity-50 mobile:w-full mobile:justify-center"
                  >
                    <div>
                      <TrashIcon />
                    </div>
                    <div>
                      {isRemoteDeletedPost
                        ? t('deleted_on_platform', 'Deleted on platform')
                        : t('delete_on_platform', 'Delete on platform')}
                    </div>
                  </button>
                </span>
              )}
              {existingData?.integration && (
                <button
                  onClick={deletePost}
                  className="flex cursor-pointer items-center gap-[8px] text-[15px] font-[600] text-[#FF3F3F] mobile:w-full mobile:justify-center"
                >
                  <div>
                    <TrashIcon />
                  </div>
                  <div>
                    {showPublishedActions
                      ? t('remove_from_app', 'Remove from app')
                      : t('delete_post', 'Delete Post')}
                  </div>
                </button>
              )}
              {(!showPublishedActions || isRemoteDeletedPost) && (
                <div className="mobile:w-full mobile:min-w-0 mobile:[&>*]:w-full">
                  <DatePicker onChange={setDate} date={date} />
                </div>
              )}
              {!addEditSets && (
                <button
                  disabled={
                    selectedIntegrations.length === 0 || loading || locked
                  }
                  onClick={schedule('draft')}
                  className="relative flex h-[44px] cursor-pointer items-center justify-center rounded-[8px] bg-btnSimple px-[20px] text-[15px] font-[600] disabled:cursor-not-allowed mobile:w-full"
                >
                  {loading && (
                    <div className="absolute left-[50%] top-[50%] -translate-x-[50%] -translate-y-[50%]">
                      <div className="h-[20px] w-[20px] animate-spin rounded-full border-4 border-textColor border-t-transparent" />
                    </div>
                  )}
                  <div className={clsx(loading && 'invisible')}>
                    {t('save_as_draft', 'Save as Draft')}
                  </div>
                </button>
              )}
              {addEditSets && (
                <button
                  className="btnSub flex h-[44px] min-w-[180px] items-center justify-center gap-[8px] rounded-[8px] bg-[#612BD3] ps-[20px] pe-[16px] text-[15px] font-[600] text-white outline-none disabled:cursor-not-allowed disabled:opacity-80 mobile:w-full mobile:min-w-0"
                  disabled={
                    selectedIntegrations.length === 0 || loading || locked
                  }
                  onClick={schedule('draft')}
                >
                  Save Set
                </button>
              )}
              {!addEditSets && standaloneCreate && !dummy && !isPublishedPost && (
                <button
                  disabled={
                    selectedIntegrations.length === 0 || loading || locked
                  }
                  onClick={schedule('now')}
                  className="relative flex h-[44px] cursor-pointer items-center justify-center rounded-[8px] bg-[#D82D7E] px-[20px] text-[15px] font-[600] text-white disabled:cursor-not-allowed disabled:opacity-80 mobile:w-full"
                >
                  {loading && (
                    <div className="absolute left-[50%] top-[50%] -translate-x-[50%] -translate-y-[50%]">
                      <div className="h-[20px] w-[20px] animate-spin rounded-full border-4 border-white border-t-transparent" />
                    </div>
                  )}
                  <div className={clsx(loading && 'invisible')}>
                    {t('post_now', 'Post Now')}
                  </div>
                </button>
              )}
              {!addEditSets && (
                <div className="group relative min-w-0 cursor-pointer mobile:w-full">
                  <button
                    disabled={
                      selectedIntegrations.length === 0 ||
                      loading ||
                      locked ||
                      (isPublishedPost && !!updatePublishedDisabledReason)
                    }
                    onClick={schedule(
                      isPublishedPost ? 'update' : 'schedule'
                    )}
                    className="btnSub relative flex h-[44px] min-w-[180px] items-center justify-center gap-[8px] rounded-[8px] bg-[#612BD3] ps-[20px] pe-[16px] text-white outline-none disabled:cursor-not-allowed disabled:opacity-80 mobile:w-full mobile:min-w-0"
                  >
                    {loading && (
                      <div className="absolute left-[50%] top-[50%] -translate-x-[50%] -translate-y-[50%]">
                        <div className="h-[20px] w-[20px] animate-spin rounded-full border-4 border-white border-t-transparent" />
                      </div>
                    )}
                    <div
                      className={clsx(
                        'text-[15px] font-[600]',
                        loading && 'invisible'
                      )}
                    >
                      {selectedIntegrations.length === 0
                        ? t('check_circles_above', 'Check the circles above')
                        : dummy
                        ? t('create_output', 'Create output')
                        : isRemoteDeletedPost
                        ? t('republish_post', 'Republish post')
                        : isPublishedPost
                        ? t('update_published_post', 'Update published post')
                        : !existingData?.integration
                        ? t('add_to_calendar', 'Add to calendar')
                        : existingData?.posts?.[0]?.state === 'DRAFT'
                        ? t('schedule', 'Schedule')
                        : t('update', 'Update')}
                    </div>
                    {!dummy && !isPublishedPost && (
                      <div className="arrow-change flex h-[20px] w-[20px] items-center justify-center pt-[4px]">
                        <DropdownArrowSmallIcon className="text-white [@media(hover:hover)]:group-hover:rotate-180" />
                      </div>
                    )}
                  </button>

                  {!dummy && !isPublishedPost && !standaloneCreate && (
                    <button
                      onClick={schedule('now')}
                      disabled={
                        selectedIntegrations.length === 0 || loading || locked
                      }
                      className="absolute bottom-[100%] -left-[12px] z-[300] hidden w-[206px] rounded-[8px] bg-newBgColorInner p-[12px] disabled:cursor-not-allowed disabled:opacity-80 [@media(hover:hover)]:group-hover:flex mobile:hidden"
                    >
                      <div className="post-now flex h-[44px] w-full items-center justify-center rounded-[8px] bg-[#D82D7E] text-white">
                        {t('post_now', 'Post Now')}
                      </div>
                    </button>
                  )}
                </div>
              )}
            </div>
            {!!publishedActionHint && (
              <div className="max-w-[420px] text-end text-[12px] text-[#A3A3A3] mobile:max-w-none mobile:text-start">
                {publishedActionHint}
              </div>
            )}
          </div>
        </div>
      </div>

      {!isPublishedManagementView && (
        <CopilotPopup
          key={`composer-copilot-${copilotSeed}-${activeAiPreset}`}
          defaultOpen={copilotSeed > 0}
          hitEscapeToClose={false}
          clickOutsideToClose={true}
          suggestions={copilotSuggestions}
          instructions={`
You are an assistant that helps the user improve and schedule social media posts.
Here are the things you can do:
- rewrite and refine post content
- suggest stronger variations for the selected platforms
- add or remove items in a post thread
- update the current composer by calling the setPosts action when you want to change the draft

Keep the output practical, platform-aware, and less generic.
`}
          labels={{
            title: t('your_assistant', 'Your Assistant'),
            initial: t(
              'assistant_initial_message',
              'Hi! I can help you refine your social media posts.'
            ),
          }}
        />
      )}

      <style>
        {`
          @media (max-width: 1025px) {
            #social-content .preview,
            #composer-preview-content .preview {
              overflow-wrap: anywhere;
              white-space: pre-wrap;
            }

            #composer-preview-content,
            #composer-preview-content > div {
              max-width: 100%;
              min-width: 0;
              overflow-x: hidden;
            }

            #composer-preview-content img,
            #composer-preview-content video {
              max-width: 100%;
            }

            #composer-preview-content [class*="-mx-[15px]"] {
              margin-left: 0;
              margin-right: 0;
            }

            #composer-preview-content [class*="h-[585px]"],
            #composer-preview-content [class*="h-[375px]"],
            #composer-preview-content [class*="h-[280px]"] {
              height: min(220px, 58vw);
            }

            #composer-preview-content [class*="h-[100px]"] {
              height: min(120px, 36vw);
            }
          }
        `}
      </style>
    </div>
  );
};

const ComposerSection: FC<{
  step?: string;
  title: string;
  description: string;
  children: ReactNode;
}> = ({ step, title, description, children }) => {
  return (
    <section className="w-full min-w-0 max-w-full overflow-x-hidden border-b border-newBorder pb-[24px] last:border-b-0 last:pb-0 mobile:pb-[18px]">
      <div className="mb-[14px] flex min-w-0 items-start gap-[12px] mobile:mb-[10px]">
        {!!step && (
          <div className="flex h-[28px] w-[28px] min-w-[28px] items-center justify-center rounded-full bg-newBgLineColor text-[12px] font-[700] text-white mobile:h-[26px] mobile:w-[26px] mobile:min-w-[26px]">
            {step}
          </div>
        )}
        <div className="min-w-0">
          <div className="break-words text-[18px] font-[700] text-white mobile:text-[16px]">
            {title}
          </div>
          <div className="mt-[4px] break-words text-[13px] leading-[1.5] text-textColor/65">
            {description}
          </div>
        </div>
      </div>
      {children}
    </section>
  );
};

const ComposerUploadCard: FC<{
  disabled: boolean;
  media: any[];
  onUpload: (media: any[]) => void;
}> = ({ disabled, media, onUpload }) => {
  const t = useT();
  const toaster = useToaster();
  const modals = useModals();
  const mediaDirectory = useMediaDirectory();
  const [loading, setLoading] = useState(false);

  const uppy = useUppyUploader({
    allowedFileTypes: 'image/*,video/mp4,video/quicktime,video/mov',
    onUploadSuccess: (result: any) => {
      onUpload(result);
      uppy.clear();
    },
    onStart: () => setLoading(true),
    onEnd: () => setLoading(false),
  });

  const handleDrop = useCallback(
    (acceptedFiles: File[]) => {
      const totalSize = acceptedFiles.reduce((acc, file) => acc + file.size, 0);

      if (totalSize > MAX_UPLOAD_SIZE) {
        toaster.show(
          t(
            'upload_size_limit_exceeded',
            'Upload size limit exceeded. Maximum 1 GB per upload session.'
          ),
          'warning'
        );
        return;
      }

      if (acceptedFiles.length > 0) {
        setLoading(true);
      }

      for (const file of acceptedFiles) {
        uppy.addFile(file);
      }
    },
    [toaster, t, uppy]
  );

  const cancelUpload = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      uppy.cancelAll();
    },
    [uppy]
  );

  const openMediaLibrary = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();

      modals.openModal({
        title: t('media_library', 'Media Library'),
        askClose: false,
        closeOnEscape: true,
        fullScreen: true,
        size: 'calc(100% - 80px)',
        height: 'calc(100% - 80px)',
        children: (close) => (
          <MediaBox setMedia={onUpload} closeModal={close} />
        ),
      });
    },
    [modals, onUpload, t]
  );

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop: handleDrop,
    noClick: true,
    disabled,
  });

  return (
    <div
      {...getRootProps()}
      className={clsx(
        'w-full min-w-0 max-w-full overflow-x-hidden rounded-[14px] border border-dashed px-[16px] py-[16px] transition-all mobile:rounded-[12px] mobile:px-[12px] mobile:py-[14px]',
        isDragActive
          ? 'border-[#7C4DFF] bg-[#22163B]'
          : 'border-newBorder bg-newBgColor',
        disabled && 'opacity-70'
      )}
    >
      <input {...getInputProps()} />
      <div className="flex min-w-0 flex-col items-center justify-center gap-[10px] text-center">
        <div className="flex min-w-0 flex-wrap items-center justify-center gap-[10px] mobile:w-full mobile:flex-col">
          <button
            type="button"
            disabled={disabled || loading}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              open();
            }}
            className="rounded-[12px] bg-[#612BD3] px-[22px] py-[13px] text-[14px] font-[700] text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-60 [@media(hover:hover)]:hover:opacity-90 mobile:w-full"
          >
            Choose files
          </button>
          <button
            type="button"
            disabled={disabled || loading}
            onClick={openMediaLibrary}
            className="rounded-[12px] border border-newBorder bg-newBgColorInner px-[22px] py-[13px] text-[14px] font-[700] text-white transition-colors disabled:cursor-not-allowed disabled:opacity-60 [@media(hover:hover)]:hover:border-[#7C4DFF] mobile:w-full"
          >
            {t('media_library', 'Media Library')}
          </button>
          {loading && (
            <button
              type="button"
              onClick={cancelUpload}
              className="rounded-[12px] border border-newBorder bg-newBgColorInner px-[22px] py-[13px] text-[14px] font-[700] text-white transition-colors [@media(hover:hover)]:hover:border-[#7C4DFF] mobile:w-full"
            >
              {t('cancel_upload', 'Cancel upload')}
            </button>
          )}
        </div>
        <div className="break-words text-[13px] leading-[1.4] text-textColor/65">
          Drop files here or browse from your device.
        </div>
      </div>

      <div className="pointer-events-none mt-[16px] min-h-[46px] w-full overflow-hidden rounded-[12px] bg-newBgColorInner uppyChange">
        <Dashboard
          height={46}
          uppy={uppy}
          id="composer-uploader-progress"
          showProgressDetails={true}
          hideUploadButton={true}
          hideRetryButton={true}
          hidePauseResumeButton={true}
          hideCancelButton={true}
          hideProgressAfterFinish={true}
        />
      </div>

      <div
        className={clsx(
          'mt-[16px] min-w-0 max-w-full overflow-x-hidden rounded-[16px] border border-newBorder bg-newBgColorInner p-[14px]',
          !media.length &&
            'flex min-h-[150px] items-center justify-center mobile:min-h-[120px]'
        )}
      >
        {!media.length ? (
          <div className="text-center">
            {loading ? (
              <div className="text-[15px] font-[700] text-white">
                {t('drop_files_here_to_upload', 'Drop your files here to upload')}
              </div>
            ) : (
              <div className="text-[13px] text-textColor/65">
                Images and video are supported.
              </div>
            )}
          </div>
        ) : (
          <div className="flex min-w-0 flex-col gap-[14px]">
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-[12px]">
              <div className="text-[14px] font-[700] text-white">
                Shared media
              </div>
              <div className="text-[13px] text-textColor/65">
                {media.length} asset{media.length > 1 ? 's' : ''} attached
              </div>
            </div>
            <div className="grid min-w-0 max-w-full grid-cols-2 gap-[10px] md:grid-cols-3 xl:grid-cols-4 mobile:gap-[8px]">
              {media.slice(0, 8).map((item: any) => (
                <div
                  key={item.id}
                  className="min-w-0 overflow-hidden rounded-[14px] border border-newBorder bg-black/20"
                >
                  <div className="aspect-[1/1]">
                    <VideoOrImage
                      autoplay={true}
                      src={mediaDirectory.set(item.path)}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
