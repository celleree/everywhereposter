export type MediaCopyItem = {
  id: string;
  path: string;
  type?: string | null;
  name?: string | null;
  originalName?: string | null;
  mimetype?: string | null;
  mimeType?: string | null;
};

const VIDEO_FILE_EXTENSION_PATTERN =
  /\.(?:mp4|m4v|mpeg|mpg|mpe|mov|qt|webm)(?:$|[?#])/i;

export const isVideoMedia = (media?: Partial<MediaCopyItem>) => {
  if (!media) return false;

  const storedType = media.type?.toLowerCase();
  if (storedType === 'video' || storedType?.startsWith('video/')) {
    return true;
  }

  const mimeType = (media.mimeType || media.mimetype)?.toLowerCase();
  if (mimeType?.startsWith('video/')) {
    return true;
  }

  return [media.path, media.name, media.originalName].some((value) =>
    VIDEO_FILE_EXTENSION_PATTERN.test(value || '')
  );
};
