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

jest.mock('@gitroom/react/helpers/image.with.fallback', () => {
  const ReactModule = require('react');

  return {
    __esModule: true,
    default: ({ src, alt, ...props }: any) =>
      ReactModule.createElement('img', {
        ...props,
        src,
        alt,
      }),
  };
});

import { useLaunchStore } from '../../apps/frontend/src/components/new-launch/store';
import { GuidedComposerDestinations } from '../../apps/frontend/src/components/new-launch/guided.composer.destinations';

const initialIntegration = {
  id: 'instagram-account',
  name: 'Founder Instagram',
  identifier: 'instagram',
  display: '@founder',
  picture: '',
  disabled: false,
  inBetweenSteps: false,
} as any;

const refreshedIntegration = {
  ...initialIntegration,
  identifier: 'instagram-standalone',
} as any;

describe('guided platform icon metadata refresh', () => {
  beforeEach(() => {
    useLaunchStore.getState().reset();
  });

  it('recovers from a failed icon when the same account ID receives a new platform identifier', async () => {
    act(() => {
      useLaunchStore.getState().setAllIntegrations([initialIntegration]);
    });

    render(<GuidedComposerDestinations />);

    const initialIcon = screen.getByTestId('platform-icon-Instagram');
    expect(initialIcon.getAttribute('src')).toBe(
      '/icons/platforms/instagram.png'
    );

    fireEvent.error(initialIcon);

    expect(
      screen.getByTestId('platform-icon-fallback-Instagram')
    ).toBeTruthy();
    expect(screen.queryByTestId('platform-icon-Instagram')).toBeNull();

    act(() => {
      useLaunchStore.getState().setAllIntegrations([refreshedIntegration]);
    });

    await waitFor(() => {
      const refreshedIcon = screen.getByTestId('platform-icon-Instagram');
      expect(refreshedIcon.getAttribute('src')).toBe(
        '/icons/platforms/instagram-standalone.png'
      );
    });

    expect(
      screen.queryByTestId('platform-icon-fallback-Instagram')
    ).toBeNull();
    expect(
      screen.getByRole('button', {
        name: 'Select Founder Instagram on Instagram',
      })
    ).toBeTruthy();
  });
});
