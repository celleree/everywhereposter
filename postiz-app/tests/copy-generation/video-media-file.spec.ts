import { Readable } from 'stream';
import {
  createRemoteMediaByteLimitStream,
  prepareVideoMediaFile,
  REMOTE_MEDIA_MAX_BYTES,
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
  rm: jest.fn(),
}));

jest.mock('stream/promises', () => ({
  pipeline: jest.fn(),
}));

const axios = (jest.requireMock('axios') as { default: jest.Mock }).default;
const { createWriteStream } = jest.requireMock('fs') as {
  createWriteStream: jest.Mock;
};
const { access, mkdtemp, rm } = jest.requireMock('fs/promises') as {
  access: jest.Mock;
  mkdtemp: jest.Mock;
  rm: jest.Mock;
};
const { pipeline } = jest.requireMock('stream/promises') as {
  pipeline: jest.Mock;
};

describe('prepareVideoMediaFile', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

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

  it('streams remote media through a byte limiter to a unique temporary file', async () => {
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
