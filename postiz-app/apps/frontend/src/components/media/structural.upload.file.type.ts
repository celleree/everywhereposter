import {
  hasSupportedMp4MovSignature,
  inferUploadFileType,
  resolveUploadFileType,
} from '@gitroom/frontend/components/media/upload.file.type';

const GENERIC_UPLOAD_MIME_TYPES = new Set([
  '',
  'application/octet-stream',
  'binary/octet-stream',
]);

const SUPPORTED_VIDEO_MIME_TYPES = new Set([
  'video/mp4',
  'video/quicktime',
  'video/mov',
]);

type UploadFileLike = {
  name?: string | null;
  type?: string | null;
  data?: unknown;
};

const getExpectedVideoType = (file: UploadFileLike) => {
  const currentType = inferUploadFileType(file);

  if (SUPPORTED_VIDEO_MIME_TYPES.has(currentType)) {
    return currentType === 'video/mov' ? 'video/quicktime' : currentType;
  }

  if (!GENERIC_UPLOAD_MIME_TYPES.has(currentType)) {
    return '';
  }

  const normalizedName = (file.name || '').toLowerCase().split(/[?#]/)[0];

  if (normalizedName.endsWith('.mp4')) {
    return 'video/mp4';
  }

  if (normalizedName.endsWith('.mov')) {
    return 'video/quicktime';
  }

  return '';
};

const getUploadBlob = (file: UploadFileLike | Blob) => {
  if (typeof Blob === 'undefined') {
    return undefined;
  }

  if (file instanceof Blob) {
    return file;
  }

  return file.data instanceof Blob ? file.data : undefined;
};

export const resolveStructurallyValidatedUploadFileType = async (
  file: UploadFileLike | (Blob & { name?: string | null; type?: string | null })
) => {
  const currentType = inferUploadFileType(file);
  const expectedType = getExpectedVideoType(file);

  if (!expectedType) {
    return resolveUploadFileType(file);
  }

  const blob = getUploadBlob(file);

  if (!blob) {
    return GENERIC_UPLOAD_MIME_TYPES.has(currentType)
      ? currentType
      : expectedType;
  }

  return (await hasSupportedMp4MovSignature(blob, expectedType))
    ? expectedType
    : 'application/octet-stream';
};
