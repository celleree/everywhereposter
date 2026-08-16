import React, { createRef } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

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
