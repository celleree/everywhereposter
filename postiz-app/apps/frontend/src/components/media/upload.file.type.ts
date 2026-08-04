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
const NON_VIDEO_BMFF_BRANDS = new Set([
  'M4A ',
  'M4B ',
  'M4P ',
  'avif',
  'avis',
  'heic',
  'heix',
  'hevc',
  'hevx',
  'heim',
  'heis',
  'mif1',
  'msf1',
]);

const MAX_FTYP_PAYLOAD_BYTES = 256;

type UploadFileLike = {
  name?: string | null;
  type?: string | null;
  data?: unknown;
};

type BmffBox = {
  type: string;
  start: number;
  payloadStart: number;
  end: number;
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

const readAscii = (bytes: Uint8Array, start: number, length: number) =>
  String.fromCharCode(...bytes.slice(start, start + length));

const readBlobRange = async (blob: Blob, start: number, length: number) => {
  const slice = blob.slice(start, Math.min(blob.size, start + length)) as Blob & {
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

const readUint64 = (view: DataView, offset: number) => {
  const high = view.getUint32(offset);
  const low = view.getUint32(offset + 4);
  const value = high * 2 ** 32 + low;

  return Number.isSafeInteger(value) ? value : undefined;
};

const readBoxHeader = async (
  blob: Blob,
  start: number,
  parentEnd: number
): Promise<BmffBox | undefined> => {
  if (parentEnd - start < 8) {
    return undefined;
  }

  const bytes = await readBlobRange(
    blob,
    start,
    Math.min(16, parentEnd - start)
  );

  if (bytes.length < 8) {
    return undefined;
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const size32 = view.getUint32(0);
  const type = readAscii(bytes, 4, 4);
  let headerSize = 8;
  let size = size32;

  if (size32 === 1) {
    if (bytes.length < 16) {
      return undefined;
    }

    const extendedSize = readUint64(view, 8);

    if (!extendedSize) {
      return undefined;
    }

    size = extendedSize;
    headerSize = 16;
  } else if (size32 === 0) {
    size = parentEnd - start;
  }

  if (size < headerSize || start + size > parentEnd) {
    return undefined;
  }

  return {
    type,
    start,
    payloadStart: start + headerSize,
    end: start + size,
  };
};

const readFtypBrands = async (blob: Blob, box: BmffBox) => {
  const payloadLength = Math.min(
    box.end - box.payloadStart,
    MAX_FTYP_PAYLOAD_BYTES
  );
  const bytes = await readBlobRange(blob, box.payloadStart, payloadLength);

  if (bytes.length < 8) {
    return [];
  }

  const brands = [readAscii(bytes, 0, 4)];

  for (let index = 8; index <= bytes.length - 4; index += 4) {
    brands.push(readAscii(bytes, index, 4));
  }

  return brands;
};

const hasExpectedBrand = (brands: string[], expectedType: string) => {
  if (expectedType === 'video/quicktime') {
    return brands.some((brand) => MOV_VIDEO_BRANDS.has(brand));
  }

  return (
    !brands.some((brand) => MOV_VIDEO_BRANDS.has(brand)) &&
    !brands.some((brand) => NON_VIDEO_BMFF_BRANDS.has(brand))
  );
};

const mediaBoxHasVideoHandler = async (
  blob: Blob,
  start: number,
  end: number
) => {
  let offset = start;

  while (offset < end) {
    const box = await readBoxHeader(blob, offset, end);

    if (!box) {
      return false;
    }

    if (box.type === 'hdlr') {
      const handlerBytes = await readBlobRange(blob, box.payloadStart, 12);

      return (
        handlerBytes.length >= 12 && readAscii(handlerBytes, 8, 4) === 'vide'
      );
    }

    offset = box.end;
  }

  return false;
};

const trackBoxHasVideoHandler = async (
  blob: Blob,
  start: number,
  end: number
) => {
  let offset = start;

  while (offset < end) {
    const box = await readBoxHeader(blob, offset, end);

    if (!box) {
      return false;
    }

    if (
      box.type === 'mdia' &&
      (await mediaBoxHasVideoHandler(blob, box.payloadStart, box.end))
    ) {
      return true;
    }

    offset = box.end;
  }

  return false;
};

const moovBoxHasVideoTrack = async (
  blob: Blob,
  start: number,
  end: number
) => {
  let offset = start;

  while (offset < end) {
    const box = await readBoxHeader(blob, offset, end);

    if (!box) {
      return false;
    }

    if (
      box.type === 'trak' &&
      (await trackBoxHasVideoHandler(blob, box.payloadStart, box.end))
    ) {
      return true;
    }

    offset = box.end;
  }

  return false;
};

export const hasSupportedMp4MovSignature = async (
  blob: Blob,
  expectedType: string
) => {
  let offset = 0;
  let brands: string[] = [];
  let hasVideoTrack = false;

  while (offset < blob.size) {
    const box = await readBoxHeader(blob, offset, blob.size);

    if (!box) {
      return false;
    }

    if (box.type === 'ftyp') {
      brands = await readFtypBrands(blob, box);
    } else if (box.type === 'moov') {
      hasVideoTrack = await moovBoxHasVideoTrack(
        blob,
        box.payloadStart,
        box.end
      );
    }

    if (brands.length && hasVideoTrack) {
      break;
    }

    offset = box.end;
  }

  return hasExpectedBrand(brands, expectedType) && hasVideoTrack;
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
