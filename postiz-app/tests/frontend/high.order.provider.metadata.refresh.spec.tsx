import React, { createRef } from 'react';
import { act, render, waitFor } from '@testing-library/react';

jest.mock(
  '@gitroom/frontend/components/launches/general.preview.component',
  () => ({
    GeneralPreviewComponent: () => null,
  })
);

jest.mock(
  '@gitroom/frontend/components/launches/helpers/use.integration',
  () => {
    const ReactModule = require('react');

    return {
      IntegrationContext: ReactModule.createContext({}),
    };
  }
);

jest.mock(
  '@gitroom/react/translation/get.transation.service.client',
  () => ({
    useT: () => (_key: string, fallback: string) => fallback,
  })
);

jest.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () =>
    jest.fn(async () => ({
      json: async () => ({ internalPlugs: [] }),
    })),
}));

jest.mock('swr', () => ({
  __esModule: true,
  default: () => ({
    data: { internalPlugs: [] },
    isLoading: false,
  }),
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

  return {
    ...actual,
    createPortal: (node: React.ReactNode) => node,
  };
});

jest.mock('@gitroom/frontend/components/layout/set.timezone', () => ({
  newDayjs: () => require('dayjs')('2026-08-04T12:00:00Z'),
}));

import {
  PostComment,
  withProvider,
} from '../../apps/frontend/src/components/new-launch/providers/high.order.provider';
import { useLaunchStore } from '../../apps/frontend/src/components/new-launch/store';

const initialIntegration = {
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
  additionalSettings: JSON.stringify([
    { maximumCharacters: 100, configuration: 'old' },
  ]),
  changeNickName: false,
  time: [],
} as any;

const refreshedIntegration = {
  ...initialIntegration,
  name: 'Reconnected Instagram',
  identifier: 'instagram-standalone',
  editor: 'html',
  additionalSettings: JSON.stringify([
    { maximumCharacters: 280, configuration: 'new' },
  ]),
} as any;

const checkValidity = jest.fn(async () => true);
const maximumCharacters = (settings: any[]) =>
  settings[0]?.maximumCharacters || 0;

const TestProvider = withProvider({
  postComment: PostComment.POST,
  minimumCharacters: [],
  SettingsComponent: null,
  maximumCharacters,
  checkValidity,
});

describe('provider metadata refresh', () => {
  beforeEach(() => {
    checkValidity.mockClear();
    useLaunchStore.getState().reset();
  });

  it('refreshes the mounted provider handle when same-ID account metadata changes', async () => {
    const providerRef = createRef<any>();
    const settings = { post_type: 'reel' };

    act(() => {
      useLaunchStore.setState({
        integrations: [initialIntegration],
        selectedIntegrations: [
          {
            integration: initialIntegration,
            settings,
            ref: providerRef,
          },
        ],
        global: [
          {
            id: 'post-1',
            content: 'A caption',
            delay: 0,
            media: [],
          },
        ],
        current: initialIntegration.id,
      });
    });

    render(<TestProvider id={initialIntegration.id} ref={providerRef} />);

    await waitFor(() => {
      expect(providerRef.current).toBeTruthy();
      expect(useLaunchStore.getState().chars[initialIntegration.id]).toBe(100);
    });

    const initialResult = await providerRef.current.isValid();
    expect(initialResult.identifier).toBe('instagram');
    expect(initialResult.integration).toBe(initialIntegration);
    expect(initialResult.maximumCharacters).toBe(100);

    act(() => {
      useLaunchStore.setState((state) => ({
        integrations: [refreshedIntegration],
        selectedIntegrations: state.selectedIntegrations.map((selected) =>
          selected.integration.id === refreshedIntegration.id
            ? { ...selected, integration: refreshedIntegration }
            : selected
        ),
      }));
    });

    await waitFor(() => {
      expect(useLaunchStore.getState().editor).toBe('html');
      expect(useLaunchStore.getState().chars[refreshedIntegration.id]).toBe(280);
    });

    const refreshedResult = await providerRef.current.isValid();
    expect(refreshedResult.identifier).toBe('instagram-standalone');
    expect(refreshedResult.integration).toBe(refreshedIntegration);
    expect(refreshedResult.maximumCharacters).toBe(280);
    expect(providerRef.current.getValues().identifier).toBe(
      'instagram-standalone'
    );

    expect(checkValidity).toHaveBeenLastCalledWith(
      [[]],
      settings,
      [{ maximumCharacters: 280, configuration: 'new' }]
    );
    expect(useLaunchStore.getState().selectedIntegrations[0].settings).toBe(
      settings
    );
    expect(useLaunchStore.getState().selectedIntegrations[0].ref).toBe(
      providerRef
    );
  });
});
