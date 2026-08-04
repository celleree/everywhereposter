const GENERIC_UPLOAD_MIME_TYPES = new Set([
  '',
  'application/octet-stream',
  'binary/octet-stream',
]);

export const inferUploadFileType = (file: {
  name?: string | null;
  type?: string | null;
}) => {
  const currentType = (file.type || '').toLowerCase();

  if (!GENERIC_UPLOAD_MIME_TYPES.has(currentType)) {
    return currentType;
  }

  const name = (file.name || '').toLowerCase();

  if (name.endsWith('.mp4')) {
    return 'video/mp4';
  }

  if (name.endsWith('.mov')) {
    return 'video/quicktime';
  }

  return currentType;
};
