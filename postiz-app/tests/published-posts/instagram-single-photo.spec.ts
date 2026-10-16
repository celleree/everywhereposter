import sharp from 'sharp';
import { InstagramProvider } from '@gitroom/nestjs-libraries/integrations/social/instagram.provider';

describe('Instagram single JPEG feed publishing (external fetch mocked)', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });
  it('validates actual JPEG bytes, creates and polls one container, publishes to feed and returns permalink', async () => {
    const jpeg = await sharp({
      create: { width: 1080, height: 1080, channels: 3, background: '#446688' },
    })
      .withIccProfile('srgb')
      .jpeg({ progressive: false })
      .toBuffer();
    const asset = 'https://assets.example.com/disposable.jpg';
    const fetchMock = jest.fn(
      async (input: string, options: RequestInit = {}) => {
        if (input === asset)
          return {
            ok: true,
            status: 200,
            url: asset,
            redirected: false,
            headers: new Headers({
              'content-type': 'image/jpeg',
              'content-length': String(jpeg.length),
            }),
            arrayBuffer: async () => jpeg,
          };
        const url = new URL(input);
        const body = url.pathname.endsWith('/123/media')
          ? { id: '456' }
          : url.pathname.endsWith('/456')
          ? { status_code: 'FINISHED' }
          : url.pathname.endsWith('/123/media_publish')
          ? { id: '789' }
          : url.pathname.endsWith('/789')
          ? { permalink: 'https://www.instagram.com/p/disposable/' }
          : null;
        if (!body) throw new Error('Unexpected external request');
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify(body),
        };
      }
    );
    global.fetch = fetchMock as any;
    const provider = new InstagramProvider();
    const result = await provider.post(
      '123',
      'PAGE_TOKEN_FIXTURE',
      [
        {
          id: 'local-post',
          message: 'Disposable test photo',
          media: [{ path: asset, type: 'image' }],
          settings: { post_type: 'post', post_type_explicit: true },
        },
      ] as any,
      {} as any
    );
    expect(result).toEqual([
      {
        id: 'local-post',
        postId: '789',
        releaseURL: 'https://www.instagram.com/p/disposable/',
        status: 'success',
      },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(
      fetchMock.mock.calls.slice(0, 2).map(([, options]) => options.method)
    ).toEqual(['HEAD', 'GET']);
    const create = fetchMock.mock.calls[2];
    expect(create[0]).toMatch(/\/123\/media$/);
    expect(create[1].method).toBe('POST');
    const createBody = create[1].body as URLSearchParams;
    expect(createBody.get('image_url')).toBe(asset);
    expect(createBody.get('caption')).toBe('Disposable test photo');
    expect(createBody.has('media_type')).toBe(false);
    expect(createBody.has('is_carousel_item')).toBe(false);
    expect(createBody.has('video_url')).toBe(false);
    expect(fetchMock.mock.calls[3][0]).toContain('fields=status_code');
    expect(
      (fetchMock.mock.calls[4][1].body as URLSearchParams).get('creation_id')
    ).toBe('456');
    expect(fetchMock.mock.calls[5][0]).toContain('fields=permalink');
  });
  it('rejects nonpublic assets before any external request', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock;
    await expect(
      new InstagramProvider().post(
        '123',
        'token',
        [
          {
            id: 'post',
            message: 'Photo',
            media: [{ path: 'http://localhost/photo.jpg', type: 'image' }],
            settings: { post_type: 'post' },
          },
        ] as any,
        {} as any
      )
    ).rejects.toThrow('publicly reachable HTTPS');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
