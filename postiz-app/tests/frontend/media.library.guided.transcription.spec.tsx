import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const mockFetch = jest.fn();
const mockCloseCurrent = jest.fn();
const mockMutate = jest.fn();
let mockLibraryMedia = [
  {
    id: 'library-video-1',
    path: 'https://media.example.com/library-video-1',
    originalName: 'library-video-1.mp4',
    type: 'video',
  },
];

jest.mock('swr', () => ({
  __esModule: true,
  default: () => ({
    data: {
      pages: 1,
      results: mockLibraryMedia,
    },
    isLoading: false,
    mutate: mockMutate,
  }),
}));

jest.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () => mockFetch,
}));

jest.mock('@gitroom/frontend/components/layout/new-modal', () => ({
  useModals: () => ({ closeCurrent: mockCloseCurrent }),
}));

jest.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}));

jest.mock('@gitroom/react/helpers/use.media.directory', () => ({
  useMediaDirectory: () => ({ set: (path: string) => path }),
}));

jest.mock('@gitroom/react/toaster/toaster', () => ({
  useToaster: () => ({ show: jest.fn() }),
}));

jest.mock('@gitroom/frontend/components/media/new.uploader', () => ({
  useUppyUploader: () => ({
    addFiles: jest.fn(),
  }),
}));

jest.mock('@gitroom/frontend/components/layout/drop.files', () => ({
  DropFiles: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

jest.mock('@uppy/react', () => ({ Dashboard: () => null }));
jest.mock('@gitroom/react/helpers/video.frame', () => ({
  VideoFrame: () => null,
}));
jest.mock('@gitroom/frontend/components/third-parties/third-party.media', () => ({
  ThirdPartyMedia: () => null,
}));
jest.mock('@gitroom/frontend/components/third-parties/third-party.media-library', () => ({
  ThirdPartyMediaLibrary: () => null,
}));
jest.mock('@gitroom/frontend/components/launches/helpers/media.settings.component', () => ({
  MediaComponentInner: () => null,
}));
jest.mock('@gitroom/frontend/components/launches/ai.image', () => ({
  AiImage: () => null,
}));
jest.mock('@gitroom/frontend/components/launches/ai.video', () => ({
  AiVideo: () => null,
}));
jest.mock('@gitroom/frontend/components/layout/user.context', () => ({
  useUser: () => null,
}));
jest.mock('@gitroom/react/helpers/delete.dialog', () => ({
  deleteDialog: jest.fn(),
}));
jest.mock('@gitroom/frontend/components/ui/icons', () => new Proxy({}, {
  get: () => () => null,
}));

import { MediaBox } from '../../apps/frontend/src/components/media/media.component';

describe('MediaBox guided transcription', () => {
  beforeEach(() => {
    mockLibraryMedia = [
      {
        id: 'library-video-1',
        path: 'https://media.example.com/library-video-1',
        originalName: 'library-video-1.mp4',
        type: 'video',
      },
    ];
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({ ok: true });
    mockCloseCurrent.mockReset();
    mockMutate.mockReset();
  });

  it('ensures an existing guided MP4 before returning it to the composer', async () => {
    const setMedia = jest.fn();

    render(
      <MediaBox
        setMedia={setMedia}
        closeModal={jest.fn()}
        guidedTranscription
      />
    );

    fireEvent.click(screen.getByText('library-video-1.mp4'));
    fireEvent.click(screen.getByRole('button', { name: 'Add selected media' }));

    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith(
        '/media/library-video-1/transcription/ensure',
        { method: 'POST' }
      )
    );
    expect(setMedia).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'library-video-1' }),
    ]);
  });

  it('ensures an existing guided MOV before returning it to the composer', async () => {
    mockLibraryMedia = [
      {
        id: 'library-video-2',
        path: 'https://media.example.com/library-video-2',
        originalName: 'library-video-2.mov',
        type: 'video',
      },
    ];
    const setMedia = jest.fn();

    render(
      <MediaBox
        setMedia={setMedia}
        closeModal={jest.fn()}
        guidedTranscription
      />
    );

    fireEvent.click(screen.getByText('library-video-2.mov'));
    fireEvent.click(screen.getByRole('button', { name: 'Add selected media' }));

    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith(
        '/media/library-video-2/transcription/ensure',
        { method: 'POST' }
      )
    );
  });

  it('allows only images and MP4/MOV videos in guided library mode', async () => {
    mockLibraryMedia = [
      {
        id: 'library-image',
        path: 'https://media.example.com/library-image.png',
        originalName: 'library-image.png',
        type: 'image',
      },
      {
        id: 'library-mp4',
        path: 'https://media.example.com/library-mp4.mp4',
        originalName: 'library-mp4.mp4',
        type: 'video',
      },
      {
        id: 'library-mov',
        path: 'https://media.example.com/library-mov.mov',
        originalName: 'library-mov.mov',
        type: 'video',
      },
      {
        id: 'library-webm',
        path: 'https://media.example.com/library-webm.webm',
        originalName: 'library-webm.webm',
        type: 'video',
      },
      {
        id: 'library-m4v',
        path: 'https://media.example.com/library-m4v.m4v',
        originalName: 'library-m4v.m4v',
        type: 'video',
      },
    ];
    const setMedia = jest.fn();

    render(
      <MediaBox
        setMedia={setMedia}
        closeModal={jest.fn()}
        guidedTranscription
      />
    );

    expect(screen.queryByText('library-webm.webm')).toBeNull();
    expect(screen.queryByText('library-m4v.m4v')).toBeNull();
    fireEvent.click(screen.getByText('library-image.png'));
    fireEvent.click(screen.getByText('library-mp4.mp4'));
    fireEvent.click(screen.getByText('library-mov.mov'));
    fireEvent.click(screen.getByRole('button', { name: 'Add selected media' }));

    await waitFor(() =>
      expect(setMedia).toHaveBeenCalledWith([
        expect.objectContaining({ id: 'library-image' }),
        expect.objectContaining({ id: 'library-mp4' }),
        expect.objectContaining({ id: 'library-mov' }),
      ])
    );
  });

  it('preserves unsupported video selection in normal library mode', async () => {
    mockLibraryMedia = [
      {
        id: 'library-webm',
        path: 'https://media.example.com/library-webm.webm',
        originalName: 'library-webm.webm',
        type: 'video',
      },
      {
        id: 'library-m4v',
        path: 'https://media.example.com/library-m4v.m4v',
        originalName: 'library-m4v.m4v',
        type: 'video',
      },
    ];
    const setMedia = jest.fn();

    render(<MediaBox setMedia={setMedia} closeModal={jest.fn()} />);

    fireEvent.click(screen.getByText('library-webm.webm'));
    fireEvent.click(screen.getByText('library-m4v.m4v'));
    fireEvent.click(screen.getByRole('button', { name: 'Add selected media' }));

    await waitFor(() =>
      expect(setMedia).toHaveBeenCalledWith([
        expect.objectContaining({ id: 'library-webm' }),
        expect.objectContaining({ id: 'library-m4v' }),
      ])
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
