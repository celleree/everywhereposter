import { Readable } from 'stream';
import { prepareVideoMediaFile } from '@gitroom/nestjs-libraries/copy-generation/video-media-file';

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

  it('streams remote media to a unique temporary file instead of buffering it', async () => {
    const responseStream = Readable.from(['large-video-chunk']);
    const destination = { destination: true };
    mkdtemp.mockResolvedValue('/tmp/postiz-video-source-abc');
    axios.mockResolvedValue({ data: responseStream });
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
      })
    );
    expect(axios.mock.calls[0][0].responseType).not.toBe('arraybuffer');
    expect(createWriteStream).toHaveBeenCalledWith(
      '/tmp/postiz-video-source-abc/uploaded.mp4',
      { flags: 'wx' }
    );
    expect(pipeline).toHaveBeenCalledWith(responseStream, destination);
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

  it('removes partial temporary files when streaming fails', async () => {
    mkdtemp.mockResolvedValue('/tmp/postiz-video-source-failed');
    axios.mockResolvedValue({ data: Readable.from(['partial']) });
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
