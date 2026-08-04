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

const availableIntegrations = [
  {
    id: 'instagram-account',
    name: 'Founder Instagram',
    identifier: 'instagram',
    display: '@founder',
    picture: '',
    disabled: false,
    inBetweenSteps: false,
  },
  {
    id: 'linkedin-account',
    name: 'Founder LinkedIn',
    identifier: 'linkedin',
    display: 'Founder profile',
    picture: '',
    disabled: false,
    inBetweenSteps: false,
  },
] as any[];

const unavailableIntegrations = [
  {
    id: 'disabled-account',
    name: 'Disabled account',
    identifier: 'facebook',
    disabled: true,
    inBetweenSteps: false,
  },
  {
    id: 'intermediary-account',
    name: 'Intermediary account',
    identifier: 'threads',
    disabled: false,
    inBetweenSteps: true,
  },
] as any[];

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
  useLaunchStore
    .getState()
    .setAllIntegrations([...availableIntegrations, ...unavailableIntegrations]);
};

const renderDestinations = () => {
  render(
    <GuidedComposerShell>
      <div>Existing composer content</div>
    </GuidedComposerShell>
  );

  fireEvent.click(
    screen.getByRole('button', { name: 'Continue to Destinations' })
  );
};

describe('guided composer destinations step', () => {
  beforeEach(() => {
    useGuidedComposerStore.getState().resetGuidedComposer();
    useLaunchStore.getState().reset();
    seedDraft();
  });

  it('requires at least one available destination before review', () => {
    renderDestinations();

    const continueButton = screen.getByRole('button', {
      name: 'Continue to Review',
    });

    expect(screen.getByText('0 of 2 accounts selected')).toBeTruthy();
    expect(
      screen.getByText('Select at least one destination to continue.')
    ).toBeTruthy();
    expect(continueButton.hasAttribute('disabled')).toBe(true);

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Select Founder Instagram on Instagram',
      })
    );

    expect(screen.getByText('1 of 2 accounts selected')).toBeTruthy();
    expect(continueButton.hasAttribute('disabled')).toBe(false);
    expect(
      useLaunchStore.getState().selectedIntegrations.map((selected) =>
        selected.integration.id
      )
    ).toEqual(['instagram-account']);

    fireEvent.click(continueButton);
    expect(useGuidedComposerStore.getState().composerStep).toBe('review');
  });

  it('selects only usable accounts in bulk and preserves them across steps', () => {
    renderDestinations();

    fireEvent.click(screen.getByRole('button', { name: 'Select all' }));

    expect(screen.getByText('2 of 2 accounts selected')).toBeTruthy();
    expect(
      useLaunchStore.getState().selectedIntegrations.map((selected) =>
        selected.integration.id
      )
    ).toEqual(['instagram-account', 'linkedin-account']);

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Continue to Destinations' })
    );

    expect(screen.getByText('2 of 2 accounts selected')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Deselect all' }));
    expect(useLaunchStore.getState().selectedIntegrations).toEqual([]);
    expect(
      screen
        .getByRole('button', { name: 'Continue to Review' })
        .hasAttribute('disabled')
    ).toBe(true);
  });

  it('shows an empty state when no usable accounts are connected', () => {
    useLaunchStore.getState().setAllIntegrations(unavailableIntegrations);

    renderDestinations();

    expect(screen.getByText('No connected accounts available')).toBeTruthy();
    expect(
      screen.getByText(
        'Connect at least one supported social account before continuing.'
      )
    ).toBeTruthy();
  });
});
