import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

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
  GUIDED_MEDIA_ACCEPT,
  GUIDED_VIDEO_ACCEPT,
  GuidedComposerUploadDetails,
  isGuidedMp4MovMedia,
  isGuidedVideoFile,
  normalizeGuidedVideoFile,
  selectGuidedSourceVideo,
  validateGuidedVideoFile,
} from '../../apps/frontend/src/components/new-launch/guided.composer.upload.details';
import {
  canBrowserDecodeVideo,
  resolveUploadFileType,
} from '../../apps/frontend/src/components/media/upload.file.type';
import { useGuidedComposerStore } from '../../apps/frontend/src/components/new-launch/guided.composer.store';
import { useLaunchStore } from '../../apps/frontend/src/components/new-launch/store';

const encodeAscii = (value: string) =>
  new Uint8Array(
    Array.from(value).map((character) => character.charCodeAt(0))
  );

const encodeUint16 = (value: number) =>
  new Uint8Array([(value >>> 8) & 0xff, value & 0xff]);

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

const VIDEO_SAMPLE_BYTES = new Uint8Array([0, 0, 0, 1, 0x65]);
const AUDIO_SAMPLE_BYTES = new Uint8Array([0x21, 0x10, 0x56, 0xe5]);

const createVisualSampleEntry = (
  type = 'avc1',
  includeCodecConfig = true
) => {
  const baseEntry = new Uint8Array(86);
  const codecConfig = includeCodecConfig
    ? createBox(
        'avcC',
        new Uint8Array([
          1,
          0x42,
          0,
          0x1e,
          0xff,
          0xe1,
          0,
          2,
          0x67,
          0x42,
          1,
          0,
          2,
          0x68,
          0xce,
        ])
      )
    : new Uint8Array();
  const entry = concatBytes(baseEntry, codecConfig);

  entry.set(encodeUint32(entry.length), 0);
  entry.set(encodeAscii(type), 4);
  entry.set(encodeUint16(1), 14);
  entry.set(encodeUint16(1920), 32);
  entry.set(encodeUint16(1080), 34);
  entry.set(encodeUint32(0x00480000), 36);
  entry.set(encodeUint32(0x00480000), 40);
  entry.set(encodeUint16(1), 48);
  entry.set(encodeUint16(24), 82);
  entry.set(encodeUint16(0xffff), 84);

  return entry;
};

const createAudioSampleEntry = () => {
  const entry = new Uint8Array(36);

  entry.set(encodeUint32(entry.length), 0);
  entry.set(encodeAscii('mp4a'), 4);
  entry.set(encodeUint16(1), 14);
  entry.set(encodeUint16(2), 24);
  entry.set(encodeUint16(16), 26);
  entry.set(encodeUint32(48_000 << 16), 32);

  return entry;
};

const createSampleTable = (
  chunkOffset: number,
  includeCodecConfig = true,
  sampleSize = VIDEO_SAMPLE_BYTES.length,
  sampleEntry = createVisualSampleEntry('avc1', includeCodecConfig)
) => {
  const stsd = createBox(
    'stsd',
    new Uint8Array(4),
    encodeUint32(1),
    sampleEntry
  );
  const stts = createBox(
    'stts',
    new Uint8Array(4),
    encodeUint32(1),
    encodeUint32(1),
    encodeUint32(1)
  );
  const stsc = createBox(
    'stsc',
    new Uint8Array(4),
    encodeUint32(1),
    encodeUint32(1),
    encodeUint32(1),
    encodeUint32(1)
  );
  const stsz = createBox(
    'stsz',
    new Uint8Array(4),
    encodeUint32(0),
    encodeUint32(1),
    encodeUint32(sampleSize)
  );
  const stco = createBox(
    'stco',
    new Uint8Array(4),
    encodeUint32(1),
    encodeUint32(chunkOffset)
  );

  return createBox('stbl', stsd, stts, stsc, stsz, stco);
};

const createIsoBmffBytes = (
  brand: string,
  compatibleBrand = brand,
  handlerType = 'vide',
  includeVideoSamples = true,
  includeCodecConfig = true,
  includeAudioTrack = handlerType === 'vide',
  includeAudioSamples = includeAudioTrack
) => {
  const ftyp = createBox(
    'ftyp',
    encodeAscii(brand),
    new Uint8Array(4),
    encodeAscii(compatibleBrand)
  );
  const mdat = includeVideoSamples
    ? createBox(
        'mdat',
        VIDEO_SAMPLE_BYTES,
        ...(includeAudioTrack && includeAudioSamples
          ? [AUDIO_SAMPLE_BYTES]
          : [])
      )
    : undefined;
  const hdlr = createBox(
    'hdlr',
    new Uint8Array(8),
    encodeAscii(handlerType)
  );
  const sampleTable = includeVideoSamples
    ? createSampleTable(ftyp.length + 8, includeCodecConfig)
    : undefined;
  const minf = sampleTable ? createBox('minf', sampleTable) : undefined;
  const mdia = createBox('mdia', hdlr, ...(minf ? [minf] : []));
  const audioSampleTable =
    includeAudioTrack && includeAudioSamples
      ? createSampleTable(
          ftyp.length + 8 + VIDEO_SAMPLE_BYTES.length,
          true,
          AUDIO_SAMPLE_BYTES.length,
          createAudioSampleEntry()
        )
      : undefined;
  const audioTrack = includeAudioTrack
    ? createBox(
        'trak',
        createBox(
          'mdia',
          createBox('hdlr', new Uint8Array(8), encodeAscii('soun')),
          ...(audioSampleTable
            ? [createBox('minf', audioSampleTable)]
            : [])
        )
      )
    : undefined;
  const moov = createBox(
    'moov',
    createBox('trak', mdia),
    ...(audioTrack ? [audioTrack] : [])
  );

  return concatBytes(ftyp, ...(mdat ? [mdat] : []), moov);
};

const createTrackHeader = (trackId: number) => {
  const payload = new Uint8Array(16);
  payload.set(encodeUint32(trackId), 12);
  return createBox('tkhd', payload);
};

const createFragmentTrack = (
  trackId: number,
  handlerType: 'vide' | 'soun'
) => {
  const mediaChildren = [
    createBox('hdlr', new Uint8Array(8), encodeAscii(handlerType)),
  ];

  if (handlerType === 'vide') {
    mediaChildren.push(
      createBox(
        'minf',
        createBox(
          'stbl',
          createBox(
            'stsd',
            new Uint8Array(4),
            encodeUint32(1),
            createVisualSampleEntry()
          )
        )
      )
    );
  }

  return createBox(
    'trak',
    createTrackHeader(trackId),
    createBox('mdia', ...mediaChildren)
  );
};

const createFragment = (
  trackId: number,
  dataOffset: number,
  sampleSize: number
) =>
  createBox(
    'traf',
    createBox('tfhd', new Uint8Array(4), encodeUint32(trackId)),
    createBox(
      'trun',
      new Uint8Array([0, 0, 2, 1]),
      encodeUint32(1),
      encodeUint32(dataOffset),
      encodeUint32(sampleSize)
    )
  );

const createFragmentedMp4 = (
  includeAudioFragment: boolean,
  audioTrackId = 2
) => {
  const ftyp = createBox(
    'ftyp',
    encodeAscii('isom'),
    new Uint8Array(4),
    encodeAscii('mp42')
  );
  const moov = createBox(
    'moov',
    createFragmentTrack(1, 'vide'),
    createFragmentTrack(audioTrackId, 'soun')
  );
  const createMoof = (videoOffset: number, audioOffset: number) =>
    createBox(
      'moof',
      createFragment(1, videoOffset, VIDEO_SAMPLE_BYTES.length),
      ...(includeAudioFragment
        ? [createFragment(audioTrackId, audioOffset, AUDIO_SAMPLE_BYTES.length)]
        : [])
    );
  const placeholderMoof = createMoof(0, 0);
  const moofStart = ftyp.length + moov.length;
  const mediaDataStart = moofStart + placeholderMoof.length + 8;
  const moof = createMoof(
    mediaDataStart - moofStart,
    mediaDataStart - moofStart + VIDEO_SAMPLE_BYTES.length
  );
  const mdat = createBox(
    'mdat',
    VIDEO_SAMPLE_BYTES,
    ...(includeAudioFragment ? [AUDIO_SAMPLE_BYTES] : [])
  );

  return new File([concatBytes(ftyp, moov, moof, mdat)], 'fragmented.mp4', {
    type: 'video/mp4',
  });
};

const createMp4File = (
  name = 'demo.mp4',
  type = 'video/mp4',
  brand = 'isom',
  includeAudioTrack = true
) =>
  new File(
    [createIsoBmffBytes(brand, 'mp42', 'vide', true, true, includeAudioTrack)],
    name,
    { type }
  );

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

  it('accepts supported MP4 and MOV files with real video samples', async () => {
    await expect(isGuidedVideoFile(createMp4File())).resolves.toBe(true);
    await expect(isGuidedVideoFile(createMovFile())).resolves.toBe(true);
    await expect(
      isGuidedVideoFile(createMovFile('demo.MOV', ''))
    ).resolves.toBe(true);
  });

  it('normalizes extension-only videos only after their sample data validates', async () => {
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

  it('rejects a header-only vide track without sample tables or media data', async () => {
    const headerOnly = new File(
      [createIsoBmffBytes('isom', 'mp42', 'vide', false)],
      'header-only.mp4',
      { type: 'application/octet-stream' }
    );

    await expect(isGuidedVideoFile(headerOnly)).resolves.toBe(false);
    await expect(resolveUploadFileType(headerOnly)).resolves.toBe(
      'application/octet-stream'
    );
  });

  it('rejects sample metadata without the required codec configuration', async () => {
    const missingCodecConfig = new File(
      [createIsoBmffBytes('isom', 'mp42', 'vide', true, false)],
      'missing-codec-config.mp4',
      { type: 'application/octet-stream' }
    );

    await expect(isGuidedVideoFile(missingCodecConfig)).resolves.toBe(false);
    await expect(resolveUploadFileType(missingCodecConfig)).resolves.toBe(
      'application/octet-stream'
    );
  });

  it('rejects a structurally valid file when the browser decoder cannot load a frame', async () => {
    const originalCreateObjectUrl = Object.getOwnPropertyDescriptor(
      URL,
      'createObjectURL'
    );
    const originalRevokeObjectUrl = Object.getOwnPropertyDescriptor(
      URL,
      'revokeObjectURL'
    );
    const video = document.createElement('video');
    const createElementSpy = jest
      .spyOn(document, 'createElement')
      .mockReturnValueOnce(video);

    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: jest.fn(() => 'blob:decoder-test'),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: jest.fn(),
    });
    Object.defineProperty(video, 'load', {
      configurable: true,
      value: () => video.onerror?.(new Event('error')),
    });

    try {
      await expect(
        canBrowserDecodeVideo(new Blob(['invalid']), 'video/mp4')
      ).resolves.toBe(false);
    } finally {
      createElementSpy.mockRestore();

      if (originalCreateObjectUrl) {
        Object.defineProperty(URL, 'createObjectURL', originalCreateObjectUrl);
      } else {
        delete (URL as typeof URL & { createObjectURL?: unknown })
          .createObjectURL;
      }

      if (originalRevokeObjectUrl) {
        Object.defineProperty(URL, 'revokeObjectURL', originalRevokeObjectUrl);
      } else {
        delete (URL as typeof URL & { revokeObjectURL?: unknown })
          .revokeObjectURL;
      }
    }
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

  it('requires an audio track separately from valid video structure', async () => {
    const videoOnly = createMp4File(
      'video-only.mp4',
      'application/octet-stream',
      'isom',
      false
    );

    await expect(validateGuidedVideoFile(videoOnly)).resolves.toBe(
      'audio-required'
    );
    await expect(isGuidedVideoFile(videoOnly)).resolves.toBe(false);
    await expect(resolveUploadFileType(videoOnly)).resolves.toBe('video/mp4');
  });

  it('rejects a handler-only audio track as audio-required', async () => {
    const handlerOnlyAudio = new File(
      [
        createIsoBmffBytes(
          'isom',
          'mp42',
          'vide',
          true,
          true,
          true,
          false
        ),
      ],
      'handler-only-audio.mp4',
      { type: 'video/mp4' }
    );

    await expect(validateGuidedVideoFile(handlerOnlyAudio)).resolves.toBe(
      'audio-required'
    );
  });

  it('accepts fragmented video with a nonzero audio fragment sample', async () => {
    await expect(
      validateGuidedVideoFile(createFragmentedMp4(true))
    ).resolves.toBe('valid');
  });

  it('rejects fragmented video with only a nominal audio track', async () => {
    await expect(
      validateGuidedVideoFile(createFragmentedMp4(false))
    ).resolves.toBe('audio-required');
  });

  it('rejects fragmented media with duplicate video and audio track IDs', async () => {
    await expect(
      validateGuidedVideoFile(createFragmentedMp4(false, 1))
    ).resolves.toBe('invalid');
  });

  it('does not accept a zero-ID audio fragment as real audio', async () => {
    await expect(
      validateGuidedVideoFile(createFragmentedMp4(true, 0))
    ).resolves.toBe('audio-required');
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

  it('does not collapse mixed media or repeated uploader results', () => {
    const current = createVideo('current');
    const replacement = createVideo('replacement');
    const image = {
      id: 'image',
      path: 'https://media.example.com/image.png',
      type: 'image',
    };

    useLaunchStore.getState().addGlobalValue(0, [
      {
        id: 'post-1',
        content: '',
        delay: 0,
        media: [image, current],
      } as any,
    ]);

    const { unmount } = render(<GuidedComposerUploadDetails />);

    act(() => {
      useLaunchStore.getState().appendGlobalValueMedia(0, [replacement]);
    });

    expect(useLaunchStore.getState().global[0].media).toEqual([
      image,
      current,
      replacement,
    ]);
    unmount();
  });

  it('does not remove image or unsupported video media from the guided draft', () => {
    const webm = createVideo('unsupported', 'webm');
    const image = {
      id: 'image',
      path: 'https://media.example.com/image.png',
      type: 'image',
    };

    useLaunchStore.getState().addGlobalValue(0, [
      {
        id: 'post-1',
        content: '',
        delay: 0,
        media: [image, webm],
      } as any,
    ]);

    const { unmount } = render(<GuidedComposerUploadDetails />);

    expect(useLaunchStore.getState().global[0].media).toEqual([image, webm]);
    unmount();
  });

  it('does not mutate an image-only draft when guided details mount', () => {
    const image = {
      id: 'image-only',
      path: 'https://media.example.com/image-only.png',
      type: 'image',
    };
    useLaunchStore.getState().addGlobalValue(0, [
      {
        id: 'post-1',
        content: '',
        delay: 0,
        media: [image],
      } as any,
    ]);
    const originalMedia = useLaunchStore.getState().global[0].media;

    const { unmount } = render(<GuidedComposerUploadDetails />);

    expect(useLaunchStore.getState().global[0].media).toEqual(originalMedia);
    unmount();
  });

  it('passes image files through the guided input unchanged', () => {
    const host = document.createElement('div');
    host.innerHTML = `
      <div class="guided-upload-existing-composer">
        <div id="social-content">
          <section data-guided-composer-section="media">
            <div></div>
            <div><input type="file" multiple /></div>
          </section>
        </div>
      </div>
    `;
    document.body.appendChild(host);
    const input = host.querySelector('input') as HTMLInputElement;
    const image = new File(['image'], 'photo.png', { type: 'image/png' });
    const forwarded = jest.fn();
    input.addEventListener('change', () => forwarded(input.files?.[0]));
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [image],
    });

    const { unmount } = render(<GuidedComposerUploadDetails />);
    input.dispatchEvent(new Event('change', { bubbles: true }));

    expect(forwarded).toHaveBeenCalledWith(image);
    expect(input.files?.[0]).toBe(image);
    unmount();
    host.remove();
  });

  it('rejects unsupported video files in the guided input', async () => {
    const host = document.createElement('div');
    host.innerHTML = `
      <div class="guided-upload-existing-composer">
        <div id="social-content">
          <section data-guided-composer-section="media">
            <div></div>
            <div><input type="file" multiple /></div>
          </section>
        </div>
      </div>
    `;
    document.body.appendChild(host);
    const input = host.querySelector('input') as HTMLInputElement;
    const unsupportedVideo = new File(['video'], 'clip.webm', {
      type: 'video/webm',
    });
    const forwarded = jest.fn();
    input.addEventListener('change', forwarded);
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [unsupportedVideo],
    });
    Object.defineProperty(input, 'value', {
      configurable: true,
      writable: true,
      value: 'clip.webm',
    });

    const { unmount } = render(<GuidedComposerUploadDetails />);
    input.dispatchEvent(new Event('change', { bubbles: true }));

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain(
        'Only valid MP4 and MOV video files can be uploaded here.'
      )
    );
    expect(input.value).toBe('');
    expect(forwarded).not.toHaveBeenCalled();
    unmount();
    host.remove();
  });

  it('shows the audio-required error for a video-only guided upload', async () => {
    const host = document.createElement('div');
    host.innerHTML = `
      <div class="guided-upload-existing-composer">
        <div id="social-content">
          <section data-guided-composer-section="media">
            <div></div>
            <div><input type="file" multiple /></div>
          </section>
        </div>
      </div>
    `;
    document.body.appendChild(host);
    const input = host.querySelector('input') as HTMLInputElement;
    const videoOnly = createMp4File(
      'video-only.mp4',
      'video/mp4',
      'isom',
      false
    );
    const forwarded = jest.fn();
    input.addEventListener('change', forwarded);
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [videoOnly],
    });
    Object.defineProperty(input, 'value', {
      configurable: true,
      writable: true,
      value: 'video-only.mp4',
    });

    const { unmount } = render(<GuidedComposerUploadDetails />);
    input.dispatchEvent(new Event('change', { bubbles: true }));

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain(
        'An audio track is required for guided video creation.'
      )
    );
    expect(input.value).toBe('');
    expect(forwarded).not.toHaveBeenCalled();
    unmount();
    host.remove();
  });

  it('does not replay stale picker validation over a newer selection', async () => {
    const host = document.createElement('div');
    host.innerHTML = `
      <div class="guided-upload-existing-composer">
        <div id="social-content">
          <section data-guided-composer-section="media">
            <div></div>
            <div><input type="file" multiple /></div>
          </section>
        </div>
      </div>
    `;
    document.body.appendChild(host);
    const input = host.querySelector('input') as HTMLInputElement;
    const firstVideo = createMp4File('first.mp4');
    const secondVideo = createMp4File('second.mp4');
    const originalSlice = firstVideo.slice.bind(firstVideo);
    let releaseFirstValidation: (() => void) | undefined;
    const firstValidationGate = new Promise<void>((resolve) => {
      releaseFirstValidation = resolve;
    });
    let delayNextRead = true;

    Object.defineProperty(firstVideo, 'slice', {
      configurable: true,
      value: (...args: Parameters<Blob['slice']>) => {
        const sliced = originalSlice(...args);
        if (delayNextRead) {
          delayNextRead = false;
          const readOriginalSlice = () =>
            new Promise<ArrayBuffer>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result as ArrayBuffer);
              reader.onerror = () => reject(reader.error);
              reader.readAsArrayBuffer(sliced);
            });
          Object.defineProperty(sliced, 'arrayBuffer', {
            configurable: true,
            value: async () => {
              await firstValidationGate;
              return readOriginalSlice();
            },
          });
        }
        return sliced;
      },
    });

    let currentFiles: File[] = [firstVideo];
    Object.defineProperty(input, 'files', {
      configurable: true,
      get: () => currentFiles,
    });
    const forwarded = jest.fn(() => input.files?.[0]);
    input.addEventListener('change', forwarded);

    const { unmount } = render(<GuidedComposerUploadDetails />);
    input.dispatchEvent(new Event('change', { bubbles: true }));
    currentFiles = [secondVideo];
    input.dispatchEvent(new Event('change', { bubbles: true }));

    await waitFor(() => expect(forwarded).toHaveBeenCalledTimes(1));
    expect(forwarded.mock.results[0].value).toBe(secondVideo);

    await act(async () => {
      releaseFirstValidation?.();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(forwarded).toHaveBeenCalledTimes(1);

    unmount();
    host.remove();
  });

  it('shows video controls only for supported video drafts', () => {
    useLaunchStore.getState().addGlobalValue(0, [
      {
        id: 'post-1',
        content: '',
        delay: 0,
        media: [createVideo('source')],
      } as any,
    ]);
    useGuidedComposerStore.setState({
      sourceMediaId: 'source',
      transcriptionStatus: 'READY',
    });

    const { rerender, unmount } = render(
      <GuidedComposerUploadDetails />
    );

    expect(screen.getByLabelText('Additional context')).toBeTruthy();
    expect(
      screen.getByRole('radio', { name: /Create captions for me/ })
    ).toBeTruthy();
    expect(
      screen.getByRole('radio', { name: /Use my caption on every platform/ })
    ).toBeTruthy();
    expect(
      screen.getByRole('radio', { name: /Adapt my caption for each platform/ })
    ).toBeTruthy();
    expect(screen.queryByLabelText('Your caption')).toBeNull();

    fireEvent.click(
      screen.getByRole('radio', { name: /Use my caption on every platform/ })
    );
    expect(screen.getByLabelText('Your caption')).toBeTruthy();

    useLaunchStore.getState().setGlobalValueMedia(0, [
      {
        id: 'image-only',
        path: 'https://media.example.com/image-only.png',
        type: 'image',
      } as any,
    ]);
    rerender(<GuidedComposerUploadDetails />);
    expect(screen.queryByLabelText('Additional context')).toBeNull();
    expect(screen.queryByRole('radio', { name: /Create captions for me/ })).toBeNull();
    expect(screen.queryByLabelText('Your caption')).toBeNull();

    useLaunchStore.getState().setGlobalValueMedia(0, []);
    rerender(<GuidedComposerUploadDetails />);
    expect(screen.queryByLabelText('Additional context')).toBeNull();
    expect(screen.queryByRole('radio', { name: /Adapt my caption for each platform/ })).toBeNull();
    expect(screen.queryByLabelText('Your caption')).toBeNull();
    unmount();
  });

  it('advertises images and supported video formats in the shared picker', () => {
    expect(GUIDED_MEDIA_ACCEPT).toContain('image/*');
    expect(GUIDED_MEDIA_ACCEPT).toContain('video/mp4');
    expect(GUIDED_MEDIA_ACCEPT).toContain('.mov');
    expect(GUIDED_MEDIA_ACCEPT).not.toContain('webm');
    expect(GUIDED_VIDEO_ACCEPT).not.toContain('image/');
  });

  it('shows only progress and cancellation from the real legacy upload-card structure', () => {
    const host = document.createElement('div');
    host.innerHTML = `
      <div class="guided-upload-existing-composer">
        <div id="social-content">
          <section data-guided-composer-section="media">
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

    expect(section.style.display).toBe('');
    expect(input.accept).toBe(GUIDED_MEDIA_ACCEPT);
    expect(input.multiple).toBe(true);

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
