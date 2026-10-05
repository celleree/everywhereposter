import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const mockFetch = jest.fn();
const mockMutate = jest.fn();
const mockIntegrations = Array.from({ length: 24 }, (_, index) => ({
  id: `integration-${index + 1}`,
  name: `Channel ${index + 1}`,
  identifier: ['instagram', 'youtube', 'tiktok'][index % 3],
  canListMedia: true,
}));

jest.mock('swr', () => ({
  __esModule: true,
  default: (key: string, fetcher: () => Promise<unknown>) => {
    const React = require('react');
    const [state, setState] = React.useState({
      data: undefined,
      error: undefined,
      isLoading: true,
    });
    const fetcherRef = React.useRef(fetcher);
    fetcherRef.current = fetcher;
    const load = React.useCallback(async () => {
      setState({ data: undefined, error: undefined, isLoading: true });
      try {
        const data = await fetcherRef.current();
        setState({ data, error: undefined, isLoading: false });
      } catch (error) {
        setState({ data: undefined, error, isLoading: false });
      }
    }, []);

    React.useEffect(() => {
      load();
    }, [key]);

    return { ...state, mutate: load };
  },
}));

jest.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () => mockFetch,
}));
jest.mock('@gitroom/frontend/components/layout/new-modal', () => ({
  useModals: () => ({ openModal: jest.fn(), closeCurrent: jest.fn() }),
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
  useUppyUploader: () => ({ addFiles: jest.fn(), addFile: jest.fn() }),
}));
jest.mock('@gitroom/frontend/components/layout/drop.files', () => ({
  DropFiles: ({
    children,
    className,
  }: React.HTMLAttributes<HTMLDivElement>) => (
    <div className={className}>{children}</div>
  ),
}));
jest.mock('@uppy/react', () => ({ Dashboard: () => null }));
jest.mock('@gitroom/react/helpers/video.frame', () => ({
  VideoFrame: () => <div data-testid="video-frame" />,
}));
jest.mock(
  '@gitroom/frontend/components/third-parties/third-party.media',
  () => ({
    ThirdPartyMedia: () => null,
  })
);
jest.mock(
  '@gitroom/frontend/components/third-parties/third-party.media-library',
  () => ({
    ThirdPartyMediaLibrary: () => null,
  })
);
jest.mock(
  '@gitroom/frontend/components/launches/helpers/media.settings.component',
  () => ({
    MediaComponentInner: () => null,
  })
);
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
jest.mock(
  '@gitroom/frontend/components/ui/icons',
  () => new Proxy({}, { get: () => () => null })
);
jest.mock(
  '@gitroom/frontend/components/launches/helpers/use.integration.list',
  () => ({
    useIntegrationList: () => ({ data: mockIntegrations }),
  })
);
jest.mock(
  '@gitroom/frontend/components/platform-analytics/platform.video.grid',
  () => ({
    PlatformVideoGrid: ({
      integration,
    }: {
      integration: { id: string; name: string };
    }) => (
      <div data-testid="platform-grid" data-integration={integration.id}>
        Grid for {integration.name}
      </div>
    ),
  })
);

import { MediaBox } from '../../apps/frontend/src/components/media/media.component';
import { MediaLayoutComponent } from '../../apps/frontend/src/components/new-layout/layout.media.component';

const response = (body: unknown, ok = true, status = 200) => ({
  ok,
  status,
  json: async () => body,
});

describe('main Media page', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockMutate.mockReset();
  });

  it('shows library media and preserves the posted-media source contract', async () => {
    mockFetch.mockImplementation((url: string) =>
      Promise.resolve(
        response({
          pages: 2,
          results: String(url).startsWith('/media/post-attached')
            ? [
                {
                  id: 'posted-1',
                  path: '/posted.jpg',
                  originalName: 'Posted fixture.jpg',
                  postedMedia: true,
                },
              ]
            : [
                {
                  id: 'library-1',
                  path: '/library.jpg',
                  originalName: 'Library fixture.jpg',
                },
              ],
        })
      )
    );

    render(<MediaLayoutComponent />);

    expect(await screen.findByText('Library fixture.jpg')).not.toBeNull();
    expect(screen.queryByText('Connected Platform Videos')).toBeNull();
    fireEvent.click(screen.getByText('2'));
    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith('/media?page=2')
    );
    fireEvent.click(screen.getByRole('button', { name: 'Posted Media' }));

    expect(await screen.findByText('Posted fixture.jpg')).not.toBeNull();
    expect(mockFetch).toHaveBeenCalledWith('/media/post-attached?page=1');
    expect(screen.getByText('Connected Platform Videos')).not.toBeNull();
    expect(
      screen.getByRole('combobox', { name: 'Connected account' })
    ).not.toBeNull();
  });

  it('keeps a valid empty library distinct from a failed request', async () => {
    mockFetch.mockResolvedValue(response({ pages: 0, results: [] }));

    render(<MediaBox standalone setMedia={jest.fn()} closeModal={jest.fn()} />);

    expect(
      await screen.findByText("You don't have any media yet")
    ).not.toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows a retryable error for a failed response instead of a false empty state', async () => {
    mockFetch
      .mockResolvedValueOnce(response({ message: 'Unavailable' }, false, 503))
      .mockResolvedValueOnce(
        response({
          pages: 1,
          results: [
            {
              id: 'library-retry',
              path: '/retry.jpg',
              originalName: 'Recovered fixture.jpg',
            },
          ],
        })
      );

    render(<MediaBox standalone setMedia={jest.fn()} closeModal={jest.fn()} />);

    expect((await screen.findByRole('alert')).textContent).toContain(
      'Media could not be loaded'
    );
    expect(screen.queryByText("You don't have any media yet")).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('Recovered fixture.jpg')).not.toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('keeps many connected accounts in one compact accessible selector', async () => {
    mockFetch.mockResolvedValue(response({ pages: 1, results: [] }));
    render(<MediaLayoutComponent />);
    fireEvent.click(screen.getByRole('button', { name: 'Posted Media' }));

    const selector = await screen.findByRole('combobox', {
      name: 'Connected account',
    });
    expect(screen.getAllByRole('option')).toHaveLength(24);
    expect(
      screen.getByTestId('platform-grid').getAttribute('data-integration')
    ).toBe('integration-1');

    fireEvent.change(selector, { target: { value: 'integration-24' } });
    await waitFor(() =>
      expect(
        screen.getByTestId('platform-grid').getAttribute('data-integration')
      ).toBe('integration-24')
    );
    expect(
      screen.queryByText(/Browse videos that were already published/)
    ).toBeNull();
  });
});
