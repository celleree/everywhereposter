import {
  GUIDED_VIDEO_ACCEPT,
  isGuidedVideoFile,
  normalizeGuidedVideoFile,
} from '../../apps/frontend/src/components/new-launch/guided.composer.upload.details';

describe('guided composer video picker', () => {
  it('accepts supported MP4 and MOV videos', () => {
    expect(
      isGuidedVideoFile({ name: 'demo.mp4', type: 'video/mp4' } as File)
    ).toBe(true);
    expect(
      isGuidedVideoFile({
        name: 'demo.mov',
        type: 'video/quicktime',
      } as File)
    ).toBe(true);
    expect(
      isGuidedVideoFile({ name: 'demo.MOV', type: '' } as File)
    ).toBe(true);
  });

  it('normalizes extension-only videos before the legacy uploader validates MIME', () => {
    const mov = new File(['video'], 'demo.MOV', { type: '' });
    const mp4 = new File(['video'], 'demo.mp4', {
      type: 'application/octet-stream',
    });

    expect(normalizeGuidedVideoFile(mov).type).toBe('video/quicktime');
    expect(normalizeGuidedVideoFile(mp4).type).toBe('video/mp4');
  });

  it('leaves recognized video files unchanged', () => {
    const video = new File(['video'], 'demo.mp4', { type: 'video/mp4' });

    expect(normalizeGuidedVideoFile(video)).toBe(video);
  });

  it('rejects image and unsupported file types', () => {
    expect(
      isGuidedVideoFile({ name: 'thumbnail.png', type: 'image/png' } as File)
    ).toBe(false);
    expect(
      isGuidedVideoFile({ name: 'notes.txt', type: 'text/plain' } as File)
    ).toBe(false);
  });

  it('does not advertise image files in the device picker', () => {
    expect(GUIDED_VIDEO_ACCEPT).toContain('video/mp4');
    expect(GUIDED_VIDEO_ACCEPT).toContain('.mov');
    expect(GUIDED_VIDEO_ACCEPT).not.toContain('image/');
  });
});