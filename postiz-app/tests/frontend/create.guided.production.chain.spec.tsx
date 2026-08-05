import React from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';

dayjs.extend(utc);

let mockIntegrationSnapshot: any[] = [];

jest.mock(
  '@gitroom/frontend/components/launches/helpers/use.integration.list',
  () => {
    const ReactModule = require('react');

    return {
      useIntegrationList: () => {
        const [data, setData] = ReactModule.useState(mockIntegrationSnapshot);
        const mutate = ReactModule.useCallback(async () => {
          const nextIntegrations = mockIntegrationSnapshot.map(
            (integration: any) => ({ ...integration })
          );

          setData(nextIntegrations);
          return nextIntegrations;
        }, []);

        return {
          data,
          isLoading: false,
          mutate,
        };
      },
    };
  }
);

jest.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () => jest.fn(),
}));

jest.mock(
  '@gitroom/react/translation/get.transation.service.client',
  () => ({
    useT: () => (_key: string, fallback: string) => fallback,
  })
);

jest.mock('@gitroom/frontend/components/layout/loading', () => {
  const ReactModule = require('react');

  return {
    LoadingComponent: () => ReactModule.createElement('div', null, 'Loading'),
  };
});

jest.mock(
  '@gitroom/frontend/components/launches/add.provider.component',
  () => {
    const ReactModule = require('react');

    return {
      AddProviderButton: ({ update }: { update: () => void }) =>
        ReactModule.createElement(
          'button',
          {
            type: 'button',
            onClick: () => update(),
          },
          'Connect account'
        ),
    };
  }
);

jest.mock('swr', () => ({
  __esModule: true,
  default: (key: string) => ({
    data:
      key === 'create-find-slot'
        ? '2026-08-05T12:00:00.000Z'
        : [],
    isLoading: false,
  }),
}));

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

jest.mock('@gitroom/nestjs-libraries/services/make.is', () => ({
  makeId: () => 'production-chain-post-id',
}));

jest.mock(
  '@gitroom/frontend/components/launches/helpers/use.existing.data',
  () => ({
    useExistingData: () => ({}),
  })
);

jest.mock('@gitroom/frontend/components/layout/set.timezone', () => ({
  newDayjs: () => require('dayjs')('2026-08-05T12:00:00Z'),
}));

jest.mock('@gitroom/frontend/components/new-launch/manage.modal', () => {
  const ReactModule = require('react');

  return {
    ManageModal: () =>
      ReactModule.createElement(
        'div',
        { 'data-testid': 'manage-modal' },
        'Manage modal'
      ),
  };
});

jest.mock(
  '@gitroom/frontend/components/new-launch/guided.composer.upload.details',
  () => {
    const ReactModule = require('react');

    return {
      GuidedComposerUploadDetails: () =>
        ReactModule.createElement(
          'div',
          { 'data-testid': 'guided-upload-details' },
          'Upload details'
        ),
    };
  }
);

jest.mock('@gitroom/react/helpers/image.with.fallback', () => {
  const ReactModule = require('react');

  return {
    __esModule: true,
    default: ({ src, fallbackSrc, alt, ...props }: any) => {
      const [currentSrc, setCurrentSrc] = ReactModule.useState(src);

      return ReactModule.createElement('img', {
        ...props,
        alt,
        src: currentSrc,
        onError: () => setCurrentSrc(fallbackSrc),
      });
    },
  };
});

import { CreateComponent } from '../../apps/frontend/src/components/create/create.component';
import { useGuidedComposerStore } from '../../apps/frontend/src/components/new-launch/guided.composer.store';
import { useLaunchStore } from '../../apps/frontend/src/components/new-launch/store';

const connectedInstagram = {
  id: 'instagram-account',
  name: 'Founder Instagram',
  identifier: 'instagram',
  display: '@founder',
  picture: '',
  disabled: false,
  inBetweenSteps: false,
  editor: 'normal',
  type: 'social',
  changeProfilePicture: false,
  additionalSettings: JSON.stringify({ post_type: 'post' }),
  changeNickName: false,
  time: [],
} as any;

const refreshedInstagram = {
  ...connectedInstagram,
  identifier: 'instagram-standalone',
  display: '@founder-direct',
  editor: 'markdown',
  additionalSettings: JSON.stringify({ post_type: 'reel' }),
};

describe('guided composer production component chain', () => {
  const originalFlag = process.env.NEXT_PUBLIC_GUIDED_COMPOSER_SHELL;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_GUIDED_COMPOSER_SHELL = 'true';
    mockIntegrationSnapshot = [];
    useGuidedComposerStore.getState().resetGuidedComposer();
    useLaunchStore.getState().reset();
  });

  afterEach(() => {
    useGuidedComposerStore.getState().resetGuidedComposer();
    useLaunchStore.getState().reset();

    if (originalFlag === undefined) {
      delete process.env.NEXT_PUBLIC_GUIDED_COMPOSER_SHELL;
    } else {
      process.env.NEXT_PUBLIC_GUIDED_COMPOSER_SHELL = originalFlag;
    }
  });

  it('reseeds a zero-account draft through the mounted production chain and preserves live state during same-ID refresh', async () => {
    render(<CreateComponent />);

    expect(
      await screen.findByRole('heading', { name: 'Upload', level: 1 })
    ).toBeTruthy();
    expect(screen.getByTestId('manage-modal')).toBeTruthy();
    expect(screen.getByTestId('guided-upload-details')).toBeTruthy();

    await waitFor(() => {
      expect(useLaunchStore.getState().global).toHaveLength(1);
    });

    act(() => {
      useLaunchStore.getState().setGlobalValueText(0, 'Draft caption');
      useLaunchStore.getState().setGlobalValueMedia(0, [
        {
          id: 'video-1',
          path: 'https://media.example.com/video.mp4',
          type: 'video',
        } as any,
      ]);
    });

    const initialDraft = useLaunchStore.getState().global[0];

    mockIntegrationSnapshot = [connectedInstagram];
    fireEvent.click(
      screen.getByRole('button', { name: 'Connect account' })
    );

    await waitFor(() => {
      expect(
        useLaunchStore.getState().integrations.map((integration) =>
          integration.id
        )
      ).toEqual(['instagram-account']);
    });

    expect(useLaunchStore.getState().global[0]).toMatchObject({
      id: initialDraft.id,
      content: 'Draft caption',
      media: [
        {
          id: 'video-1',
          path: 'https://media.example.com/video.mp4',
        },
      ],
    });

    fireEvent.click(
      screen.getByRole('button', { name: 'Continue to Destinations' })
    );

    expect(
      await screen.findByRole('heading', {
        name: 'Destinations',
        level: 1,
      })
    ).toBeTruthy();
    expect(screen.getByText('0 of 1 account selected')).toBeTruthy();

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Select Founder Instagram on Instagram',
      })
    );

    const initialSelection = useLaunchStore.getState().selectedIntegrations[0];
    const preservedRef = initialSelection.ref;
    const liveSettings = {
      post_type: 'reel',
      formState: {
        caption: 'Keep this live value',
      },
    };

    act(() => {
      useLaunchStore.setState({
        selectedIntegrations: [
          {
            ...initialSelection,
            settings: liveSettings,
          },
        ],
      });
    });

    mockIntegrationSnapshot = [refreshedInstagram];
    fireEvent.click(
      screen.getByRole('button', { name: 'Connect account' })
    );

    await waitFor(() => {
      expect(
        useLaunchStore.getState().selectedIntegrations[0].integration
          .identifier
      ).toBe('instagram-standalone');
    });

    const refreshedSelection =
      useLaunchStore.getState().selectedIntegrations[0];

    expect(refreshedSelection.integration).toMatchObject({
      id: 'instagram-account',
      identifier: 'instagram-standalone',
      display: '@founder-direct',
      editor: 'markdown',
      additionalSettings: JSON.stringify({ post_type: 'reel' }),
    });
    expect(refreshedSelection.settings).toBe(liveSettings);
    expect(refreshedSelection.ref).toBe(preservedRef);
    expect(useLaunchStore.getState().global[0]).toMatchObject({
      id: initialDraft.id,
      content: 'Draft caption',
      media: [
        {
          id: 'video-1',
          path: 'https://media.example.com/video.mp4',
        },
      ],
    });
    expect(
      screen.getByRole('heading', { name: 'Destinations', level: 1 })
    ).toBeTruthy();
    expect(screen.getByText('@founder-direct')).toBeTruthy();
    expect(
      screen
        .getByTestId('platform-icon-Instagram')
        .getAttribute('src')
    ).toBe('/icons/platforms/instagram-standalone.png');
  });
});
