import { Readable } from 'stream';
import {
  createRemoteMediaByteLimitStream,
  prepareVideoMediaFile,
  REMOTE_MEDIA_MAX_BYTES,
  resolveLocalUploadVideoPath,
} from '@gitroom/nestjs-libraries/copy-generation/video-media-file';

jest.mock('axios', () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock('fs', () => ({
  createWriteStream: jest.fn(() => ({ destination: true })),
}));

jest.mock('fs/promises', () => ({
  access: jest.fn(),
  mkdtemp: jest.fn(),
  realpath: jest.fn(),
  rm: jest.fn(),
  stat: jest.fn(),
}));

jest.mock('stream/promises', () => ({
  pipeline: jest.fn(),
}));

const axios = (jest.requireMock('axios') as { default: jest.Mock }).default;
const { createWriteStream } = jest.requireMock('fs') as {
  createWriteStream: jest.Mock;
};
const { access, mkdtemp, realpath, rm, stat } = jest.requireMock(
  'fs/promises'
) as {
  access: jest.Mock;
  mkdtemp: jest.Mock;
  realpath: jest.Mock;
  rm: jest.Mock;
  stat: jest.Mock;
};

const environment = {
  STORAGE_PROVIDER: process.env.STORAGE_PROVIDER,
  UPLOAD_DIRECTORY: process.env.UPLOAD_DIRECTORY,
  FRONTEND_URL: process.env.FRONTEND_URL,
  NEXT_PUBLIC_UPLOAD_DIRECTORY: process.env.NEXT_PUBLIC_UPLOAD_DIRECTORY,
  NEXT_PUBLIC_UPLOAD_STATIC_DIRECTORY:
    process.env.NEXT_PUBLIC_UPLOAD_STATIC_DIRECTORY,
};

const restoreEnvironment = () => {
  for (const [key, value] of Object.entries(environment)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
};
const { pipeline } = jest.requireMock('stream/promises') as {
  pipeline: jest.Mock;
};

describe('prepareVideoMediaFile', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.STORAGE_PROVIDER = 'local';
    process.env.UPLOAD_DIRECTORY = '/tmp/postiz-video-media-file-test';
    process.env.FRONTEND_URL = 'http://localhost:4007';
    process.env.NEXT_PUBLIC_UPLOAD_DIRECTORY = '/uploads';
    delete process.env.NEXT_PUBLIC_UPLOAD_STATIC_DIRECTORY;
  });

  afterAll(restoreEnvironment);

  it('reuses a local file without copying or deleting it', async () => {
    access.mockResolvedValue(undefined);

    const result = await prepareVideoMediaFile('/uploads/video.mp4', 'video.mp4');

    expect(access).toHaveBeenCalledWith('/uploads/video.mp4');
    expect(axios).not.toHaveBeenCalled();
    expect(result.inputPath).toBe('/uploads/video.mp4');
    expect(result.isTemporary).toBe(false);
    await result.cleanup();
    expect(rm).not.toHaveBeenCalled();
  });

  it('resolves a same-origin local upload URL without downloading it', async () => {
    const localFile = '/tmp/postiz-video-media-file-test/example.mp4';
    realpath.mockImplementation(async (path: string) => path);
    stat.mockResolvedValue({ isFile: () => true });

    const result = await prepareVideoMediaFile(
      'http://localhost:4007/uploads/example.mp4',
      'example.mp4'
    );

    expect(realpath).toHaveBeenCalledWith(
      '/tmp/postiz-video-media-file-test'
    );
    expect(realpath).toHaveBeenCalledWith(localFile);
    expect(stat).toHaveBeenCalledWith(localFile);
    expect(axios).not.toHaveBeenCalled();
    expect(result.inputPath).toBe(localFile);
    expect(result.isTemporary).toBe(false);
  });

  it('does not resolve traversal or encoded-path tricks outside the upload root', async () => {
    await expect(
      resolveLocalUploadVideoPath(
        'http://localhost:4007/uploads/%2e%2e/private/video.mp4'
      )
    ).resolves.toBeUndefined();
    await expect(
      resolveLocalUploadVideoPath(
        'http://localhost:4007/uploads/%2e%2e%2fprivate/video.mp4'
      )
    ).resolves.toBeUndefined();

    expect(realpath).not.toHaveBeenCalled();
    expect(stat).not.toHaveBeenCalled();
  });

  it('requires a local regular file before treating an upload URL as local', async () => {
    realpath.mockImplementation(async (path: string) => path);
    stat.mockResolvedValue({ isFile: () => false });

    await expect(
      resolveLocalUploadVideoPath(
        'http://localhost:4007/uploads/missing.mp4'
      )
    ).resolves.toBeUndefined();
  });

  it('streams remote media through a byte limiter to a unique temporary file', async () => {
    process.env.STORAGE_PROVIDER = 'cloudflare';
    const responseStream = Readable.from(['large-video-chunk']);
    const destination = { destination: true };
    mkdtemp.mockResolvedValue('/tmp/postiz-video-source-abc');
    axios.mockResolvedValue({ data: responseStream, headers: {} });
    createWriteStream.mockReturnValue(destination);
    pipeline.mockResolvedValue(undefined);

    const result = await prepareVideoMediaFile(
      'https://cdn.example.com/media/video.mp4',
      'uploaded.mp4'
    );

    expect(axios).toHaveBeenCalledWith(
      expect.objectContaining({
        responseType: 'stream',
        timeout: 120_000,
        maxContentLength: REMOTE_MEDIA_MAX_BYTES,
      })
    );
    expect(axios.mock.calls[0][0].responseType).not.toBe('arraybuffer');
    expect(createWriteStream).toHaveBeenCalledWith(
      '/tmp/postiz-video-source-abc/uploaded.mp4',
      { flags: 'wx' }
    );
    expect(pipeline).toHaveBeenCalledWith(
      responseStream,
      expect.anything(),
      destination
    );
    expect(result.inputPath).toBe(
      '/tmp/postiz-video-source-abc/uploaded.mp4'
    );
    expect(result.isTemporary).toBe(true);

    await result.cleanup();
    expect(rm).toHaveBeenCalledWith('/tmp/postiz-video-source-abc', {
      recursive: true,
      force: true,
    });
  });

  it('rejects an oversized content-length before writing the response body', async () => {
    const responseStream = Readable.from(['oversized']);
    const destroy = jest.spyOn(responseStream, 'destroy');
    mkdtemp.mockResolvedValue('/tmp/postiz-video-source-oversized');
    axios.mockResolvedValue({
      data: responseStream,
      headers: { 'content-length': `${REMOTE_MEDIA_MAX_BYTES + 1}` },
    });

    await expect(
      prepareVideoMediaFile('https://cdn.example.com/video.mp4', 'video.mp4')
    ).rejects.toThrow('exceeds the 1 GB copy-generation download limit');

    expect(destroy).toHaveBeenCalled();
    expect(pipeline).not.toHaveBeenCalled();
    expect(createWriteStream).not.toHaveBeenCalled();
    expect(rm).toHaveBeenCalledWith('/tmp/postiz-video-source-oversized', {
      recursive: true,
      force: true,
    });
  });

  it('destroys a streamed download as soon as the byte limit is exceeded', async () => {
    const limiter = createRemoteMediaByteLimitStream(5);

    const consume = async () => {
      for await (const _chunk of Readable.from(['abc', 'def']).pipe(limiter)) {
        // Drain the stream until the limiter rejects it.
      }
    };

    await expect(consume()).rejects.toThrow(
      'exceeds the 1 GB copy-generation download limit'
    );
    expect(limiter.destroyed).toBe(true);
  });

  it('removes partial temporary files when streaming fails', async () => {
    mkdtemp.mockResolvedValue('/tmp/postiz-video-source-failed');
    axios.mockResolvedValue({ data: Readable.from(['partial']), headers: {} });
    pipeline.mockRejectedValue(new Error('stream interrupted'));

    await expect(
      prepareVideoMediaFile('https://cdn.example.com/video.mp4', 'video.mp4')
    ).rejects.toThrow('stream interrupted');

    expect(rm).toHaveBeenCalledWith('/tmp/postiz-video-source-failed', {
      recursive: true,
      force: true,
    });
  });
});
