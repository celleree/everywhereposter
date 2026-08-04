import React from 'react';
import { render, screen } from '@testing-library/react';

const mockMutateIntegrations = jest.fn();

jest.mock(
  '@gitroom/frontend/components/launches/helpers/use.integration.list',
  () => ({
    useIntegrationList: () => ({
      data: [],
      isLoading: false,
      mutate: mockMutateIntegrations,
    }),
  })
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
      AddProviderButton: () =>
        ReactModule.createElement(
          'button',
          { type: 'button' },
          'Connect account'
        ),
    };
  }
);

jest.mock(
  '@gitroom/frontend/components/create/create.post.composer',
  () => {
    const ReactModule = require('react');

    return {
      isGuidedComposerShellEnabled: () =>
        process.env.NEXT_PUBLIC_GUIDED_COMPOSER_SHELL === 'true',
      CreatePostComposer: ({
        allIntegrations,
        standaloneCreate,
      }: {
        allIntegrations?: unknown[];
        standaloneCreate?: boolean;
      }) =>
        ReactModule.createElement('div', {
          'data-testid': 'create-post-composer',
          'data-integration-count': String(allIntegrations?.length || 0),
          'data-standalone': standaloneCreate === true ? 'true' : 'false',
        }),
    };
  }
);

jest.mock('swr', () => ({
  __esModule: true,
  default: (key: string) => {
    if (key === 'create-find-slot') {
      return {
        data: '2026-08-05T12:00:00.000Z',
        isLoading: false,
      };
    }

    return {
      data: [],
      isLoading: false,
    };
  },
}));

import { CreateComponent } from '../../apps/frontend/src/components/create/create.component';

describe('standalone create zero-account entry point', () => {
  const originalFlag = process.env.NEXT_PUBLIC_GUIDED_COMPOSER_SHELL;

  afterEach(() => {
    if (originalFlag === undefined) {
      delete process.env.NEXT_PUBLIC_GUIDED_COMPOSER_SHELL;
    } else {
      process.env.NEXT_PUBLIC_GUIDED_COMPOSER_SHELL = originalFlag;
    }
  });

  it('mounts the guided composer with an empty allIntegrations list', () => {
    process.env.NEXT_PUBLIC_GUIDED_COMPOSER_SHELL = 'true';

    render(<CreateComponent />);

    const composer = screen.getByTestId('create-post-composer');
    expect(composer.getAttribute('data-integration-count')).toBe('0');
    expect(composer.getAttribute('data-standalone')).toBe('true');
    expect(screen.queryByText('Connect a channel to create')).toBeNull();
  });

  it('preserves the existing connect-channel empty state when guided mode is off', () => {
    process.env.NEXT_PUBLIC_GUIDED_COMPOSER_SHELL = 'false';

    render(<CreateComponent />);

    expect(screen.getByText('Connect a channel to create')).toBeTruthy();
    expect(screen.queryByTestId('create-post-composer')).toBeNull();
  });
});
