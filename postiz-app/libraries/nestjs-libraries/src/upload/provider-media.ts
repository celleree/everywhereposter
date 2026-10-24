import sharp from 'sharp';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { fromBuffer } = require('file-type');

export class ProviderImageError extends Error {}
export type ImageTarget = 'x' | 'linkedin' | 'instagram' | 'tiktok';
const imageMime: Record<string, string> = {
  jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
};

// Inspect bytes, not URL suffixes (signed URLs and MOV uploads are common).
export async function prepareProviderMedia(buffer: Buffer, target: 'x' | 'linkedin') {
  const detected = await fromBuffer(buffer);
  if (['video/mp4', 'video/quicktime'].includes(detected?.mime)) {
    return { buffer, mimeType: detected.mime as string };
  }
  return prepareProviderImage(buffer, target);
}

export async function prepareProviderImage(buffer: Buffer, target: ImageTarget) {
  try {
    const metadata = await sharp(buffer, { animated: true, failOn: 'error' }).metadata();
    const width = metadata.width || 0, height = metadata.pageHeight || metadata.height || 0;
    const frames = metadata.pages || 1;
    if (!width || !height) throw new ProviderImageError('Image dimensions are unavailable.');
    if (target === 'linkedin' && (width * height >= 36_152_320 || frames > 250)) {
      throw new ProviderImageError('LinkedIn images must have fewer than 36,152,320 pixels and GIFs at most 250 frames.');
    }
    if (target === 'tiktok' && !((width <= 1920 && height <= 1080) || (width <= 1080 && height <= 1920))) {
      throw new ProviderImageError('TikTok images must fit 1080p. Choose a separate resized copy; the original will not be resized automatically.');
    }
    const format = metadata.format || '';
    const supported = target === 'x' ? ['jpeg', 'png', 'gif', 'webp'] :
      target === 'linkedin' ? ['jpeg', 'png', 'gif'] :
      target === 'tiktok' ? ['jpeg', 'webp'] : ['jpeg'];
    if (frames > 1 && !(format === 'gif' && ['x', 'linkedin'].includes(target))) {
      throw new ProviderImageError('This destination cannot preserve this animated or multipage image. Choose a separate compatible copy.');
    }
    // Keep Instagram's existing normalized-JPEG preflight contract. Density is
    // deliberately irrelevant: changing DPI does not improve pixel resolution.
    const normalized = target !== 'instagram' || (metadata.space === 'srgb' &&
      metadata.channels === 3 && !metadata.hasAlpha && !metadata.isProgressive &&
      metadata.hasProfile && (!metadata.orientation || metadata.orientation === 1));
    const original = supported.includes(format) && normalized;
    const output = original ? buffer : await sharp(buffer, { failOn: 'error' })
      .rotate().flatten({ background: '#ffffff' }).toColorspace('srgb')
      .withMetadata({ density: 72 }).jpeg({ quality: 90, progressive: false, mozjpeg: false }).toBuffer();
    const mimeType = original ? imageMime[format] : 'image/jpeg';
    const maxBytes = target === 'x' ? (mimeType === 'image/gif' ? 15_000_000 : 5_000_000) :
      target === 'instagram' ? 8_000_000 : target === 'tiktok' ? 20_000_000 : Infinity;
    if (output.length > maxBytes) {
      throw new ProviderImageError(`Image exceeds ${target}'s ${maxBytes} byte limit. Choose a separate smaller copy; the original will not be compressed automatically.`);
    }
    // A conversion is a distinct buffer; callers must never overwrite the source.
    return { buffer: output, mimeType };
  } catch (error) {
    if (error instanceof ProviderImageError) throw error;
    throw new ProviderImageError('Image is corrupt or unsupported for this destination.');
  }
}
