import React from 'react';
import { act, render } from '@testing-library/react';

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
  isGuidedMp4MovMedia,
  isGuidedVideoFile,
  normalizeGuidedVideoFile,
  selectGuidedSourceVideo,
} from '../../apps/frontend/src/components/new-launch/guided.composer.upload.details';
import { resolveUploadFileType } from '../../apps/frontend/src/components/media/upload.file.type';
import { useGuidedComposerStore } from '../../apps/frontend/src/components/new-launch/guided.composer.store';
import { useLaunchStore } from '../../apps/frontend/src/components/new-launch/store';

const encodeAscii = (value: string) =>
  new Uint8Array(
    Array.from(value).map((character) => character.charCodeAt(0))
  );

const encodeUint32 = (value: number) =>
  new Uint8Array([
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ]);

const concatBytes = (...chunks: Uint8Array[]) => {
  const totalLength = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const output = new Uint8Array(totalLength);
  let offset = 0;

  chunks.forEach((chunk) => {
    output.set(chunk, offset);
    offset += chunk.length;
  });

  return output;
};

const createBox = (type: string, ...payloadChunks: Uint8Array[]) => {
  const payload = concatBytes(...payloadChunks);

  return concatBytes(
    encodeUint32(payload.length + 8),
    encodeAscii(type),
    payload
  );
};

const createIsoBmffBytes = (
  brand: string,
  compatibleBrand = brand,
  handlerType = 'vide'
) => {
  const ftyp = createBox(
    'ftyp',
    encodeAscii(brand),
    new Uint8Array(4),
    encodeAscii(compatibleBrand)
  );
  const hdlr = createBox(
    'hdlr',
    new Uint8Array(8),
    encodeAscii(handlerType)
  );
  const moov = createBox(
    'moov',
    createBox('trak', createBox('mdia', hdlr))
  );

  return concatBytes(ftyp, moov);
};

const createMp4File = (
  name = 'demo.mp4',
  type = 'video/mp4',
  brand = 'isom'
) => new File([createIsoBmffBytes(brand, 'mp42')], name, { type });

const createMovFile = (name = 'demo.mov', type = 'video/quicktime') =>
  new File([createIsoBmffBytes('qt  ')], name, { type });

const createVideo = (id: string, extension = 'mp4') => ({
  id,
  path: `https://media.example.com/${id}.${extension}`,
  type: 'video',
});

describe('guided composer video picker', () => {
  beforeEach(() => {
    useGuidedComposerStore.getState().resetGuidedComposer();
    useLaunchStore.getState().reset();
  });

  it('accepts supported MP4 and MOV files with valid video tracks', async () => {
    await expect(isGuidedVideoFile(createMp4File())).resolves.toBe(true);
    await expect(isGuidedVideoFile(createMovFile())).resolves.toBe(true);
    await expect(
      isGuidedVideoFile(createMovFile('demo.MOV', ''))
    ).resolves.toBe(true);
  });

  it('normalizes extension-only videos only after their bytes validate', async () => {
    const mov = createMovFile('demo.MOV', '');
    const mp4 = createMp4File('demo.mp4', 'application/octet-stream');

    await expect(normalizeGuidedVideoFile(mov)).resolves.toMatchObject({
      type: 'video/quicktime',
    });
    await expect(normalizeGuidedVideoFile(mp4)).resolves.toMatchObject({
      type: 'video/mp4',
    });
    await expect(resolveUploadFileType(mov)).resolves.toBe('video/quicktime');
    await expect(resolveUploadFileType(mp4)).resolves.toBe('video/mp4');
  });

  it('rejects arbitrary bytes renamed to MP4 or MOV with a generic MIME', async () => {
    const renamedMp4 = new File(['not a video'], 'example.mp4', {
      type: 'application/octet-stream',
    });
    const renamedMov = new File(['not a video'], 'example.mov', { type: '' });

    await expect(isGuidedVideoFile(renamedMp4)).resolves.toBe(false);
    await expect(isGuidedVideoFile(renamedMov)).resolves.toBe(false);
    await expect(resolveUploadFileType(renamedMp4)).resolves.toBe(
      'application/octet-stream'
    );
  });

  it('rejects structurally valid BMFF files without a video track', async () => {
    const audioOnly = new File(
      [createIsoBmffBytes('isom', 'mp42', 'soun')],
      'audio-only.mp4',
      { type: 'application/octet-stream' }
    );
    const avif = new File(
      [createIsoBmffBytes('avif', 'mif1', 'pict')],
      'renamed-avif.mp4',
      { type: 'application/octet-stream' }
    );
    const heic = new File(
      [createIsoBmffBytes('heic', 'mif1', 'pict')],
      'renamed-heic.mp4',
      { type: '' }
    );

    await expect(isGuidedVideoFile(audioOnly)).resolves.toBe(false);
    await expect(isGuidedVideoFile(avif)).resolves.toBe(false);
    await expect(isGuidedVideoFile(heic)).resolves.toBe(false);
    await expect(resolveUploadFileType(audioOnly)).resolves.toBe(
      'application/octet-stream'
    );
  });

  it('rejects explicit non-video MIME types and invalid video bytes', async () => {
    const disguisedImage = new File(['image'], 'thumbnail.mp4', {
      type: 'image/png',
    });
    const invalidVideo = new File(['text'], 'fake.mp4', {
      type: 'video/mp4',
    });

    await expect(isGuidedVideoFile(disguisedImage)).resolves.toBe(false);
    await expect(isGuidedVideoFile(invalidVideo)).resolves.toBe(false);
    await expect(normalizeGuidedVideoFile(disguisedImage)).resolves.toBe(
      disguisedImage
    );
  });

  it('rejects image and unsupported file types', async () => {
    await expect(
      isGuidedVideoFile(
        new File(['image'], 'thumbnail.png', { type: 'image/png' })
      )
    ).resolves.toBe(false);
    await expect(
      isGuidedVideoFile(new File(['notes'], 'notes.txt', { type: 'text/plain' }))
    ).resolves.toBe(false);
  });

  it('accepts only MP4 and MOV assets from the video library', () => {
    const mp4 = createVideo('first', 'mp4');
    const mov = createVideo('second', 'mov');
    const webm = createVideo('unsupported', 'webm');
    const m4v = createVideo('unsupported-m4v', 'm4v');

    expect(isGuidedMp4MovMedia(mp4)).toBe(true);
    expect(isGuidedMp4MovMedia(mov)).toBe(true);
    expect(isGuidedMp4MovMedia(webm)).toBe(false);
    expect(isGuidedMp4MovMedia(m4v)).toBe(false);
    expect(selectGuidedSourceVideo([webm, m4v])).toBeUndefined();
    expect(selectGuidedSourceVideo([webm, mov, mp4])).toBe(mov);
  });

  it('uses only the first supported video from a multi-video library selection', () => {
    const first = createVideo('first');
    const second = createVideo('second');

    expect(selectGuidedSourceVideo([first, second])).toBe(first);
  });

  it('prefers the newly uploaded video when replacing an existing source', () => {
    const current = createVideo('current');
    const replacement = createVideo('replacement');

    expect(
      selectGuidedSourceVideo([current, replacement], current.id)
    ).toBe(replacement);
  });

  it('collapses repeated uploader results to the newest source video', () => {
    const current = createVideo('current');
    const replacement = createVideo('replacement');

    useLaunchStore.getState().addGlobalValue(0, [
      {
        id: 'post-1',
        content: '',
        delay: 0,
        media: [current],
      } as any,
    ]);

    const { unmount } = render(<GuidedComposerUploadDetails />);

    act(() => {
      useLaunchStore.getState().appendGlobalValueMedia(0, [replacement]);
    });

    expect(useLaunchStore.getState().global[0].media).toEqual([replacement]);
    unmount();
  });

  it('removes unsupported library video formats from the guided draft', () => {
    const webm = createVideo('unsupported', 'webm');

    useLaunchStore.getState().addGlobalValue(0, [
      {
        id: 'post-1',
        content: '',
        delay: 0,
        media: [webm],
      } as any,
    ]);

    const { unmount } = render(<GuidedComposerUploadDetails />);

    expect(useLaunchStore.getState().global[0].media).toEqual([]);
    unmount();
  });

  it('does not advertise image or unsupported video formats in the picker', () => {
    expect(GUIDED_VIDEO_ACCEPT).toContain('video/mp4');
    expect(GUIDED_VIDEO_ACCEPT).toContain('.mov');
    expect(GUIDED_VIDEO_ACCEPT).not.toContain('image/');
    expect(GUIDED_VIDEO_ACCEPT).not.toContain('webm');
  });

  it('shows only progress and cancellation from the real legacy upload-card structure', () => {
    const host = document.createElement('div');
    host.innerHTML = `
      <div class="guided-upload-existing-composer">
        <div id="social-content">
          <section>
            <div data-testid="legacy-heading">Upload media</div>
            <div data-testid="legacy-card">
              <input type="file" multiple />
              <div data-testid="legacy-controls">
                <div>
                  <button disabled>Choose files</button>
                  <button disabled>Media Library</button>
                  <button>Cancel upload</button>
                </div>
                <div>Drop files here or browse from your device.</div>
              </div>
              <div class="uppyChange" data-testid="legacy-progress">Progress</div>
              <div data-testid="legacy-media">Shared media</div>
            </div>
          </section>
        </div>
      </div>
    `;
    document.body.appendChild(host);

    const section = host.querySelector('section') as HTMLElement;
    const input = host.querySelector('input') as HTMLInputElement;
    const heading = host.querySelector(
      '[data-testid="legacy-heading"]'
    ) as HTMLElement;
    const choose = host.querySelector('button:nth-of-type(1)') as HTMLElement;
    const library = host.querySelector('button:nth-of-type(2)') as HTMLElement;
    const cancel = host.querySelector('button:nth-of-type(3)') as HTMLElement;
    const dropText = host.querySelector(
      '[data-testid="legacy-controls"] > div:last-child'
    ) as HTMLElement;
    const progress = host.querySelector(
      '[data-testid="legacy-progress"]'
    ) as HTMLElement;
    const media = host.querySelector(
      '[data-testid="legacy-media"]'
    ) as HTMLElement;

    const { rerender, unmount } = render(
      <GuidedComposerUploadDetails disabled={false} />
    );

    expect(section.style.display).toBe('none');
    expect(input.accept).toBe(GUIDED_VIDEO_ACCEPT);
    expect(input.multiple).toBe(false);

    rerender(<GuidedComposerUploadDetails disabled />);

    expect(section.style.display).toBe('');
    expect(section.classList.contains('guided-upload-progress-only')).toBe(true);
    expect(getComputedStyle(heading).display).toBe('none');
    expect(getComputedStyle(choose).display).toBe('none');
    expect(getComputedStyle(library).display).toBe('none');
    expect(getComputedStyle(dropText).display).toBe('none');
    expect(getComputedStyle(media).display).toBe('none');
    expect(getComputedStyle(cancel).display).not.toBe('none');
    expect(getComputedStyle(progress).display).not.toBe('none');

    unmount();
    expect(input.multiple).toBe(true);
    expect(section.classList.contains('guided-upload-progress-only')).toBe(false);
    host.remove();
  });
});
