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

const VIDEO_SAMPLE_ENTRY_TYPES = new Set([
  'avc1',
  'avc2',
  'avc3',
  'avc4',
  'hvc1',
  'hev1',
  'vp08',
  'vp09',
  'av01',
  'mp4v',
  'encv',
  'dvav',
  'dva1',
  'dvhe',
  'dvh1',
  'jpeg',
  'mjpa',
  'mjpb',
  'raw ',
  'yuv2',
  'rle ',
  'rpza',
  'SVQ1',
  'SVQ3',
  'ap4h',
  'ap4x',
  'apch',
  'apcn',
  'apco',
  'apcs',
]);

const REQUIRED_CODEC_CONFIG_BOX = new Map<string, string>([
  ['avc1', 'avcC'],
  ['avc2', 'avcC'],
  ['avc3', 'avcC'],
  ['avc4', 'avcC'],
  ['hvc1', 'hvcC'],
  ['hev1', 'hvcC'],
  ['vp08', 'vpcC'],
  ['vp09', 'vpcC'],
  ['av01', 'av1C'],
  ['mp4v', 'esds'],
  ['encv', 'sinf'],
  ['dvav', 'avcC'],
  ['dva1', 'avcC'],
  ['dvhe', 'hvcC'],
  ['dvh1', 'hvcC'],
]);

const MAX_FTYP_PAYLOAD_BYTES = 256;
const MIN_VISUAL_SAMPLE_ENTRY_SIZE = 86;
const VIDEO_DECODE_TIMEOUT_MS = 8_000;

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

type ByteRange = {
  start: number;
  end: number;
};

type SampleLocation = {
  offset: number;
  size: number;
};

type SampleTableEvidence = {
  hasVideoSampleEntry: boolean;
  classicSample?: SampleLocation;
};

type MediaBoxEvidence = SampleTableEvidence & {
  hasVideoHandler: boolean;
};

type VideoTrackEvidence = MediaBoxEvidence & {
  trackId?: number;
};

type FragmentSampleEvidence = {
  trackId: number;
  sample: SampleLocation;
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
  if (!brands.length) {
    return false;
  }

  if (expectedType === 'video/quicktime') {
    return brands.some((brand) => MOV_VIDEO_BRANDS.has(brand));
  }

  return (
    !brands.some((brand) => MOV_VIDEO_BRANDS.has(brand)) &&
    !brands.some((brand) => NON_VIDEO_BMFF_BRANDS.has(brand))
  );
};

const readFullBoxEntryCount = async (blob: Blob, box: BmffBox) => {
  const bytes = await readBlobRange(blob, box.payloadStart, 8);

  if (bytes.length < 8) {
    return 0;
  }

  return new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength
  ).getUint32(4);
};

const sampleEntryHasRequiredCodecConfig = async (
  blob: Blob,
  entryStart: number,
  entryEnd: number,
  entryType: string
) => {
  const requiredBox = REQUIRED_CODEC_CONFIG_BOX.get(entryType);

  if (!requiredBox) {
    return true;
  }

  let offset = entryStart + MIN_VISUAL_SAMPLE_ENTRY_SIZE;

  while (offset < entryEnd) {
    const box = await readBoxHeader(blob, offset, entryEnd);

    if (!box) {
      return false;
    }

    if (box.type === requiredBox && box.end > box.payloadStart) {
      return true;
    }

    offset = box.end;
  }

  return false;
};

const stsdHasVideoSampleEntry = async (blob: Blob, box: BmffBox) => {
  const entryCount = await readFullBoxEntryCount(blob, box);
  let offset = box.payloadStart + 8;

  for (let index = 0; index < entryCount; index += 1) {
    const bytes = await readBlobRange(blob, offset, 36);

    if (bytes.length < 36) {
      return false;
    }

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const entrySize = view.getUint32(0);
    const entryType = readAscii(bytes, 4, 4);
    const width = view.getUint16(32);
    const height = view.getUint16(34);
    const entryEnd = offset + entrySize;

    if (
      entrySize < MIN_VISUAL_SAMPLE_ENTRY_SIZE ||
      entryEnd > box.end
    ) {
      return false;
    }

    if (
      VIDEO_SAMPLE_ENTRY_TYPES.has(entryType) &&
      width > 0 &&
      height > 0 &&
      (await sampleEntryHasRequiredCodecConfig(
        blob,
        offset,
        entryEnd,
        entryType
      ))
    ) {
      return true;
    }

    offset = entryEnd;
  }

  return false;
};

const readSampleSize = async (blob: Blob, box: BmffBox) => {
  const bytes = await readBlobRange(blob, box.payloadStart, 16);

  if (bytes.length < 12) {
    return { sampleCount: 0, firstSampleSize: 0 };
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const fixedSampleSize = view.getUint32(4);
  const sampleCount = view.getUint32(8);

  if (!sampleCount) {
    return { sampleCount: 0, firstSampleSize: 0 };
  }

  if (fixedSampleSize) {
    return { sampleCount, firstSampleSize: fixedSampleSize };
  }

  return {
    sampleCount,
    firstSampleSize: bytes.length >= 16 ? view.getUint32(12) : 0,
  };
};

const readCompactSampleSize = async (blob: Blob, box: BmffBox) => {
  const bytes = await readBlobRange(blob, box.payloadStart, 14);

  if (bytes.length < 13) {
    return { sampleCount: 0, firstSampleSize: 0 };
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const fieldSize = bytes[7];
  const sampleCount = view.getUint32(8);

  if (!sampleCount) {
    return { sampleCount: 0, firstSampleSize: 0 };
  }

  if (fieldSize === 4) {
    return { sampleCount, firstSampleSize: bytes[12] >> 4 };
  }

  if (fieldSize === 8) {
    return { sampleCount, firstSampleSize: bytes[12] };
  }

  if (fieldSize === 16 && bytes.length >= 14) {
    return { sampleCount, firstSampleSize: view.getUint16(12) };
  }

  return { sampleCount: 0, firstSampleSize: 0 };
};

const readFirstChunkOffset = async (blob: Blob, box: BmffBox) => {
  const bytes = await readBlobRange(
    blob,
    box.payloadStart,
    box.type === 'co64' ? 16 : 12
  );

  if (bytes.length < 12) {
    return undefined;
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entryCount = view.getUint32(4);

  if (!entryCount) {
    return undefined;
  }

  return box.type === 'co64' && bytes.length >= 16
    ? readUint64(view, 8)
    : view.getUint32(8);
};

const hasValidSampleToChunk = async (blob: Blob, box: BmffBox) => {
  const bytes = await readBlobRange(blob, box.payloadStart, 20);

  if (bytes.length < 20) {
    return false;
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  return (
    view.getUint32(4) > 0 &&
    view.getUint32(8) === 1 &&
    view.getUint32(12) > 0 &&
    view.getUint32(16) > 0
  );
};

const hasValidTiming = async (blob: Blob, box: BmffBox) => {
  const bytes = await readBlobRange(blob, box.payloadStart, 16);

  if (bytes.length < 16) {
    return false;
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  return (
    view.getUint32(4) > 0 &&
    view.getUint32(8) > 0 &&
    view.getUint32(12) > 0
  );
};

const sampleTableEvidence = async (
  blob: Blob,
  start: number,
  end: number
): Promise<SampleTableEvidence> => {
  let offset = start;
  let hasVideoSampleEntry = false;
  let sampleCount = 0;
  let firstSampleSize = 0;
  let firstChunkOffset: number | undefined;
  let hasSampleToChunk = false;
  let hasTiming = false;

  while (offset < end) {
    const box = await readBoxHeader(blob, offset, end);

    if (!box) {
      return { hasVideoSampleEntry: false };
    }

    if (box.type === 'stsd') {
      hasVideoSampleEntry = await stsdHasVideoSampleEntry(blob, box);
    } else if (box.type === 'stsz') {
      const sampleSize = await readSampleSize(blob, box);
      sampleCount = sampleSize.sampleCount;
      firstSampleSize = sampleSize.firstSampleSize;
    } else if (box.type === 'stz2') {
      const sampleSize = await readCompactSampleSize(blob, box);
      sampleCount = sampleSize.sampleCount;
      firstSampleSize = sampleSize.firstSampleSize;
    } else if (box.type === 'stco' || box.type === 'co64') {
      firstChunkOffset = await readFirstChunkOffset(blob, box);
    } else if (box.type === 'stsc') {
      hasSampleToChunk = await hasValidSampleToChunk(blob, box);
    } else if (box.type === 'stts') {
      hasTiming = await hasValidTiming(blob, box);
    }

    offset = box.end;
  }

  const classicSample =
    sampleCount > 0 &&
    firstSampleSize > 0 &&
    firstChunkOffset !== undefined &&
    hasSampleToChunk &&
    hasTiming
      ? { offset: firstChunkOffset, size: firstSampleSize }
      : undefined;

  return { hasVideoSampleEntry, classicSample };
};

const mediaInformationEvidence = async (
  blob: Blob,
  start: number,
  end: number
): Promise<SampleTableEvidence> => {
  let offset = start;
  let hasVideoSampleEntry = false;
  let classicSample: SampleLocation | undefined;

  while (offset < end) {
    const box = await readBoxHeader(blob, offset, end);

    if (!box) {
      return { hasVideoSampleEntry: false };
    }

    if (box.type === 'stbl') {
      const evidence = await sampleTableEvidence(
        blob,
        box.payloadStart,
        box.end
      );
      hasVideoSampleEntry = evidence.hasVideoSampleEntry;
      classicSample = evidence.classicSample;
    }

    offset = box.end;
  }

  return { hasVideoSampleEntry, classicSample };
};

const mediaBoxEvidence = async (
  blob: Blob,
  start: number,
  end: number
): Promise<MediaBoxEvidence> => {
  let offset = start;
  let hasVideoHandler = false;
  let hasVideoSampleEntry = false;
  let classicSample: SampleLocation | undefined;

  while (offset < end) {
    const box = await readBoxHeader(blob, offset, end);

    if (!box) {
      return {
        hasVideoHandler: false,
        hasVideoSampleEntry: false,
      };
    }

    if (box.type === 'hdlr') {
      const handlerBytes = await readBlobRange(blob, box.payloadStart, 12);
      hasVideoHandler =
        handlerBytes.length >= 12 && readAscii(handlerBytes, 8, 4) === 'vide';
    } else if (box.type === 'minf') {
      const evidence = await mediaInformationEvidence(
        blob,
        box.payloadStart,
        box.end
      );
      hasVideoSampleEntry = evidence.hasVideoSampleEntry;
      classicSample = evidence.classicSample;
    }

    offset = box.end;
  }

  return { hasVideoHandler, hasVideoSampleEntry, classicSample };
};

const readTrackId = async (blob: Blob, box: BmffBox) => {
  const bytes = await readBlobRange(blob, box.payloadStart, 24);

  if (bytes.length < 16) {
    return undefined;
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = bytes[0];
  const trackIdOffset = version === 1 ? 20 : 12;

  return bytes.length >= trackIdOffset + 4
    ? view.getUint32(trackIdOffset)
    : undefined;
};

const trackBoxEvidence = async (
  blob: Blob,
  start: number,
  end: number
): Promise<VideoTrackEvidence> => {
  let offset = start;
  let trackId: number | undefined;
  let hasVideoHandler = false;
  let hasVideoSampleEntry = false;
  let classicSample: SampleLocation | undefined;

  while (offset < end) {
    const box = await readBoxHeader(blob, offset, end);

    if (!box) {
      return { hasVideoHandler: false, hasVideoSampleEntry: false };
    }

    if (box.type === 'tkhd') {
      trackId = await readTrackId(blob, box);
    } else if (box.type === 'mdia') {
      const evidence = await mediaBoxEvidence(
        blob,
        box.payloadStart,
        box.end
      );
      hasVideoHandler = evidence.hasVideoHandler;
      hasVideoSampleEntry = evidence.hasVideoSampleEntry;
      classicSample = evidence.classicSample;
    }

    offset = box.end;
  }

  return {
    trackId,
    hasVideoHandler,
    hasVideoSampleEntry,
    classicSample,
  };
};

const moovBoxVideoTracks = async (
  blob: Blob,
  start: number,
  end: number
) => {
  const tracks: VideoTrackEvidence[] = [];
  let offset = start;

  while (offset < end) {
    const box = await readBoxHeader(blob, offset, end);

    if (!box) {
      return [];
    }

    if (box.type === 'trak') {
      const evidence = await trackBoxEvidence(
        blob,
        box.payloadStart,
        box.end
      );

      if (evidence.hasVideoHandler) {
        tracks.push(evidence);
      }
    }

    offset = box.end;
  }

  return tracks;
};

const parseFullBoxFlags = (bytes: Uint8Array) =>
  bytes.length >= 4 ? (bytes[1] << 16) | (bytes[2] << 8) | bytes[3] : 0;

const readTfhd = async (blob: Blob, box: BmffBox, moofStart: number) => {
  const bytes = await readBlobRange(blob, box.payloadStart, 40);

  if (bytes.length < 8) {
    return undefined;
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const flags = parseFullBoxFlags(bytes);
  const trackId = view.getUint32(4);
  let cursor = 8;
  let baseDataOffset = moofStart;
  let defaultSampleSize = 0;

  if (flags & 0x000001) {
    if (bytes.length < cursor + 8) {
      return undefined;
    }

    const explicitBaseOffset = readUint64(view, cursor);

    if (explicitBaseOffset === undefined) {
      return undefined;
    }

    baseDataOffset = explicitBaseOffset;
    cursor += 8;
  }

  if (flags & 0x000002) {
    cursor += 4;
  }

  if (flags & 0x000008) {
    cursor += 4;
  }

  if (flags & 0x000010) {
    if (bytes.length < cursor + 4) {
      return undefined;
    }

    defaultSampleSize = view.getUint32(cursor);
    cursor += 4;
  }

  if (flags & 0x000020) {
    cursor += 4;
  }

  if (cursor > bytes.length) {
    return undefined;
  }

  return { trackId, baseDataOffset, defaultSampleSize };
};

const readTrun = async (
  blob: Blob,
  box: BmffBox,
  baseDataOffset: number,
  defaultSampleSize: number
) => {
  const bytes = await readBlobRange(blob, box.payloadStart, 40);

  if (bytes.length < 8) {
    return undefined;
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const flags = parseFullBoxFlags(bytes);
  const sampleCount = view.getUint32(4);
  let cursor = 8;
  let dataOffset: number | undefined;

  if (!sampleCount) {
    return undefined;
  }

  if (flags & 0x000001) {
    if (bytes.length < cursor + 4) {
      return undefined;
    }

    dataOffset = view.getInt32(cursor);
    cursor += 4;
  }

  if (flags & 0x000004) {
    cursor += 4;
  }

  if (flags & 0x000100) {
    cursor += 4;
  }

  let firstSampleSize = defaultSampleSize;

  if (flags & 0x000200) {
    if (bytes.length < cursor + 4) {
      return undefined;
    }

    firstSampleSize = view.getUint32(cursor);
  }

  if (dataOffset === undefined || firstSampleSize <= 0) {
    return undefined;
  }

  return {
    offset: baseDataOffset + dataOffset,
    size: firstSampleSize,
  };
};

const trafSampleEvidence = async (
  blob: Blob,
  start: number,
  end: number,
  moofStart: number
): Promise<FragmentSampleEvidence | undefined> => {
  let offset = start;
  let tfhd:
    | { trackId: number; baseDataOffset: number; defaultSampleSize: number }
    | undefined;
  let trunBox: BmffBox | undefined;

  while (offset < end) {
    const box = await readBoxHeader(blob, offset, end);

    if (!box) {
      return undefined;
    }

    if (box.type === 'tfhd') {
      tfhd = await readTfhd(blob, box, moofStart);
    } else if (box.type === 'trun' && !trunBox) {
      trunBox = box;
    }

    offset = box.end;
  }

  if (!tfhd || !trunBox) {
    return undefined;
  }

  const sample = await readTrun(
    blob,
    trunBox,
    tfhd.baseDataOffset,
    tfhd.defaultSampleSize
  );

  return sample ? { trackId: tfhd.trackId, sample } : undefined;
};

const moofSampleEvidence = async (
  blob: Blob,
  box: BmffBox
): Promise<FragmentSampleEvidence[]> => {
  const samples: FragmentSampleEvidence[] = [];
  let offset = box.payloadStart;

  while (offset < box.end) {
    const child = await readBoxHeader(blob, offset, box.end);

    if (!child) {
      return [];
    }

    if (child.type === 'traf') {
      const evidence = await trafSampleEvidence(
        blob,
        child.payloadStart,
        child.end,
        box.start
      );

      if (evidence) {
        samples.push(evidence);
      }
    }

    offset = child.end;
  }

  return samples;
};

const sampleFallsInsideMediaData = (
  sample: SampleLocation,
  mediaDataRanges: ByteRange[]
) =>
  sample.offset >= 0 &&
  sample.size > 0 &&
  mediaDataRanges.some(
    (range) =>
      sample.offset >= range.start &&
      sample.offset + sample.size <= range.end
  );

export const hasSupportedMp4MovSignature = async (
  blob: Blob,
  expectedType: string
) => {
  let offset = 0;
  let brands: string[] = [];
  const videoTracks: VideoTrackEvidence[] = [];
  const fragmentSamples: FragmentSampleEvidence[] = [];
  const mediaDataRanges: ByteRange[] = [];

  while (offset < blob.size) {
    const box = await readBoxHeader(blob, offset, blob.size);

    if (!box) {
      return false;
    }

    if (box.type === 'ftyp') {
      brands = await readFtypBrands(blob, box);
    } else if (box.type === 'moov') {
      videoTracks.push(
        ...(await moovBoxVideoTracks(blob, box.payloadStart, box.end))
      );
    } else if (box.type === 'moof') {
      fragmentSamples.push(...(await moofSampleEvidence(blob, box)));
    } else if (box.type === 'mdat' && box.end > box.payloadStart) {
      mediaDataRanges.push({ start: box.payloadStart, end: box.end });
    }

    offset = box.end;
  }

  if (!hasExpectedBrand(brands, expectedType) || !mediaDataRanges.length) {
    return false;
  }

  return videoTracks.some((track) => {
    if (!track.hasVideoSampleEntry) {
      return false;
    }

    if (
      track.classicSample &&
      sampleFallsInsideMediaData(track.classicSample, mediaDataRanges)
    ) {
      return true;
    }

    if (track.trackId === undefined) {
      return false;
    }

    return fragmentSamples.some(
      (fragment) =>
        fragment.trackId === track.trackId &&
        sampleFallsInsideMediaData(fragment.sample, mediaDataRanges)
    );
  });
};

export const canBrowserDecodeVideo = async (
  blob: Blob,
  expectedType: string
) => {
  if (
    typeof document === 'undefined' ||
    typeof URL === 'undefined' ||
    typeof URL.createObjectURL !== 'function'
  ) {
    return true;
  }

  const typedBlob =
    blob.type === expectedType ? blob : new Blob([blob], { type: expectedType });
  const objectUrl = URL.createObjectURL(typedBlob);
  const video = document.createElement('video');

  return new Promise<boolean>((resolve) => {
    let settled = false;

    const finish = (result: boolean) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      video.onloadeddata = null;
      video.onerror = null;
      URL.revokeObjectURL(objectUrl);
      resolve(result);
    };

    const timeout = setTimeout(() => finish(false), VIDEO_DECODE_TIMEOUT_MS);

    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;
    video.onloadeddata = () =>
      finish(video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0);
    video.onerror = () => finish(false);
    video.src = objectUrl;
    video.load();
  });
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

  if (!(await hasSupportedMp4MovSignature(blob, expectedType))) {
    return 'application/octet-stream';
  }

  return (await canBrowserDecodeVideo(blob, expectedType))
    ? expectedType
    : 'application/octet-stream';
};
