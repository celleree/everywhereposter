const GENERIC_UPLOAD_MIME_TYPES = new Set([
  '',
  'application/octet-stream',
  'binary/octet-stream',
]);

const MP4_VIDEO_BRANDS = new Set([
  'isom',
  'iso2',
  'iso3',
  'iso4',
  'iso5',
  'iso6',
  'iso7',
  'iso8',
  'iso9',
  'mp41',
  'mp42',
  'avc1',
  'dash',
  'M4V ',
  'M4VH',
  'MSNV',
  '3gp4',
  '3gp5',
  '3gp6',
  '3ge6',
  '3gg6',
  '3g2a',
  '3g2b',
]);

const MOV_VIDEO_BRANDS = new Set(['qt  ']);

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

const getExpectedVideoType = (name?: string | null) => {
  const normalizedName = (name || '').toLowerCase().split(/[?#]/)[0];

  if (normalizedName.endsWith('.mp4')) {
    return 'video/mp4';
  }

  if (normalizedName.endsWith('.mov')) {
    return 'video/quicktime';
  }

  return '';
};

const readAscii = (bytes: Uint8Array, start: number, length: number) =>
  String.fromCharCode(...bytes.slice(start, start + length));

export const hasSupportedMp4MovSignature = async (
  blob: Blob,
  expectedType: string
) => {
  const bytes = new Uint8Array(await blob.slice(0, 128).arrayBuffer());
  let ftypOffset = -1;

  for (let index = 4; index <= bytes.length - 4; index += 1) {
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

  const allowedBrands =
    expectedType === 'video/quicktime' ? MOV_VIDEO_BRANDS : MP4_VIDEO_BRANDS;

  return brands.some((brand) => allowedBrands.has(brand));
};

export const inferUploadFileType = (file: UploadFileLike) =>
  (file.type || '').toLowerCase();

export const resolveUploadFileType = async (
  file: UploadFileLike | (Blob & { name?: string | null; type?: string | null })
) => {
  const currentType = inferUploadFileType(file);

  if (!GENERIC_UPLOAD_MIME_TYPES.has(currentType)) {
    return currentType;
  }

  const expectedType = getExpectedVideoType(file.name);

  if (!expectedType) {
    return currentType;
  }

  const blob = getUploadBlob(file);

  if (!blob || !(await hasSupportedMp4MovSignature(blob, expectedType))) {
    return currentType;
  }

  return expectedType;
};
