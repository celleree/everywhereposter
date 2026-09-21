import React, { createRef } from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';

const mockCustomProviderGet = jest.fn();

jest.mock(
  '@gitroom/frontend/components/launches/general.preview.component',
  () => ({ GeneralPreviewComponent: () => null })
);

jest.mock(
  '@gitroom/frontend/components/launches/helpers/use.integration',
  () => {
    const ReactModule = require('react');
    return { IntegrationContext: ReactModule.createContext({}) };
  }
);

jest.mock(
  '@gitroom/react/translation/get.transation.service.client',
  () => ({ useT: () => (_key: string, fallback: string) => fallback })
);

jest.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () =>
    jest.fn(async () => ({ json: async () => ({ internalPlugs: [] }) })),
}));

jest.mock(
  '@gitroom/frontend/components/launches/helpers/use.custom.provider.function',
  () => ({
    useCustomProviderFunction: () => ({ get: mockCustomProviderGet }),
  })
);

jest.mock('swr', () => ({
  __esModule: true,
  default: () => ({ data: { internalPlugs: [] }, isLoading: false }),
}));

jest.mock('@gitroom/frontend/components/launches/internal.channels', () => ({
  InternalChannels: () => null,
}));

jest.mock('@gitroom/react/helpers/safe.image', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('react-dom', () => {
  const actual = jest.requireActual('react-dom');
  return { ...actual, createPortal: (node: React.ReactNode) => node };
});

jest.mock('@gitroom/frontend/components/layout/set.timezone', () => ({
  newDayjs: () => require('dayjs')('2035-01-01T12:00:00Z'),
}));

jest.mock('@gitroom/react/form/input', () => {
  const ReactModule = require('react');
  return {
    Input: ReactModule.forwardRef(
      ({ label, ...props }: any, ref: React.Ref<HTMLInputElement>) => (
        <label>
          {label}
          <input aria-label={label} ref={ref} {...props} />
        </label>
      )
    ),
  };
});

jest.mock('@gitroom/react/form/select', () => {
  const ReactModule = require('react');
  return {
    Select: ReactModule.forwardRef(
      (
        { label, children, ...props }: any,
        ref: React.Ref<HTMLSelectElement>
      ) => (
        <label>
          {label}
          <select aria-label={label} ref={ref} {...props}>
            {children}
          </select>
        </label>
      )
    ),
  };
});

jest.mock(
  '@gitroom/frontend/components/new-launch/providers/medium/medium.tags',
  () => ({ MediumTags: () => null })
);

jest.mock('@gitroom/frontend/components/media/media.component', () => ({
  MediaComponent: () => null,
}));

jest.mock(
  '@gitroom/frontend/components/new-launch/providers/youtube/youtube.preview',
  () => ({ YoutubePreview: () => null })
);

jest.mock(
  '@gitroom/frontend/components/new-launch/providers/tiktok/tiktok.preview',
  () => ({ TiktokPreview: () => null })
);

jest.mock(
  '@gitroom/frontend/components/new-launch/providers/pinterest/pinterest.preview',
  () => ({ PinterestPreview: () => null })
);

jest.mock(
  '@gitroom/frontend/components/new-launch/providers/pinterest/pinterest.board',
  () => {
    const ReactModule = require('react');
    return {
      PinterestBoard: ReactModule.forwardRef(
        (props: any, ref: React.Ref<HTMLInputElement>) => (
          <label>
            Board
            <input aria-label="Board" ref={ref} {...props} />
          </label>
        )
      ),
    };
  }
);

jest.mock('@gitroom/react/form/color.picker', () => ({
  ColorPicker: () => null,
}));

import { useLaunchStore } from '../../apps/frontend/src/components/new-launch/store';
import YoutubeProvider from '../../apps/frontend/src/components/new-launch/providers/youtube/youtube.provider';
import PinterestProvider from '../../apps/frontend/src/components/new-launch/providers/pinterest/pinterest.provider';
import TikTokProvider from '../../apps/frontend/src/components/new-launch/providers/tiktok/tiktok.provider';

const baseIntegration = {
  name: 'Test account',
  display: '@test',
  picture: '',
  disabled: false,
  inBetweenSteps: false,
  editor: 'normal',
  type: 'social',
  changeProfilePicture: false,
  additionalSettings: '[]',
  changeNickName: false,
  time: [],
} as any;

const renderProvider = (
  Provider: React.ComponentType<any>,
  integration: any,
  media: any[]
) => {
  const providerRef = createRef<any>();

  act(() => {
    useLaunchStore.getState().reset();
    useLaunchStore.setState({
      integrations: [integration],
      selectedIntegrations: [
        { integration, settings: {}, ref: providerRef },
      ],
      current: integration.id,
      global: [
        {
          id: 'post-1',
          content: 'Caption',
          delay: 0,
          media,
        },
      ],
    });
  });

  render(<Provider id={integration.id} ref={providerRef} />);
  return providerRef;
};

describe('guided composer existing provider settings', () => {
  beforeEach(() => {
    useLaunchStore.getState().reset();
    mockCustomProviderGet.mockReset();
  });

  it('uses the existing YouTube form and DTO for the required title', async () => {
    const integration = {
      ...baseIntegration,
      id: 'youtube-account',
      identifier: 'youtube',
    };
    const providerRef = renderProvider(YoutubeProvider, integration, [
      {
        id: 'video-1',
        path: 'https://media.example.com/video.mp4',
        type: 'video',
      },
    ]);

    await waitFor(() => expect(providerRef.current).toBeTruthy());
    expect((await providerRef.current.isValid()).valid).toBe(false);

    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: 'Launch walkthrough' },
    });

    await waitFor(async () =>
      expect((await providerRef.current.isValid()).valid).toBe(true)
    );
    expect(providerRef.current.getValues().settings).toMatchObject({
      title: 'Launch walkthrough',
      type: 'public',
    });
  });

  it('uses live TikTok creator info for Direct Post settings', async () => {
    mockCustomProviderGet.mockResolvedValue({
      data: {
        creator_nickname: 'Arundel Creator',
        privacy_level_options: ['SELF_ONLY', 'FOLLOWER_OF_CREATOR'],
        comment_disabled: false,
        duet_disabled: true,
        stitch_disabled: true,
        max_video_post_duration_sec: 60,
      },
    });

    const integration = {
      ...baseIntegration,
      id: 'tiktok-account',
      identifier: 'tiktok',
    };
    const providerRef = renderProvider(TikTokProvider, integration, [
      {
        id: 'video-1',
        path: 'https://media.example.com/video.mp4',
        type: 'video',
      },
    ]);

    expect(await screen.findByText('Arundel Creator')).toBeTruthy();
    expect(mockCustomProviderGet).toHaveBeenCalledWith('creatorInfo');

    const privacy = screen.getByLabelText(
      'Who can see this video?'
    ) as HTMLSelectElement;
    expect(privacy.value).toBe('');
    expect(
      within(privacy)
        .getAllByRole('option')
        .map((option) => option.textContent)
    ).toEqual(['Select', 'Self only', 'Follower of creator']);

    expect(screen.getByRole('checkbox', { name: 'Comments' })).toHaveAttribute(
      'aria-checked',
      'false'
    );
    expect(screen.getByRole('checkbox', { name: 'Comments' })).not.toHaveAttribute(
      'aria-disabled'
    );
    expect(screen.getByRole('checkbox', { name: 'Duet' })).toHaveAttribute(
      'aria-disabled',
      'true'
    );
    expect(screen.getByRole('checkbox', { name: 'Stitch' })).toHaveAttribute(
      'aria-disabled',
      'true'
    );

    expect(
      screen.getByText(/By posting, you agree to TikTok's/)
    ).toBeTruthy();

    await waitFor(async () => {
      const result = await providerRef.current.isValid();
      expect(result.valid).toBe(false);
      expect(result.errors).toBe(
        'Select a privacy option currently available for this TikTok creator.'
      );
    });
  });

  it('enforces the TikTok creator maximum video duration', async () => {
    mockCustomProviderGet.mockResolvedValue({
      data: {
        creator_nickname: 'Arundel Creator',
        privacy_level_options: ['SELF_ONLY'],
        comment_disabled: false,
        duet_disabled: false,
        stitch_disabled: false,
        max_video_post_duration_sec: 60,
      },
    });

    const integration = {
      ...baseIntegration,
      id: 'tiktok-duration-account',
      identifier: 'tiktok',
    };
    const providerRef = renderProvider(TikTokProvider, integration, [
      {
        id: 'video-1',
        path: 'https://media.example.com/video.mp4',
        type: 'video',
      },
    ]);

    await screen.findByText('Arundel Creator');
    fireEvent.change(screen.getByLabelText('Who can see this video?'), {
      target: { value: 'SELF_ONLY' },
    });

    const originalCreateElement = document.createElement.bind(document);
    const createElementSpy = jest
      .spyOn(document, 'createElement')
      .mockImplementation(((tagName: string, options?: ElementCreationOptions) => {
        if (tagName === 'video') {
          const video: any = { duration: 61, onloadedmetadata: undefined };
          Object.defineProperty(video, 'preload', {
            set: () => {
              setTimeout(() => video.onloadedmetadata?.(), 0);
            },
          });
          return video;
        }

        return originalCreateElement(tagName, options);
      }) as typeof document.createElement);

    try {
      const result = await providerRef.current.isValid();
      expect(result.errors).toBe(
        'TikTok allows this creator to post videos up to 60 seconds.'
      );
    } finally {
      createElementSpy.mockRestore();
    }
  });

  it('uses the existing Pinterest form and DTO for the required board', async () => {
    const integration = {
      ...baseIntegration,
      id: 'pinterest-account',
      identifier: 'pinterest',
    };
    const providerRef = renderProvider(PinterestProvider, integration, [
      {
        id: 'image-1',
        path: 'https://media.example.com/image.png',
        type: 'image',
      },
    ]);

    await waitFor(() => expect(providerRef.current).toBeTruthy());
    expect((await providerRef.current.isValid()).valid).toBe(false);

    fireEvent.change(screen.getByLabelText('Board'), {
      target: { value: 'board-123' },
    });

    await waitFor(async () =>
      expect((await providerRef.current.isValid()).valid).toBe(true)
    );
    expect(providerRef.current.getValues().settings.board).toBe('board-123');
  });
});
