import { XProvider } from '@gitroom/nestjs-libraries/integrations/social/x.provider';
import { BadBody, RefreshToken } from '@gitroom/nestjs-libraries/integrations/social.abstract';
import { readOrFetch } from '@gitroom/helpers/utils/read.or.fetch';

jest.mock('@gitroom/helpers/utils/read.or.fetch', () => ({ readOrFetch: jest.fn() }));

const guidance = 'X could not prepare or upload the attached media. Check that the file is available. For video, export an MP4 with H.264 video and AAC-LC audio.';
const synthetic = Buffer.from('synthetic media only');

describe('X media failure guidance', () => {
  const client = { v2: { me: jest.fn(), uploadMedia: jest.fn(), tweet: jest.fn() } };
  const details = [{ id: 'local-post', message: 'Synthetic caption', media: [{ path: '/fixture/video.mp4' }], settings: {} }] as any;
  let provider: XProvider;

  beforeEach(() => {
    jest.resetAllMocks();
    provider = new XProvider();
    jest.spyOn(provider as any, 'getClient').mockResolvedValue(client);
    client.v2.me.mockResolvedValue({ data: { username: 'fixture' } });
    client.v2.uploadMedia.mockResolvedValue('media-id');
    client.v2.tweet.mockResolvedValue({ data: { id: 'remote-id' } });
    (readOrFetch as jest.Mock).mockResolvedValue(synthetic);
  });

  it.each(['read', 'upload'])('explains an unknown %s failure without leaking raw error details or creating a tweet', async (stage) => {
    const sensitiveFailure = { data: { detail: 'private-provider-response' }, token: 'fixture-secret-marker' };
    if (stage === 'read') (readOrFetch as jest.Mock).mockRejectedValue(sensitiveFailure);
    else client.v2.uploadMedia.mockRejectedValue(sensitiveFailure);

    const failure = await provider.post('account', 'unused', details).catch(error => error);
    expect(failure).toBeInstanceOf(BadBody);
    expect(failure.type).toBe('bad_body');
    expect(failure.message).toBe(guidance);
    expect(JSON.stringify(failure)).not.toContain('private-provider-response');
    expect(JSON.stringify(failure)).not.toContain('fixture-secret-marker');
    expect(client.v2.uploadMedia).toHaveBeenCalledTimes(stage === 'read' ? 0 : 1);
    expect(client.v2.tweet).not.toHaveBeenCalled();
  });

  it.each([
    ['Unsupported Authentication', RefreshToken, 'X authentication has expired, please reconnect your account'],
    ['usage-capped', BadBody, 'Posting failed - capped reached. Please try again later'],
  ])('preserves recognized %s errors', async (title, kind, message) => {
    client.v2.uploadMedia.mockRejectedValue({ data: { title } });
    const failure = await provider.post('account', 'unused', details).catch(error => error);
    expect(failure).toBeInstanceOf(kind);
    expect(failure.message).toBe(message);
    expect(client.v2.tweet).not.toHaveBeenCalled();
  });

  it('preserves successful media and tweet payloads', async () => {
    await expect(provider.post('account', 'unused', details)).resolves.toEqual([
      { id: 'local-post', postId: 'remote-id', releaseURL: 'https://twitter.com/fixture/status/remote-id', status: 'posted' },
    ]);
    expect(client.v2.uploadMedia).toHaveBeenCalledWith(synthetic, { media_type: 'video/mp4' });
    expect(client.v2.tweet).toHaveBeenCalledTimes(1);
    expect(client.v2.tweet).toHaveBeenCalledWith(expect.objectContaining({ text: 'Synthetic caption', media: { media_ids: ['media-id'] } }));
  });

  it('does not relabel an unknown tweet-creation failure as a media failure', async () => {
    client.v2.tweet.mockRejectedValue({ data: { detail: 'unrecognized tweet error' } });
    await expect(provider.post('account', 'unused', details)).rejects.toMatchObject({ message: 'Unknown Error', type: 'bad_body' });
    expect(client.v2.tweet).toHaveBeenCalledTimes(1);
  });
});
