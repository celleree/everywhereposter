jest.mock('@gitroom/helpers/utils/read.or.fetch', () => ({
  readOrFetch: jest.fn(),
}));
jest.mock('axios', () => ({ __esModule: true, default: { get: jest.fn() } }));
jest.mock('bcrypt', () => ({ compareSync: jest.fn(), hashSync: jest.fn() }));

import sharp from 'sharp';
import axios from 'axios';
import { readOrFetch } from '@gitroom/helpers/utils/read.or.fetch';
import { LinkedinProvider } from '@gitroom/nestjs-libraries/integrations/social/linkedin.provider';
import { BlueskyProvider } from '@gitroom/nestjs-libraries/integrations/social/bluesky.provider';
import { XProvider } from '@gitroom/nestjs-libraries/integrations/social/x.provider';

const image = () =>
  sharp({
    create: { width: 40, height: 20, channels: 4, background: '#44668880' },
  });

describe('provider image preparation with real Sharp and offline transports', () => {
  afterEach(() => jest.restoreAllMocks());

  it.each(['jpeg', 'png', 'avif'] as const)(
    'prepares LinkedIn %s as a resized JPEG',
    async (format) => {
      const source = await image()[format]().toBuffer();
      jest.mocked(readOrFetch).mockResolvedValue(source);
      const output = await (new LinkedinProvider() as any).prepareMediaBuffer(
        `https://assets.example/photo.${format}`
      );
      expect(await sharp(output).metadata()).toMatchObject({
        format: 'jpeg',
        width: 1000,
        height: 500,
        hasAlpha: false,
      });
      expect((await sharp(output).raw().toBuffer()).length).toBe(
        1000 * 500 * 3
      );
    }
  );

  it('decodes PNG and AVIF when building a LinkedIn PDF carousel', async () => {
    const fixtures = [
      await image().png().toBuffer(),
      await image().avif().toBuffer(),
    ];
    jest
      .mocked(readOrFetch)
      .mockImplementation(
        async (path) => fixtures[path.endsWith('.png') ? 0 : 1]
      );
    const first = {
      id: 'first',
      media: [{ path: 'photo.png' }, { path: 'photo.avif' }],
    };
    const later = { id: 'later', media: [] };
    const result = await (
      new LinkedinProvider() as any
    ).convertImagesToPdfCarousel([first, later], first);
    const pdf = result[0].media[0];
    expect(pdf).toMatchObject({ type: 'image', path: 'carousel.pdf' });
    expect(pdf.buffer.toString('ascii', 0, 5)).toBe('%PDF-');
    expect(pdf.buffer.toString('latin1')).toMatch(/\/Subtype \/Image/);
    expect(pdf.buffer.toString('latin1')).toMatch(/\/Width 40\s+\/Height 20/);
    expect(result[1]).toBe(later);
  });

  it.each([false, true])(
    'preserves Bluesky metadata with bounded reduction=%s',
    async (reduce) => {
      const source = reduce
        ? await sharp({
            create: {
              width: 600,
              height: 600,
              channels: 3,
              background: '#446688',
            },
          })
            .png({ compressionLevel: 0 })
            .toBuffer()
        : await image().png().toBuffer();
      if (reduce) expect(source.length).toBeGreaterThan(976 * 1024);
      jest.mocked(axios.get).mockResolvedValue({ data: source });
      const uploadBlob = jest.fn(async (_blob: Blob) => ({
        data: { blob: 'fixture-blob' },
      }));
      const { embed } = await (new BlueskyProvider() as any).uploadMediaForPost(
        { uploadBlob },
        {
          media: [{ path: 'https://assets.example/photo.png', alt: 'Fixture' }],
        }
      );
      expect(uploadBlob).toHaveBeenCalledTimes(1);
      const bytes = Buffer.from(
        await uploadBlob.mock.calls[0][0].arrayBuffer()
      );
      const dimensions = reduce
        ? { width: 540, height: 540 }
        : { width: 40, height: 20 };
      expect(bytes.length).toBeLessThanOrEqual(976 * 1024);
      expect(await sharp(bytes).metadata()).toMatchObject({
        format: 'png',
        ...dimensions,
      });
      expect((await sharp(bytes).raw().toBuffer()).length).toBeGreaterThan(0);
      if (!reduce) expect(bytes).toEqual(source);
      expect(embed.images).toEqual([
        { alt: 'Fixture', image: 'fixture-blob', aspectRatio: dimensions },
      ]);
    }
  );

  it('resizes X images to GIF and passes video bytes through unchanged', async () => {
    const source = await image().png().toBuffer();
    const video = Buffer.from('benign offline video bypass fixture');
    jest
      .mocked(readOrFetch)
      .mockImplementation(async (path) =>
        path.endsWith('.mp4') ? video : source
      );
    const uploadMedia = jest.fn(
      async (_bytes: Buffer, _options: any) => 'media-id'
    );
    const result = await (new XProvider() as any).uploadMedia(
      { v2: { uploadMedia } },
      [{ id: 'post', media: [{ path: 'photo.png' }, { path: 'clip.mp4' }] }]
    );
    expect(result).toEqual({ post: ['media-id', 'media-id'] });
    expect(uploadMedia).toHaveBeenCalledTimes(2);
    const gif = uploadMedia.mock.calls.find(
      ([, options]) => options.media_type === 'image/png'
    )![0];
    expect(await sharp(gif).metadata()).toMatchObject({
      format: 'gif',
      width: 1000,
      height: 500,
    });
    expect((await sharp(gif).raw().toBuffer()).length).toBeGreaterThan(0);
    expect(
      uploadMedia.mock.calls.find(
        ([, options]) => options.media_type === 'video/mp4'
      )![0]
    ).toEqual(video);
  });
});
