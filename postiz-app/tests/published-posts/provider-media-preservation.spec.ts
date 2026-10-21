jest.mock('bcrypt', () => ({ hashSync: jest.fn(), compareSync: jest.fn() }));
jest.mock('@gitroom/helpers/utils/read.or.fetch', () => ({ readOrFetch: jest.fn() }));
import sharp from 'sharp';
import { createHash, randomBytes } from 'crypto';
import { readOrFetch } from '@gitroom/helpers/utils/read.or.fetch';
import { prepareProviderImage, prepareProviderMedia } from '@gitroom/nestjs-libraries/upload/provider-media';
import { XProvider } from '@gitroom/nestjs-libraries/integrations/social/x.provider';
import { LinkedinProvider } from '@gitroom/nestjs-libraries/integrations/social/linkedin.provider';

const hash = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const picture = () => sharp({ create: { width: 2000, height: 1200, channels: 3, background: '#446688' } });
const animatedGif = Buffer.from('47494638396101000100800000000000ffffff21f904000a0000002c000000000100010000020244010021f90400140000002c00000000010001000002024c01003b', 'hex');

describe('original media preservation (all external transfers mocked)', () => {
  afterEach(() => jest.restoreAllMocks());
  it.each(['png', 'jpeg', 'webp'] as const)('sends high-resolution %s to X unchanged with byte-derived MIME', async (format) => {
    const source = await picture().toFormat(format).toBuffer(), before = hash(source);
    (readOrFetch as jest.Mock).mockResolvedValue(source);
    const provider = new XProvider();
    jest.spyOn(provider as any, 'runInConcurrent').mockImplementation((fn: any) => fn());
    const uploadMedia = jest.fn().mockResolvedValue('uploaded');
    await (provider as any).uploadMedia({ v2: { uploadMedia } }, [{ id: 'post', media: [{ path: 'https://fixture.test/misleading.mp4?name=picture.gif' }] }]);
    expect(hash(uploadMedia.mock.calls[0][0])).toBe(before);
    expect(uploadMedia.mock.calls[0][1].media_type).toBe(`image/${format}`);
    expect((await sharp(uploadMedia.mock.calls[0][0]).metadata()).width).toBe(2000);
    expect(hash(source)).toBe(before);
  });
  it.each(['x', 'linkedin'] as const)('preserves GIF frames and delays for %s', async (target) => {
    const result = await prepareProviderImage(animatedGif, target);
    expect(result.buffer).toBe(animatedGif);
    const metadata = await sharp(result.buffer, { animated: true }).metadata();
    expect(metadata.pages).toBe(2);
    expect(metadata.delay).toEqual([100, 200]);
  });
  it('sends a LinkedIn image larger than 2 MiB in one complete PUT', async () => {
    const source = await sharp(randomBytes(1200 * 900 * 3), { raw: { width: 1200, height: 900, channels: 3 } }).png().toBuffer();
    expect(source.length).toBeGreaterThan(2 * 1024 * 1024);
    const before = hash(source);
    (readOrFetch as jest.Mock).mockResolvedValue(source);
    const provider = new LinkedinProvider();
    const requests: any[] = [];
    jest.spyOn(provider as any, 'fetch').mockImplementation(async (url: any, options: any) => {
      requests.push({ url, ...options });
      return options.method === 'POST' ? new Response(JSON.stringify({ value: { uploadUrl: 'https://fixture.test/upload', image: 'image-id' } })) : new Response('', { headers: { etag: 'fixture' } });
    });
    await (provider as any).processMediaForPosts([{ id: 'post', media: [{ path: 'https://fixture.test/photo?format=mp4' }] }], 'fixture-token', 'person', 'personal');
    expect(requests[0].url).toContain('/images?action=initializeUpload');
    const uploads = requests.filter(r => r.method === 'PUT');
    expect(uploads).toHaveLength(1);
    expect(uploads[0].headers['Content-Type']).toBe('image/png');
    expect(uploads[0].body.length).toBe(source.length);
    expect(hash(uploads[0].body)).toBe(before);
    expect(hash(source)).toBe(before);
  });
  it('keeps compliant Instagram JPEGs and TikTok WebP bytes intact', async () => {
    const jpeg = await picture().resize(1080, 1080).withIccProfile('srgb').jpeg({ progressive: false }).toBuffer();
    const webp = await picture().resize(1080, 1080).webp().toBuffer();
    expect((await prepareProviderImage(jpeg, 'instagram')).buffer).toBe(jpeg);
    expect((await prepareProviderImage(webp, 'tiktok')).buffer).toBe(webp);
  });
  it('creates a separate Instagram JPEG only when normalization is required', async () => {
    const png = await picture().png().toBuffer(), before = hash(png);
    const result = await prepareProviderImage(png, 'instagram');
    expect(result.buffer).not.toBe(png);
    expect(result.mimeType).toBe('image/jpeg');
    expect(await sharp(result.buffer).metadata()).toMatchObject({ width: 2000, height: 1200, format: 'jpeg', space: 'srgb', channels: 3, hasProfile: true, isProgressive: false });
    expect(hash(png)).toBe(before);
    expect((await prepareProviderImage(result.buffer, 'instagram')).buffer).toBe(result.buffer);
  });
  it('converts unsupported LinkedIn WebP into a separate full-resolution derivative', async () => {
    const source = await picture().webp().toBuffer(), before = hash(source);
    const result = await prepareProviderImage(source, 'linkedin');
    expect(result.mimeType).toBe('image/jpeg');
    expect(result.buffer).not.toBe(source);
    expect(await sharp(result.buffer).metadata()).toMatchObject({ width: 2000, height: 1200 });
    expect(hash(source)).toBe(before);
  });
  it('rejects size, resolution and animation incompatibility without silently reducing quality', async () => {
    const png = await picture().png().toBuffer();
    await expect(prepareProviderImage(Buffer.concat([png, Buffer.alloc(5_000_001)]), 'x')).rejects.toThrow('byte limit');
    await expect(prepareProviderImage(png, 'tiktok')).rejects.toThrow('1080p');
    await expect(prepareProviderImage(animatedGif, 'instagram')).rejects.toThrow('animated');
    await expect(prepareProviderImage(Buffer.from('not an image'), 'linkedin')).rejects.toThrow('corrupt');
  });
  it('rejects LinkedIn originals beyond its pixel and GIF-frame limits', async () => {
    const tooLarge = await picture().resize(6020, 6010).png().toBuffer();
    await expect(prepareProviderImage(tooLarge, 'linkedin')).rejects.toThrow('36,152,320');
    const frame = animatedGif.subarray(19, 42);
    const tooManyFrames = Buffer.concat([animatedGif.subarray(0, 19), ...Array(251).fill(frame), Buffer.from([0x3b])]);
    await expect(prepareProviderImage(tooManyFrames, 'linkedin')).rejects.toThrow('250 frames');
  });
  it('detects MP4/MOV bytes independently of file names without transcoding', async () => {
    for (const brand of ['isom', 'qt  ']) {
      const source = Buffer.from('0000001466747970' + Buffer.from(brand).toString('hex') + '0000000069736f6d', 'hex');
      const result = await prepareProviderMedia(source, 'x');
      expect(result.buffer).toBe(source);
      expect(result.mimeType).toBe(brand === 'isom' ? 'video/mp4' : 'video/quicktime');
    }
  });
  it('retains intentionally requested LinkedIn PDF carousels', async () => {
    const source = await picture().png().toBuffer(), before = hash(source);
    (readOrFetch as jest.Mock).mockResolvedValue(source);
    const provider = new LinkedinProvider();
    const post = { id: 'post', media: [{ path: 'https://fixture.test/image.png' }, { path: 'https://fixture.test/other.png' }] };
    const result = await (provider as any).convertImagesToPdfCarousel([post], post);
    expect(result[0].media[0].path).toBe('carousel.pdf');
    expect(result[0].media[0].buffer.subarray(0, 4).toString()).toBe('%PDF');
    expect(hash(source)).toBe(before);
  });
});
