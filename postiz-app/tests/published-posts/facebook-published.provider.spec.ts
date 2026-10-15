jest.mock('sharp', () => ({ __esModule: true, default: jest.fn() }));
import { FacebookProvider } from '../../libraries/nestjs-libraries/src/integrations/social/facebook.provider';
const response = (body: any, ok = true) =>
  ({
    ok,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response);
const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
  jest.restoreAllMocks();
});

describe('Facebook text/feed Graph contract', () => {
  it('edits the same ID and verifies the returned message, with no automatic mutation retry', async () => {
    const fetch = jest
      .fn()
      .mockResolvedValueOnce(response({ id: '123_456', message: 'Old' }))
      .mockResolvedValueOnce(response({ success: true }))
      .mockResolvedValueOnce(response({ id: '123_456', message: 'Edited' }));
    global.fetch = fetch;
    await expect(
      new FacebookProvider().update('123', 'private', '123_456', [
        { id: 'local', message: 'Edited', settings: {}, media: [] },
      ])
    ).resolves.toEqual([
      {
        id: 'local',
        postId: '123_456',
        releaseURL: 'https://www.facebook.com/123_456',
        status: 'success',
      },
    ]);
    expect(fetch.mock.calls.map(([, init]) => init.method)).toEqual([
      'GET',
      'POST',
      'GET',
    ]);
    expect(fetch.mock.calls[1][0]).toBe(
      'https://graph.facebook.com/v25.0/123_456'
    );
    expect(fetch.mock.calls[1][1]).toMatchObject({
      headers: { Authorization: 'Bearer private' },
      body: '{"message":"Edited"}',
    });
  });
  it.each([{ success: false }, {}, { id: '123_456' }])(
    'rejects malformed edit acceptance %j',
    async (body) => {
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce(response({ id: '123_456', message: 'Old' }))
        .mockResolvedValueOnce(response(body));
      await expect(
        new FacebookProvider().update('123', 'private', '123_456', [
          { id: 'local', message: 'Edited', settings: {}, media: [] },
        ])
      ).rejects.toThrow('confirm');
      expect(global.fetch).toHaveBeenCalledTimes(2);
    }
  );
  it('rejects unexpected identity and unsupported media/settings before mutation', async () => {
    global.fetch = jest.fn();
    const provider = new FacebookProvider();
    await expect(
      provider.deletePublished('999', 'private', '123_456')
    ).rejects.toThrow('identity');
    await expect(
      provider.update('123', 'private', '123_456', [
        {
          id: 'local',
          message: 'Edited',
          settings: { url: 'https://example.com' },
          media: [],
        },
      ])
    ).rejects.toThrow('Only');
    expect(global.fetch).not.toHaveBeenCalled();
  });
  it('deletes only on explicit success and does not interpret Graph 100 as deleted', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(response({ id: '123_456', message: 'Old' }))
      .mockResolvedValueOnce(
        response({ error: { code: 100, message: 'secret-token' } }, false)
      );
    await expect(
      new FacebookProvider().deletePublished('123', 'private', '123_456')
    ).rejects.toThrow('could not confirm');
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
  it('records creation provenance only for a new supported text/feed response', async () => {
    process.env.FACEBOOK_APP_ID = 'app';
    const provider = new FacebookProvider();
    jest
      .spyOn(provider as any, 'fetch')
      .mockResolvedValue(response({ id: '123_456' }));
    const result = await provider.post('123', 'private', [
      { id: 'local', message: 'Text', settings: {}, media: [] },
    ]);
    expect(result[0]).toMatchObject({
      postId: '123_456',
      releaseURL: 'https://www.facebook.com/123_456',
      facebookText: {
        pageId: '123',
        appId: 'app',
        message: 'Text',
        revision: 0,
      },
    });
    const link = await provider.post('123', 'private', [
      { id: 'local', message: 'https://example.com', settings: {}, media: [] },
    ]);
    expect(link[0].facebookText).toBeUndefined();
  });
  it('maps an outside-person comment and preserves missing author fallback (fixture evidence only)', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      response({
        data: [
          {
            id: 'comment-1',
            message: 'Outside user comment',
            from: { name: 'Outside Person' },
          },
          { id: 'comment-2', message: 'Author unavailable' },
        ],
      })
    );
    const comments = await new FacebookProvider().readComments(
      '123',
      'private',
      '123_456',
      {} as any
    );
    expect(comments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'comment-1',
          message: 'Outside user comment',
          authorName: 'Outside Person',
        }),
        expect.objectContaining({
          id: 'comment-2',
          authorName: 'Facebook user',
        }),
      ])
    );
  });
});
