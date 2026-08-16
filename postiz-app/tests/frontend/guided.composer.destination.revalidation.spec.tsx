import React from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';

jest.mock(
  '@gitroom/frontend/components/new-launch/copy-generation.client',
  () => ({
    requestMediaCopyGenerationForDestinations: jest.fn(async () => ({
      response: {
        requestId: 'guided-revalidation-test',
        status: 'complete',
        sourceConfidence: 1,
        warnings: [],
        results: [
          {
            platform: 'instagram',
            draft: 'Instagram draft',
            origin: 'generated',
            charCount: 15,
            confidence: 1,
            antiGenericScore: 1,
            rewritten: false,
            warnings: [],
          },
        ],
        imagePlans: [],
      },
      platforms: ['instagram'],
      unsupportedDestinations: [],
    })),
  })
);

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
    default: ({ fallbackSrc: _fallbackSrc, ...props }: any) =>
      ReactModule.createElement('img', props),
  };
});

import { GuidedComposerShell } from '../../apps/frontend/src/components/new-launch/guided.composer.shell';
import { useGuidedComposerStore } from '../../apps/frontend/src/components/new-launch/guided.composer.store';
import { useLaunchStore } from '../../apps/frontend/src/components/new-launch/store';

const instagramIntegration = {
  id: 'instagram-account',
  name: 'Founder Instagram',
  identifier: 'instagram',
  display: '@founder',
  picture: '',
  disabled: false,
  inBetweenSteps: false,
} as any;

const seedDraft = () => {
  useLaunchStore.getState().addGlobalValue(0, [
    {
      id: 'post-1',
      content: '',
      delay: 0,
      media: [
        {
          id: 'video-1',
          path: 'https://media.example.com/video.mp4',
          type: 'video',
        } as any,
      ],
    },
  ]);
  useLaunchStore.getState().setAllIntegrations([instagramIntegration]);
  useGuidedComposerStore.setState({
    sourceMediaId: 'video-1',
    transcriptionStatus: 'READY',
  });
};

describe('guided composer destination revalidation', () => {
  beforeEach(() => {
    useGuidedComposerStore.getState().resetGuidedComposer();
    useLaunchStore.getState().reset();
    seedDraft();
  });

  it('blocks Review from advancing when the selected account is no longer available', async () => {
    render(
      <GuidedComposerShell>
        <div>Existing composer content</div>
      </GuidedComposerShell>
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Continue to Destinations' })
    );
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Select Founder Instagram on Instagram',
      })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Continue to Review' }));

    await waitFor(() =>
      expect(useGuidedComposerStore.getState().composerStep).toBe('review')
    );
    expect(
      screen
        .getByRole('button', { name: 'Continue to Publish' })
        .hasAttribute('disabled')
    ).toBe(false);

    act(() => {
      useLaunchStore.getState().setAllIntegrations([]);
    });

    const continueButton = screen.getByRole('button', {
      name: 'Continue to Publish',
    });
    expect(continueButton.hasAttribute('disabled')).toBe(true);
    expect(
      screen.getByText('Select at least one destination to continue.')
    ).toBeTruthy();

    fireEvent.click(continueButton);
    expect(useGuidedComposerStore.getState().composerStep).toBe('review');
  });

  it('removes a selected account from Review when it starts requiring reconnection', async () => {
    render(
      <GuidedComposerShell>
        <div>Existing composer content</div>
      </GuidedComposerShell>
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Continue to Destinations' })
    );
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Select Founder Instagram on Instagram',
      })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Continue to Review' }));

    await waitFor(() =>
      expect(useGuidedComposerStore.getState().composerStep).toBe('review')
    );

    act(() => {
      useLaunchStore.getState().setAllIntegrations([
        {
          ...instagramIntegration,
          refreshNeeded: true,
        },
      ]);
    });

    expect(
      screen
        .getByRole('button', { name: 'Continue to Publish' })
        .hasAttribute('disabled')
    ).toBe(true);
    expect(
      screen.getByText('Select at least one destination to continue.')
    ).toBeTruthy();
  });

  it('replaces a failed platform image with a neutral fallback badge', () => {
    render(
      <GuidedComposerShell>
        <div>Existing composer content</div>
      </GuidedComposerShell>
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Continue to Destinations' })
    );

    const platformIcon = screen.getByTestId('platform-icon-Instagram');
    expect(platformIcon.getAttribute('src')).toBe(
      '/icons/platforms/instagram.png'
    );

    fireEvent.error(platformIcon);

    expect(screen.queryByTestId('platform-icon-Instagram')).toBeNull();
    expect(screen.getByTestId('platform-icon-fallback-Instagram')).toBeTruthy();
    expect(
      screen.getByRole('img', { name: 'Instagram icon unavailable' })
    ).toBeTruthy();
  });
});
