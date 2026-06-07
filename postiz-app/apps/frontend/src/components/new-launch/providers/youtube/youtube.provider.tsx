'use client';

import { FC } from 'react';
import {
  PostComment,
  withProvider,
} from '@gitroom/frontend/components/new-launch/providers/high.order.provider';
import { YoutubeSettingsDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/youtube.settings.dto';
import { useSettings } from '@gitroom/frontend/components/launches/helpers/use.values';
import { Input } from '@gitroom/react/form/input';
import { MediumTags } from '@gitroom/frontend/components/new-launch/providers/medium/medium.tags';
import { MediaComponent } from '@gitroom/frontend/components/media/media.component';
import { Select } from '@gitroom/react/form/select';
import { YoutubePreview } from '@gitroom/frontend/components/new-launch/providers/youtube/youtube.preview';
const type = [
  {
    label: 'Public',
    value: 'public',
  },
  {
    label: 'Private',
    value: 'private',
  },
  {
    label: 'Unlisted',
    value: 'unlisted',
  },
];

const madeForKids = [
  {
    label: 'No',
    value: 'no',
  },
  {
    label: 'Yes',
    value: 'yes',
  },
];

const yesNo = [
  {
    label: 'Yes',
    value: 'yes',
  },
  {
    label: 'No',
    value: 'no',
  },
];

const optionalYesNo = [
  {
    label: 'Use YouTube default',
    value: '',
  },
  ...yesNo,
];

const isVideoMedia = (media?: { path?: string; type?: string | null }) =>
  media?.type === 'video' || /\.(mp4|mov)(?:$|[?#])/i.test(media?.path || '');

const license = [
  {
    label: 'Use YouTube default',
    value: '',
  },
  {
    label: 'Standard YouTube License',
    value: 'youtube',
  },
  {
    label: 'Creative Commons',
    value: 'creativeCommon',
  },
];

const YoutubeSettings: FC = () => {
  const { register, control } = useSettings();
  return (
    <div className="flex flex-col">
      <div className="text-[14px] font-[600] mb-[10px]">Details</div>
      <Input label="Title" {...register('title')} maxLength={100} />
      <MediumTags label="Tags" {...register('tags')} />
      <div className="mt-[20px]">
        <MediaComponent
          type="image"
          width={1280}
          height={720}
          label="Thumbnail"
          description="Thumbnail picture (optional)"
          {...register('thumbnail')}
        />
      </div>
      <div className="text-[14px] font-[600] mt-[20px] mb-[10px]">
        Visibility
      </div>
      <Select
        label="Visibility"
        {...register('type', {
          value: 'public',
        })}
      >
        {type.map((t) => (
          <option key={t.value} value={t.value}>
            {t.label}
          </option>
        ))}
      </Select>
      <Select
        label="Notify subscribers"
        {...register('notifySubscribers', {
          value: 'yes',
        })}
      >
        {yesNo.map((t) => (
          <option key={t.value} value={t.value}>
            {t.label}
          </option>
        ))}
      </Select>
      <div className="text-[14px] font-[600] mt-[20px] mb-[10px]">
        Audience
      </div>
      <Select
        label="Made for kids"
        {...register('selfDeclaredMadeForKids', {
          value: 'no',
        })}
      >
        {madeForKids.map((t) => (
          <option key={t.value} value={t.value}>
            {t.label}
          </option>
        ))}
      </Select>
      <div className="text-[14px] font-[600] mt-[20px] mb-[10px]">
        License & distribution
      </div>
      <Select label="License" {...register('license')}>
        {license.map((t) => (
          <option key={t.value} value={t.value}>
            {t.label}
          </option>
        ))}
      </Select>
      <Select label="Allow embedding" {...register('embeddable')}>
        {optionalYesNo.map((t) => (
          <option key={t.value} value={t.value}>
            {t.label}
          </option>
        ))}
      </Select>
      <Select label="Show public stats" {...register('publicStatsViewable')}>
        {optionalYesNo.map((t) => (
          <option key={t.value} value={t.value}>
            {t.label}
          </option>
        ))}
      </Select>
      <div className="text-[14px] font-[600] mt-[20px] mb-[10px]">
        Paid promotion
      </div>
      <Select
        label="Paid product placement"
        {...register('hasPaidProductPlacement')}
      >
        {optionalYesNo.map((t) => (
          <option key={t.value} value={t.value}>
            {t.label}
          </option>
        ))}
      </Select>
    </div>
  );
};
export default withProvider({
  postComment: PostComment.COMMENT,
  comments: false,
  minimumCharacters: [],
  SettingsComponent: YoutubeSettings,
  CustomPreviewComponent: YoutubePreview,
  dto: YoutubeSettingsDto,
  checkValidity: async (items) => {
    const [firstItems] = items ?? [];
    if (items?.[0]?.length !== 1) {
      return 'You need one media';
    }
    if (!isVideoMedia(firstItems?.[0])) {
      return 'Item must be a video';
    }
    return true;
  },
  maximumCharacters: 5000,
});
