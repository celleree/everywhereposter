'use client';

import {
  PostComment,
  withProvider,
} from '@gitroom/frontend/components/new-launch/providers/high.order.provider';
import { FC, useEffect } from 'react';
import { Select } from '@gitroom/react/form/select';
import { Checkbox } from '@gitroom/react/form/checkbox';
import { useSettings } from '@gitroom/frontend/components/launches/helpers/use.values';
import { useIntegration } from '@gitroom/frontend/components/launches/helpers/use.integration';
import { useLaunchStore } from '@gitroom/frontend/components/new-launch/store';
import { InstagramDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/instagram.dto';
import { InstagramCollaboratorsTags } from '@gitroom/frontend/components/new-launch/providers/instagram/instagram.tags';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { InstagramPreview } from '@gitroom/frontend/components/new-launch/providers/instagram/instagram.preview';
type InstagramPostTypeOption = {
  value: 'post' | 'reel' | 'story';
  label: string;
};

const postType: InstagramPostTypeOption[] = [
  {
    value: 'post',
    label: 'Post',
  },
  {
    value: 'reel',
    label: 'Reel',
  },
  {
    value: 'story',
    label: 'Story',
  },
];

const postTypesByMedia = {
  standaloneVideo: [postType[1], postType[0], postType[2]],
  default: [postType[0], postType[2]],
};

const videoPathRegex = /\.(mp4|mov|m4v)(?:$|[?#])/i;

const normalizeCollaboratorHandle = (value: unknown) =>
  String(value || '')
    .trim()
    .replace(/^@+/, '')
    .trim();

const isVideoMedia = (media: any) => {
  if (media?.type === 'video') {
    return true;
  }

  return videoPathRegex.test(String(media?.path || '').toLowerCase());
};

const graduationStrategies = [
  {
    value: 'MANUAL',
    label: 'Manual',
  },
  {
    value: 'SS_PERFORMANCE',
    label: 'Auto (based on performance)',
  },
];
const InstagramCollaborators: FC<{
  values?: any;
}> = (props) => {
  const t = useT();
  const { value, integration } = useIntegration();
  const { watch, register, formState, setValue, getValues } = useSettings();
  const savedPostType = useLaunchStore(
    (state) =>
      state.selectedIntegrations.find(
        (item) => item.integration.id === integration?.id
      )?.settings?.post_type
  );
  const firstPostMedia = value?.[0]?.image || [];
  const isStandaloneVideo =
    firstPostMedia.length === 1 && isVideoMedia(firstPostMedia[0]);
  const availablePostTypes = isStandaloneVideo
    ? postTypesByMedia.standaloneVideo
    : postTypesByMedia.default;
  const postCurrentType = watch('post_type');
  const postTypeExplicit = watch('post_type_explicit');
  const isPostTypeExplicit =
    postTypeExplicit === true || postTypeExplicit === 'true';
  const isTrialReel = watch('is_trial_reel');

  useEffect(() => {
    const userSelectedPostType =
      !!savedPostType ||
      isPostTypeExplicit ||
      !!formState.dirtyFields.post_type;

    if (userSelectedPostType) {
      return;
    }

    const nextPostType = isStandaloneVideo ? 'reel' : 'post';

    if (getValues('post_type') !== nextPostType) {
      setValue('post_type', nextPostType, {
        shouldDirty: false,
        shouldTouch: false,
        shouldValidate: true,
      });
    }

    setValue('post_type_explicit', false, {
      shouldDirty: false,
      shouldTouch: false,
      shouldValidate: false,
    });
  }, [
    firstPostMedia.length,
    formState.dirtyFields.post_type,
    getValues,
    isPostTypeExplicit,
    isStandaloneVideo,
    savedPostType,
    setValue,
  ]);

  const postTypeRegister = register('post_type', {
    onChange: () => {
      setValue('post_type_explicit', true, {
        shouldDirty: true,
        shouldTouch: true,
        shouldValidate: false,
      });
    },
  });

  return (
    <>
      <Select
        label="Post Type"
        {...postTypeRegister}
      >
        <option value="">{t('select_post_type', 'Select Post Type...')}</option>
        {availablePostTypes.map((item) => (
          <option key={item.value} value={item.value}>
            {item.label}
          </option>
        ))}
      </Select>
      <input
        type="hidden"
        {...register('post_type_explicit', {
          setValueAs: (value) => value === true || value === 'true',
        })}
      />

      {postCurrentType !== 'story' && (
        <InstagramCollaboratorsTags
          label="Collaborators (max 3) - accounts can't be private"
          {...register('collaborators', {
            value: [],
          })}
        />
      )}

      {postCurrentType === 'reel' && (
        <div className="mt-[18px] flex flex-col gap-[18px]">
          <Checkbox
            {...register('is_trial_reel', {
              value: false,
            })}
            label={t('trial_reel', 'Trial Reel (share only to non-followers first)')}
          />

          {isTrialReel && (
            <Select
              label="Graduation Strategy"
              {...register('graduation_strategy', {
                value: 'MANUAL',
              })}
            >
              {graduationStrategies.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </Select>
          )}
        </div>
      )}
    </>
  );
};
export default withProvider<InstagramDto>({
  postComment: PostComment.COMMENT,
  minimumCharacters: [],
  SettingsComponent: InstagramCollaborators,
  CustomPreviewComponent: InstagramPreview,
  dto: InstagramDto,
  checkValidity: async ([firstPost, ...otherPosts] = [], settings) => {
    if (!firstPost?.length) {
      return 'Should have at least one media';
    }
    const collaboratorHandles =
      settings?.post_type === 'story'
        ? []
        : (settings?.collaborators || []).map((collaborator) =>
            normalizeCollaboratorHandle(collaborator?.label)
          );

    if (collaboratorHandles.some((handle) => !handle)) {
      return 'Enter a valid Instagram collaborator handle.';
    }
    if (collaboratorHandles.length > 3) {
      return 'Instagram supports up to 3 collaborators.';
    }
    if (
      new Set(collaboratorHandles.map((handle) => handle.toLowerCase())).size !==
      collaboratorHandles.length
    ) {
      return 'Instagram collaborators must be unique.';
    }

    const videoMedia = firstPost.filter(isVideoMedia);
    if (
      settings?.post_type === 'reel' &&
      (firstPost.length !== 1 || videoMedia.length !== 1)
    ) {
      return 'Instagram Reels require exactly one video.';
    }
    if (settings?.is_trial_reel && settings?.post_type !== 'reel') {
      return 'Choose Reel to publish a Trial Reel.';
    }
    if (settings?.is_trial_reel) {
      if ((firstPost?.length ?? 0) > 1) {
        return 'Trial Reels can only have one video';
      }
      if (!videoMedia.length) {
        return 'Trial Reels must be a video';
      }
    }
    const checkVideosLength = await Promise.all(
      firstPost
        ?.filter(isVideoMedia)
        ?.flatMap((p) => p?.path)
        ?.map((p) => {
          return new Promise<number>((res) => {
            const video = document.createElement('video');
            video.preload = 'metadata';
            video.src = p;
            video.addEventListener('loadedmetadata', () => {
              res(video.duration);
            });
          });
        }) ?? []
    );
    for (const video of checkVideosLength) {
      if (video > 60 && settings?.post_type === 'story') {
        return 'Stories should be maximum 60 seconds';
      }
      if (video > 180 && settings?.post_type !== 'story') {
        return 'Videos should be maximum 180 seconds';
      }
    }
    return true;
  },
  maximumCharacters: 2200,
  comments: 'no-media'
});
