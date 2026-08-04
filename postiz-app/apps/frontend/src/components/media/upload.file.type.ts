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

const MOV_VIDEO_BRANDS = new Set(['qt  ']);
const AUDIO_ONLY_BRANDS = new Set(['M4A ', 'M4B ', 'M4P ']);

type UploadFileLike = {
  name?: string | null;
  type?: string | null;
  data?: unknown;
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

const getExpectedVideoType = (file: UploadFileLike) => {
  const currentType = (file.type || '').toLowerCase();
  const normalizedName = (file.name || '').toLowerCase().split(/[?#]/)[0];

  if (normalizedName.endsWith('.mp4')) {
    return 'video/mp4';
  }

  if (normalizedName.endsWith('.mov')) {
    return 'video/quicktime';
  }

  if (SUPPORTED_VIDEO_MIME_TYPES.has(currentType)) {
    return currentType === 'video/mov' ? 'video/quicktime' : currentType;
  }

  return '';
};

const readAscii = (bytes: Uint8Array, start: number, length: number) =>
  String.fromCharCode(...bytes.slice(start, start + length));

const readBlobBytes = async (blob: Blob) => {
  const slice = blob.slice(0, 4096) as Blob & {
    arrayBuffer?: () => Promise<ArrayBuffer>;
  };

  if (typeof slice.arrayBuffer === 'function') {
    return new Uint8Array(await slice.arrayBuffer());
  }

  if (typeof FileReader === 'undefined') {
    throw new Error('This browser cannot inspect the selected upload.');
  }

  return new Promise<Uint8Array>((resolve, reject) => {
    const reader = new FileReader();

    reader.onerror = () => {
      reject(reader.error || new Error('Unable to inspect the selected upload.'));
    };
    reader.onload = () => {
      if (!(reader.result instanceof ArrayBuffer)) {
        reject(new Error('Unable to inspect the selected upload.'));
        return;
      }

      resolve(new Uint8Array(reader.result));
    };
    reader.readAsArrayBuffer(slice);
  });
};

export const hasSupportedMp4MovSignature = async (
  blob: Blob,
  expectedType: string
) => {
  const bytes = await readBlobBytes(blob);
  let ftypOffset = -1;

  for (let index = 4; index <= bytes.length - 8; index += 1) {
    if (readAscii(bytes, index, 4) === 'ftyp') {
      ftypOffset = index;
      break;
    }
  }

  if (ftypOffset < 0 || ftypOffset + 8 > bytes.length) {
    return false;
  }

  const brands = [readAscii(bytes, ftypOffset + 4, 4)];

  for (let index = ftypOffset + 12; index <= bytes.length - 4; index += 4) {
    brands.push(readAscii(bytes, index, 4));
  }

  if (expectedType === 'video/quicktime') {
    return brands.some((brand) => MOV_VIDEO_BRANDS.has(brand));
  }

  return (
    !brands.some((brand) => MOV_VIDEO_BRANDS.has(brand)) &&
    !brands.some((brand) => AUDIO_ONLY_BRANDS.has(brand))
  );
};

export const inferUploadFileType = (file: UploadFileLike) =>
  (file.type || '').toLowerCase();

export const resolveUploadFileType = async (
  file: UploadFileLike | (Blob & { name?: string | null; type?: string | null })
) => {
  const currentType = inferUploadFileType(file);
  const expectedType = getExpectedVideoType(file);

  if (!expectedType) {
    return currentType;
  }

  const blob = getUploadBlob(file);

  if (!blob) {
    return GENERIC_UPLOAD_MIME_TYPES.has(currentType) ? currentType : expectedType;
  }

  return (await hasSupportedMp4MovSignature(blob, expectedType))
    ? expectedType
    : 'application/octet-stream';
};
