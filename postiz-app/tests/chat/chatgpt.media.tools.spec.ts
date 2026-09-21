const mockUploadFile = jest.fn();

jest.mock('@gitroom/nestjs-libraries/upload/upload.factory', () => ({
  UploadFactory: {
    createStorage: () => ({
      uploadFile: mockUploadFile,
    }),
  },
}));

jest.mock('file-type', () => ({
  fromBuffer: jest.fn(),
}));

import {
  ChatGptMediaUploadTool,
  PostStatusTool,
} from '@gitroom/nestjs-libraries/chat/tools/chatgpt.media.tools';

const fileType = require('file-type');

const contextFor = (organizationId = 'org-1') => ({
  requestContext: {
    get: (key: string) =>
      key === 'organization' ? JSON.stringify({ id: organizationId }) : undefined,
    set: jest.fn(),
  },
});

describe('ChatGPT MCP media tools', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it('advertises the ChatGPT file parameter contract and imports trusted media', async () => {
    const mediaService = {
      saveFile: jest.fn().mockResolvedValue({
        id: 'media-1',
        path: 'https://cdn.example.com/video.mp4',
        name: 'stored.mp4',
        originalName: 'clip.mp4',
        type: 'video',
      }),
    };
    const body = Buffer.from('fake-video');
    fileType.fromBuffer.mockResolvedValue({ mime: 'video/mp4', ext: 'mp4' });
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-length': String(body.length) }),
      arrayBuffer: async () =>
        body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
    } as any);
    mockUploadFile.mockResolvedValue({
      originalname: 'stored.mp4',
      path: 'https://cdn.example.com/video.mp4',
    });

    const tool = new ChatGptMediaUploadTool(mediaService as any).run() as any;

    expect(tool.mcp?._meta?.['openai/fileParams']).toEqual(['file']);

    await expect(
      tool.execute(
        {
          file: {
            download_url: 'https://files.openai.com/content/temporary',
            file_id: 'file_123',
            mime_type: 'video/mp4',
            file_name: 'clip.mp4',
          },
        },
        contextFor()
      )
    ).resolves.toEqual({
      output: {
        id: 'media-1',
        path: 'https://cdn.example.com/video.mp4',
        name: 'stored.mp4',
        originalName: 'clip.mp4',
        type: 'video',
        mimeType: 'video/mp4',
      },
    });

    expect(mediaService.saveFile).toHaveBeenCalledWith(
      'org-1',
      'stored.mp4',
      'https://cdn.example.com/video.mp4',
      'clip.mp4',
      'video/mp4'
    );
  });

  it('rejects non-OpenAI download URLs before fetching them', async () => {
    const tool = new ChatGptMediaUploadTool({} as any).run() as any;
    global.fetch = jest.fn();

    await expect(
      tool.execute(
        {
          file: {
            download_url: 'https://example.com/video.mp4',
            file_id: 'file_123',
          },
        },
        contextFor()
      )
    ).rejects.toThrow('Only ChatGPT temporary file URLs are accepted.');

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('returns scoped post status without exposing another organization', async () => {
    const postsRepository = {
      getPost: jest.fn().mockResolvedValue({
        id: 'post-1',
        state: 'PUBLISHED',
        publishDate: new Date('2026-09-20T20:00:00.000Z'),
        releaseURL: 'https://social.example.com/post/1',
        error: null,
        integration: {
          providerIdentifier: 'instagram',
          name: 'Main Instagram',
        },
      }),
    };
    const tool = new PostStatusTool(postsRepository as any).run() as any;

    await expect(
      tool.execute({ postId: 'post-1' }, contextFor('org-1'))
    ).resolves.toEqual({
      output: {
        found: true,
        id: 'post-1',
        state: 'PUBLISHED',
        publishDate: '2026-09-20T20:00:00.000Z',
        releaseURL: 'https://social.example.com/post/1',
        error: null,
        platform: 'instagram',
        account: 'Main Instagram',
      },
    });

    expect(postsRepository.getPost).toHaveBeenCalledWith(
      'post-1',
      true,
      'org-1',
      true
    );

    postsRepository.getPost.mockResolvedValueOnce(null);
    await expect(
      tool.execute({ postId: 'post-other-org' }, contextFor('org-1'))
    ).resolves.toEqual({ output: { found: false } });
  });
});
