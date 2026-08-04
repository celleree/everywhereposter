import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

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

import { GuidedComposerShell } from '../../apps/frontend/src/components/new-launch/guided.composer.shell';
import { useGuidedComposerStore } from '../../apps/frontend/src/components/new-launch/guided.composer.store';
import { useLaunchStore } from '../../apps/frontend/src/components/new-launch/store';

describe('guided composer destinations with zero connected accounts', () => {
  beforeEach(() => {
    useGuidedComposerStore.getState().resetGuidedComposer();
    useLaunchStore.getState().reset();
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
    useLaunchStore.getState().setAllIntegrations([]);
  });

  it('renders the reachable empty state and keeps review blocked', () => {
    render(
      <GuidedComposerShell>
        <div>Existing composer content</div>
      </GuidedComposerShell>
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Continue to Destinations' })
    );

    expect(screen.getByText('No connected accounts available')).toBeTruthy();
    expect(
      screen.getByText(
        'Connect at least one supported social account before continuing.'
      )
    ).toBeTruthy();
    expect(screen.getByText('0 of 0 accounts selected')).toBeTruthy();
    expect(
      screen
        .getByRole('button', { name: 'Continue to Review' })
        .hasAttribute('disabled')
    ).toBe(true);
  });
});
