import React from 'react';
import { render } from '@testing-library/react';

jest.mock('@gitroom/frontend/components/media/media.component', () => ({
  MediaBox: () => null,
}));

jest.mock('@gitroom/frontend/components/layout/new-modal', () => ({
  useModals: () => ({
    openModal: jest.fn(),
    closeAll: jest.fn(),
    closeById: jest.fn(),
    closeCurrent: jest.fn(),
  }),
}));

jest.mock(
  '@gitroom/frontend/components/new-launch/providers/high.order.provider',
  () => ({
    PostComment: { ALL: 'ALL' },
  })
);

import {
  GUIDED_VIDEO_ACCEPT,
  GuidedComposerUploadDetails,
  isGuidedVideoFile,
  normalizeGuidedVideoFile,
} from '../../apps/frontend/src/components/new-launch/guided.composer.upload.details';
import { inferUploadFileType } from '../../apps/frontend/src/components/media/upload.file.type';
import { useGuidedComposerStore } from '../../apps/frontend/src/components/new-launch/guided.composer.store';
import { useLaunchStore } from '../../apps/frontend/src/components/new-launch/store';

describe('guided composer video picker', () => {
  beforeEach(() => {
    useGuidedComposerStore.getState().resetGuidedComposer();
    useLaunchStore.getState().reset();
  });

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

  it('infers generic video MIME types in every shared Uppy upload path', () => {
    expect(inferUploadFileType({ name: 'library.MOV', type: '' })).toBe(
      'video/quicktime'
    );
    expect(
      inferUploadFileType({
        name: 'dragged.mp4',
        type: 'application/octet-stream',
      })
    ).toBe('video/mp4');
    expect(
      inferUploadFileType({ name: 'thumbnail.mp4', type: 'image/png' })
    ).toBe('image/png');
  });

  it('rejects explicit non-video MIME types even with a video extension', () => {
    const disguisedImage = new File(['image'], 'thumbnail.mp4', {
      type: 'image/png',
    });

    expect(isGuidedVideoFile(disguisedImage)).toBe(false);
    expect(normalizeGuidedVideoFile(disguisedImage)).toBe(disguisedImage);
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

  it('reveals the legacy progress and cancel controls only while uploading', () => {
    const host = document.createElement('div');
    host.innerHTML = `
      <div class="guided-upload-existing-composer">
        <div id="social-content">
          <section><input type="file" /></section>
        </div>
      </div>
    `;
    document.body.appendChild(host);
    const section = host.querySelector('section') as HTMLElement;
    const input = host.querySelector('input') as HTMLInputElement;

    const { rerender, unmount } = render(
      <GuidedComposerUploadDetails disabled={false} />
    );

    expect(section.style.display).toBe('none');
    expect(input.accept).toBe(GUIDED_VIDEO_ACCEPT);

    rerender(<GuidedComposerUploadDetails disabled />);

    expect(section.style.display).toBe('');
    expect(input.accept).toBe(GUIDED_VIDEO_ACCEPT);

    unmount();
    host.remove();
  });
});