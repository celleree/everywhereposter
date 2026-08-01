import { isVideoMedia } from '../../apps/frontend/src/components/new-launch/media.copy.helpers';

describe('media copy video detection', () => {
  it('recognizes extensionless uploaded videos from stored media type', () => {
    expect(
      isVideoMedia({
        id: 'video-1',
        path: 'https://media.example.com/opaque-upload-key',
        type: 'video',
      })
    ).toBe(true);
  });

  it('recognizes video MIME metadata', () => {
    expect(
      isVideoMedia({
        id: 'video-2',
        path: 'https://media.example.com/opaque-upload-key',
        mimeType: 'video/quicktime',
      })
    ).toBe(true);
  });

  it('falls back to the original filename when the public URL has no extension', () => {
    expect(
      isVideoMedia({
        id: 'video-3',
        path: 'https://media.example.com/opaque-upload-key',
        originalName: 'demo-recording.mov',
      })
    ).toBe(true);
  });

  it('does not classify images as videos', () => {
    expect(
      isVideoMedia({
        id: 'image-1',
        path: 'https://media.example.com/photo.jpg',
        type: 'image',
      })
    ).toBe(false);
  });
});
