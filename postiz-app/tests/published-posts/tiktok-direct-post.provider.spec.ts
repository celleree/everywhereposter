import { TiktokProvider } from '@gitroom/nestjs-libraries/integrations/social/tiktok.provider';

const creatorInfo = {
  data: {
    creator_nickname: 'Arundel Creator',
    privacy_level_options: ['SELF_ONLY'],
    comment_disabled: false,
    duet_disabled: false,
    stitch_disabled: false,
    max_video_post_duration_sec: 60,
  },
};

describe('TikTok Direct Post provider safety', () => {
  it('requires a privacy choice returned by current creator info', async () => {
    const provider = new TiktokProvider() as any;
    provider.creatorInfo = jest.fn().mockResolvedValue(creatorInfo);

    await expect(
      provider.validateDirectPostCreatorInfo('token', {
        privacy_level: 'SELF_ONLY',
      })
    ).resolves.toBeUndefined();
    await expect(
      provider.validateDirectPostCreatorInfo('token', {
        privacy_level: 'PUBLIC_TO_EVERYONE',
      })
    ).rejects.toMatchObject({
      message:
        'Select a privacy option currently available for this TikTok creator.',
    });
  });

  it('fails closed when current creator info is unavailable', async () => {
    const provider = new TiktokProvider() as any;
    provider.creatorInfo = jest
      .fn()
      .mockRejectedValue(new Error('TikTok unavailable'));

    await expect(
      provider.validateDirectPostCreatorInfo('token', {
        privacy_level: 'SELF_ONLY',
      })
    ).rejects.toMatchObject({
      message:
        'Unable to load current TikTok creator settings before publishing.',
    });
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
