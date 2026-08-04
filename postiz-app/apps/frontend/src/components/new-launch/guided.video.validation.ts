import { resolveUploadFileType } from '@gitroom/frontend/components/media/upload.file.type';

export const GUIDED_VIDEO_ACCEPT =
  'video/mp4,video/quicktime,video/mov,.mp4,.mov';

const GUIDED_VIDEO_MIME_TYPES = new Set([
  'video/mp4',
  'video/quicktime',
  'video/mov',
]);

export type GuidedVideoMedia = {
  id: string;
  path?: string;
  originalName?: string | null;
  type?: string | null;
};

const hasSupportedVideoExtension = (value?: string | null) =>
  /\.(mp4|mov)(?:$|[?#])/i.test(value || '');

export const isGuidedMp4MovMedia = (media?: GuidedVideoMedia) => {
  if (!media) {
    return false;
  }

  const nameOrPath = media.originalName || media.path || '';
  const mediaType = (media.type || '').toLowerCase();
  const typeIsCompatible =
    !mediaType ||
    mediaType === 'video' ||
    GUIDED_VIDEO_MIME_TYPES.has(mediaType);

  return typeIsCompatible && hasSupportedVideoExtension(nameOrPath);
};

export const isGuidedVideoFile = async (file: File) =>
  GUIDED_VIDEO_MIME_TYPES.has(await resolveUploadFileType(file));

export const normalizeGuidedVideoFile = async (file: File) => {
  const currentType = file.type.toLowerCase();
  const resolvedType = await resolveUploadFileType(file);

  if (
    !GUIDED_VIDEO_MIME_TYPES.has(resolvedType) ||
    resolvedType === currentType
  ) {
    return file;
  }

  return new File([file], file.name, {
    type: resolvedType,
    lastModified: file.lastModified,
  });
};

export const selectGuidedSourceVideo = <T extends GuidedVideoMedia>(
  media: T[],
  previousSourceId?: string
) => {
  const videos = media.filter((item) => isGuidedMp4MovMedia(item));

  if (!videos.length) {
    return undefined;
  }

  if (!previousSourceId) {
    return videos[0];
  }

  return videos.find((item) => item.id !== previousSourceId) || videos[0];
};
