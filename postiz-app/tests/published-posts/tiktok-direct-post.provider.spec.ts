import { TiktokProvider } from '@gitroom/nestjs-libraries/integrations/social/tiktok.provider';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const baseCreatorData = {
  creator_nickname: 'Arundel Creator',
  privacy_level_options: ['PUBLIC_TO_EVERYONE', 'SELF_ONLY'],
  comment_disabled: false,
  duet_disabled: false,
  stitch_disabled: false,
  max_video_post_duration_sec: 60,
};

const baseSettings = {
  content_posting_method: 'DIRECT_POST' as const,
  privacy_level: 'PUBLIC_TO_EVERYONE',
  comment: false,
  duet: false,
  stitch: false,
  disclose: false,
  brand_content_toggle: false,
  brand_organic_toggle: false,
  video_made_with_ai: false,
  autoAddMusic: 'no' as const,
};

const basePost = {
  id: 'post-1',
  message: 'Caption',
  media: [
    { type: 'video' as const, path: 'https://media.example.com/video.mp4' },
  ],
};

const createProvider = ({
  creatorData = baseCreatorData,
  duration = 30,
}: {
  creatorData?: typeof baseCreatorData;
  duration?: number;
} = {}) => {
  const provider = new TiktokProvider() as any;
  provider.creatorInfo = jest.fn().mockResolvedValue({ data: creatorData });
  provider.probeVideoDuration = jest.fn().mockResolvedValue(duration);
  provider.fetch = jest
    .fn()
    .mockResolvedValueOnce({
      json: async () => ({ data: { publish_id: 'publish-1' } }),
    })
    .mockResolvedValueOnce({
      json: async () => ({
        data: {
          status: 'PUBLISH_COMPLETE',
          publicaly_available_post_id: ['video-1'],
        },
      }),
    });
  return provider;
};

const publish = async (
  provider: any,
  settings: Record<string, unknown> = {},
  media = basePost.media
) => {
  const result = await provider.post(
    'creator-id',
    'actual-access-token',
    [{ ...basePost, media, settings: { ...baseSettings, ...settings } }],
    { profile: 'creator-profile' }
  );
  const requestBody = JSON.parse(provider.fetch.mock.calls[0][1].body);
  return { requestBody, result };
};

describe('TikTok Direct Post provider safety', () => {
  let consoleSpy: jest.SpyInstance;
  let previousBucketUrl: string | undefined;
  let previousUploadDirectory: string | undefined;
  let previousUploadStaticDirectory: string | undefined;

  beforeEach(() => {
    previousBucketUrl = process.env.CLOUDFLARE_BUCKET_URL;
    previousUploadDirectory = process.env.UPLOAD_DIRECTORY;
    previousUploadStaticDirectory =
      process.env.NEXT_PUBLIC_UPLOAD_STATIC_DIRECTORY;
    consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    for (const [name, value] of [
      ['CLOUDFLARE_BUCKET_URL', previousBucketUrl],
      ['UPLOAD_DIRECTORY', previousUploadDirectory],
      [
        'NEXT_PUBLIC_UPLOAD_STATIC_DIRECTORY',
        previousUploadStaticDirectory,
      ],
    ] as const) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
    consoleSpy.mockRestore();
  });

  it('rejects an over-limit video through the public posting path', async () => {
    const provider = createProvider({ duration: 61 });

    await expect(
      publish(provider, {}, [
        {
          type: 'video',
          path: 'https://media.example.com/video.mov',
        },
      ])
    ).rejects.toMatchObject({
      message: 'TikTok allows this creator to post videos up to 60 seconds.',
    });
    expect(provider.creatorInfo).toHaveBeenCalledWith('actual-access-token');
    expect(provider.fetch).not.toHaveBeenCalled();
  });

  it('uses the fresh creator maximum and lets an allowed video reach initialization', async () => {
    const provider = createProvider({ duration: 30 });

    const { result } = await publish(provider, {
      __tiktok_max_video_duration_sec: 1,
    });

    expect(result).toMatchObject([{ status: 'success', postId: 'video-1' }]);
    expect(provider.creatorInfo).toHaveBeenCalledWith('actual-access-token');
    expect(provider.probeVideoDuration).toHaveBeenCalledWith(
      'https://media.example.com/video.mp4'
    );
  });

  it.each([NaN, 0, -1])(
    'fails closed when the server duration is %p',
    async (duration) => {
      const provider = createProvider({ duration });

      await expect(publish(provider)).rejects.toMatchObject({
        message:
          'Unable to verify the selected video duration before publishing.',
      });
      expect(provider.fetch).not.toHaveBeenCalled();
    }
  );

  it('fails closed when current creator info is unavailable', async () => {
    const provider = createProvider();
    provider.creatorInfo.mockRejectedValue(new Error('TikTok unavailable'));

    await expect(publish(provider)).rejects.toMatchObject({
      message:
        'Unable to load current TikTok creator settings before publishing.',
    });
    expect(provider.fetch).not.toHaveBeenCalled();
  });

  it('rejects hidden commercial flags when disclosure is off', async () => {
    const provider = createProvider();

    await expect(
      publish(provider, { brand_content_toggle: true })
    ).rejects.toMatchObject({
      message:
        'Commercial content categories require disclosure to be enabled.',
    });
    expect(provider.fetch).not.toHaveBeenCalled();
  });

  it('requires a commercial subtype when disclosure is on', async () => {
    const provider = createProvider();

    await expect(publish(provider, { disclose: true })).rejects.toMatchObject({
      message:
        'Select at least one commercial content category when disclosure is enabled.',
    });
    expect(provider.fetch).not.toHaveBeenCalled();
  });

  it('rejects branded content with SELF_ONLY privacy', async () => {
    const provider = createProvider();

    await expect(
      publish(provider, {
        disclose: true,
        brand_content_toggle: true,
        privacy_level: 'SELF_ONLY',
      })
    ).rejects.toMatchObject({
      message: 'Branded content visibility cannot be set to private.',
    });
    expect(provider.fetch).not.toHaveBeenCalled();
  });

  it('preserves valid promotional and branded content together', async () => {
    const provider = createProvider();

    const { requestBody } = await publish(provider, {
      disclose: true,
      brand_content_toggle: true,
      brand_organic_toggle: true,
    });

    expect(requestBody.post_info).toMatchObject({
      brand_content_toggle: true,
      brand_organic_toggle: true,
    });
  });

  it.each([
    ['comments', 'comment', 'comment_disabled'],
    ['duet', 'duet', 'duet_disabled'],
    ['stitch', 'stitch', 'stitch_disabled'],
  ] as const)(
    'rejects requested %s when fresh creator info disables it',
    async (label, setting, creatorField) => {
      const provider = createProvider({
        creatorData: { ...baseCreatorData, [creatorField]: true },
      });

      await expect(
        publish(provider, { [setting]: true })
      ).rejects.toMatchObject({
        message: `TikTok currently does not allow ${label} for this creator.`,
      });
      expect(provider.fetch).not.toHaveBeenCalled();
    }
  );

  it('derives allowed interaction flags in the outgoing TikTok body', async () => {
    const provider = createProvider();

    const { requestBody } = await publish(provider, {
      comment: true,
      duet: true,
      stitch: false,
    });

    expect(requestBody.post_info).toMatchObject({
      disable_comment: false,
      disable_duet: false,
      disable_stitch: true,
    });
  });

  it('rejects arbitrary media URLs before invoking ffprobe', async () => {
    process.env.CLOUDFLARE_BUCKET_URL =
      'https://media.example.com/uploads';
    const provider = new TiktokProvider() as any;
    provider.runMediaCommand = jest.fn();

    await expect(
      provider.probeVideoDuration(
        'https://169.254.169.254/latest/meta-data/video.mp4'
      )
    ).rejects.toThrow(
      'Selected video is not in configured application storage.'
    );
    expect(provider.runMediaCommand).not.toHaveBeenCalled();
  });

  it('passes only the canonical configured Cloudflare URL to ffprobe', async () => {
    process.env.CLOUDFLARE_BUCKET_URL = 'https://media.example.com/uploads';
    const provider = new TiktokProvider() as any;
    provider.runMediaCommand = jest.fn().mockResolvedValue({ stdout: '30\n' });
    const mediaPath =
      'https://MEDIA.EXAMPLE.COM:443/uploads/./video.mp4';

    await expect(provider.probeVideoDuration(mediaPath)).resolves.toBe(30);
    expect(provider.runMediaCommand).toHaveBeenCalledWith(
      'ffprobe',
      expect.any(Array),
      expect.objectContaining({ timeout: 15_000 })
    );
    expect(provider.runMediaCommand.mock.calls[0][1].at(-1)).toBe(
      'https://media.example.com/uploads/video.mp4'
    );
  });

  it('rejects a backslash parser-confusion URL before invoking ffprobe', async () => {
    process.env.CLOUDFLARE_BUCKET_URL = 'https://media.example.com';
    const provider = new TiktokProvider() as any;
    provider.runMediaCommand = jest.fn();

    await expect(
      provider.probeVideoDuration(
        'https://media.example.com\\@127.0.0.1:4321/video.mp4'
      )
    ).rejects.toThrow(
      'Selected video is not in configured application storage.'
    );
    expect(provider.runMediaCommand).not.toHaveBeenCalled();
  });

  it.each([
    'https://user@media.example.com/uploads/video.mp4',
    'https://:password@media.example.com/uploads/video.mp4',
    'https://user:password@media.example.com/uploads/video.mp4',
  ])('rejects URL credentials before invoking ffprobe: %s', async (mediaPath) => {
    process.env.CLOUDFLARE_BUCKET_URL =
      'https://media.example.com/uploads';
    const provider = new TiktokProvider() as any;
    provider.runMediaCommand = jest.fn();

    await expect(provider.probeVideoDuration(mediaPath)).rejects.toThrow(
      'Selected video is not in configured application storage.'
    );
    expect(provider.runMediaCommand).not.toHaveBeenCalled();
  });

  it('rejects ASCII control characters before invoking ffprobe', async () => {
    process.env.CLOUDFLARE_BUCKET_URL = 'https://media.example.com/uploads';
    const provider = new TiktokProvider() as any;
    provider.runMediaCommand = jest.fn();

    await expect(
      provider.probeVideoDuration(
        'https://media.example.com/uploads/video\t.mp4'
      )
    ).rejects.toThrow(
      'Selected video is not in configured application storage.'
    );
    expect(provider.runMediaCommand).not.toHaveBeenCalled();
  });

  it('preserves trusted local-file probing', async () => {
    const uploadDirectory = mkdtempSync(join(tmpdir(), 'tiktok-upload-'));
    const mediaPath = join(uploadDirectory, 'video.mp4');
    writeFileSync(mediaPath, 'test video');
    process.env.UPLOAD_DIRECTORY = uploadDirectory;
    process.env.NEXT_PUBLIC_UPLOAD_STATIC_DIRECTORY = '/uploads';
    const provider = new TiktokProvider() as any;
    provider.runMediaCommand = jest.fn().mockResolvedValue({ stdout: '30\n' });

    try {
      await expect(
        provider.probeVideoDuration('/uploads/video.mp4')
      ).resolves.toBe(30);
      expect(provider.runMediaCommand.mock.calls[0][1].at(-1)).toBe(
        realpathSync(mediaPath)
      );
    } finally {
      rmSync(uploadDirectory, { recursive: true, force: true });
    }
  });

  it('does not invent a privacy level or send frontend validation metadata', () => {
    const provider = new TiktokProvider() as any;
    const body = provider.buildTikokPostInfoBody({
      message: 'Caption',
      media: [{ path: 'https://media.example.com/video.mp4' }],
      settings: {
        content_posting_method: 'DIRECT_POST',
        comment: false,
        duet: false,
        stitch: false,
        __tiktok_creator_info_loaded: true,
        __tiktok_max_video_duration_sec: 60,
      },
    });

    expect(body.post_info.privacy_level).toBeUndefined();
    expect(body.post_info).not.toHaveProperty('__tiktok_creator_info_loaded');
    expect(body.post_info).not.toHaveProperty(
      '__tiktok_max_video_duration_sec'
    );
  });
});
