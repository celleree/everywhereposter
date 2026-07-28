import { writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import sharp from 'sharp';
import { ImageAssetService } from '@gitroom/nestjs-libraries/copy-generation/image-asset.service';

const org = { id: 'org-1' } as any;
const sourceMedia = {
  id: 'media-1',
  name: 'source.mp4',
  originalName: 'source.mp4',
  path: join(tmpdir(), 'image-asset-source.mp4'),
  type: 'video',
};
const basePlan = {
  platform: 'linkedin' as const,
  purpose: 'Support the post.',
  rationale: 'The asset matches the source.',
  visualSummary: 'A founder explains a distribution workflow.',
  altText: 'A visual supporting a distribution workflow.',
  confidence: 0.8,
  warnings: [],
};

class TestImageAssetService extends ImageAssetService {
  protected async runMediaCommand(_command: string, args: string[]): Promise<any> {
    const outputPath = args[args.length - 1];
    const filter = args[args.indexOf('-vf') + 1] || '';
    const dimensions = filter.match(/scale=(\d+):(\d+)/);
    await sharp({
      create: {
        width: Number(dimensions?.[1] || 1600),
        height: Number(dimensions?.[2] || 900),
        channels: 3,
        background: '#334155',
      },
    })
      .jpeg()
      .toFile(outputPath);
    return { stdout: '', stderr: '' };
  }
}

describe('ImageAssetService', () => {
  const mediaRepository = {
    getMediaByOrganizationIdAndId: jest.fn(),
  };
  const mediaService = {
    generateImage: jest.fn(),
    saveFile: jest.fn(),
    saveMediaInformation: jest.fn(),
  };
  const storage = { uploadSimple: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    await writeFile(sourceMedia.path, 'video-fixture');
    mediaRepository.getMediaByOrganizationIdAndId.mockResolvedValue(sourceMedia);
    storage.uploadSimple.mockResolvedValue('https://cdn.example.com/generated.png');
    mediaService.saveFile.mockResolvedValue({
      id: 'generated-1',
      name: 'generated.png',
      path: 'https://cdn.example.com/generated.png',
      type: 'image',
    });
    mediaService.saveMediaInformation.mockResolvedValue({
      id: 'generated-1',
      name: 'generated.png',
      path: 'https://cdn.example.com/generated.png',
      type: 'image',
      alt: basePlan.altText,
    });
  });

  const createService = () => {
    const service = new TestImageAssetService(
      mediaRepository as any,
      mediaService as any
    );
    (service as any).storage = storage;
    return service;
  };

  it('renders and saves a quote card at the requested ratio', async () => {
    const result = await createService().render(org, {
      mediaId: sourceMedia.id,
      imagePlans: [
        {
          ...basePlan,
          id: 'plan-1',
          type: 'quote_card',
          aspectRatio: '4:5',
          headline: 'One video should travel further.',
          subheadline: 'Adapt the post instead of copying it everywhere.',
        },
      ],
    } as any);

    expect(result.status).toBe('complete');
    expect(result.results[0]).toMatchObject({
      planId: 'plan-1',
      status: 'completed',
      width: 1080,
      height: 1350,
      mimeType: 'image/png',
    });
    const dataUrl = storage.uploadSimple.mock.calls[0][0] as string;
    const metadata = await sharp(Buffer.from(dataUrl.split(',')[1], 'base64')).metadata();
    expect(metadata.width).toBe(1080);
    expect(metadata.height).toBe(1350);
    expect(mediaService.saveMediaInformation).toHaveBeenCalledWith(
      'org-1',
      expect.objectContaining({ id: 'generated-1', alt: basePlan.altText })
    );
  });

  it('isolates a failed asset without discarding completed assets', async () => {
    const result = await createService().render(org, {
      mediaId: sourceMedia.id,
      imagePlans: [
        {
          ...basePlan,
          id: 'plan-1',
          type: 'quote_card',
          aspectRatio: '1:1',
          headline: 'Keep the useful asset.',
        },
        {
          ...basePlan,
          id: 'plan-2',
          type: 'ai_visual',
          aspectRatio: '1:1',
          visualPrompt: '',
        },
      ],
    } as any);

    expect(result.status).toBe('partial');
    expect(result.results).toEqual([
      expect.objectContaining({ planId: 'plan-1', status: 'completed' }),
      expect.objectContaining({
        planId: 'plan-2',
        status: 'failed',
        error: expect.objectContaining({ code: 'IMAGE_ASSET_RENDER_FAILED' }),
      }),
    ]);
    expect(mediaService.saveFile).toHaveBeenCalledTimes(1);
  });

  it('renders video frames and thumbnails at exact dimensions', async () => {
    storage.uploadSimple
      .mockResolvedValueOnce('https://cdn.example.com/frame.png')
      .mockResolvedValueOnce('https://cdn.example.com/thumbnail.png');
    mediaService.saveFile
      .mockResolvedValueOnce({ id: 'frame-1', name: 'frame.png', path: 'https://cdn.example.com/frame.png', type: 'image' })
      .mockResolvedValueOnce({ id: 'thumb-1', name: 'thumbnail.png', path: 'https://cdn.example.com/thumbnail.png', type: 'image' });
    mediaService.saveMediaInformation
      .mockResolvedValueOnce({ id: 'frame-1', name: 'frame.png', path: 'https://cdn.example.com/frame.png', type: 'image', alt: basePlan.altText })
      .mockResolvedValueOnce({ id: 'thumb-1', name: 'thumbnail.png', path: 'https://cdn.example.com/thumbnail.png', type: 'image', alt: basePlan.altText });

    const result = await createService().render(org, {
      mediaId: sourceMedia.id,
      imagePlans: [
        {
          ...basePlan,
          id: 'frame-plan',
          type: 'video_frame',
          aspectRatio: '16:9',
          sourceTimestampSeconds: 18.4,
        },
        {
          ...basePlan,
          id: 'thumbnail-plan',
          type: 'thumbnail',
          aspectRatio: '9:16',
          sourceTimestampSeconds: 18.4,
          headline: 'One video. More useful posts.',
        },
      ],
    } as any);

    expect(result.status).toBe('complete');
    expect(result.results).toEqual([
      expect.objectContaining({ planId: 'frame-plan', width: 1600, height: 900 }),
      expect.objectContaining({ planId: 'thumbnail-plan', width: 1080, height: 1920 }),
    ]);
    const thumbnail = storage.uploadSimple.mock.calls[1][0] as string;
    const metadata = await sharp(Buffer.from(thumbnail.split(',')[1], 'base64')).metadata();
    expect(metadata.width).toBe(1080);
    expect(metadata.height).toBe(1920);
  });

  it('normalizes an AI visual to the requested output ratio', async () => {
    const generated = await sharp({
      create: {
        width: 1024,
        height: 1024,
        channels: 3,
        background: '#111827',
      },
    })
      .png()
      .toBuffer();
    mediaService.generateImage.mockResolvedValue(generated.toString('base64'));

    const result = await createService().render(org, {
      mediaId: sourceMedia.id,
      imagePlans: [
        {
          ...basePlan,
          id: 'ai-plan',
          type: 'ai_visual',
          aspectRatio: '16:9',
          visualPrompt: 'An editorial visual of one video branching into multiple post formats, no text.',
        },
      ],
    } as any);

    expect(result.status).toBe('complete');
    expect(mediaService.generateImage).toHaveBeenCalledWith(
      expect.stringContaining('one video branching'),
      org,
      false,
      false
    );
    expect(result.results[0]).toMatchObject({ width: 1600, height: 900 });
  });
});
