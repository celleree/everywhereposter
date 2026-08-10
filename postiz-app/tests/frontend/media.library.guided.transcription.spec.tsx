import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const mockFetch = jest.fn();
const mockCloseCurrent = jest.fn();
const mockMutate = jest.fn();
let mockLibraryMedia = {
  id: 'library-video-1',
  path: 'https://media.example.com/library-video-1',
  originalName: 'library-video-1.mp4',
  type: 'video',
};

jest.mock('swr', () => ({
  __esModule: true,
  default: () => ({
    data: {
      pages: 1,
      results: [mockLibraryMedia],
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
    mockLibraryMedia = {
      id: 'library-video-1',
      path: 'https://media.example.com/library-video-1',
      originalName: 'library-video-1.mp4',
      type: 'video',
    };
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
    mockLibraryMedia = {
      id: 'library-video-2',
      path: 'https://media.example.com/library-video-2',
      originalName: 'library-video-2.mov',
      type: 'video',
    };
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

  it('does not ensure media in normal library mode', async () => {
    const setMedia = jest.fn();

    render(<MediaBox setMedia={setMedia} closeModal={jest.fn()} />);

    fireEvent.click(screen.getByText('library-video-1.mp4'));
    fireEvent.click(screen.getByRole('button', { name: 'Add selected media' }));

    await waitFor(() => expect(setMedia).toHaveBeenCalled());
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
