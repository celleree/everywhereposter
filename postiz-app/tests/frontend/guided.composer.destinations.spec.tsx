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

jest.mock('@gitroom/react/helpers/image.with.fallback', () => {
  const ReactModule = require('react');

  return {
    __esModule: true,
    default: ({ fallbackSrc, src, alt, ...props }: any) => {
      const [currentSrc, setCurrentSrc] = ReactModule.useState(src);

      return (
        <img
          {...props}
          alt={alt}
          src={currentSrc}
          data-testid={`fallback-image-${alt}`}
          onError={() => setCurrentSrc(fallbackSrc)}
        />
      );
    },
  };
});

import { GuidedComposerShell } from '../../apps/frontend/src/components/new-launch/guided.composer.shell';
import { getGuidedPlatformIdentity } from '../../apps/frontend/src/components/new-launch/guided.composer.destinations';
import { useGuidedComposerStore } from '../../apps/frontend/src/components/new-launch/guided.composer.store';
import { useLaunchStore } from '../../apps/frontend/src/components/new-launch/store';

const availableIntegrations = [
  {
    id: 'instagram-account',
    name: 'Founder Instagram',
    identifier: 'instagram',
    display: '@founder',
    picture: 'https://media.example.com/missing-avatar.jpg',
    disabled: false,
    inBetweenSteps: false,
    customer: {
      id: 'customer-1',
      name: 'Creator Team',
    },
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

const providerVariantIntegrations = [
  {
    id: 'linkedin-personal',
    name: 'LinkedIn Personal',
    identifier: 'linkedin',
    display: 'Personal profile',
    picture: '',
    disabled: false,
    inBetweenSteps: false,
  },
  {
    id: 'linkedin-company',
    name: 'LinkedIn Page',
    identifier: 'linkedin-page',
    display: 'Company page',
    picture: '',
    disabled: false,
    inBetweenSteps: false,
  },
  {
    id: 'instagram-facebook',
    name: 'Instagram via Facebook',
    identifier: 'instagram',
    display: '@brand',
    picture: '',
    disabled: false,
    inBetweenSteps: false,
  },
  {
    id: 'instagram-direct',
    name: 'Instagram Direct',
    identifier: 'instagram-standalone',
    display: '@creator',
    picture: '',
    disabled: false,
    inBetweenSteps: false,
  },
  {
    id: 'youtube-account',
    name: 'YouTube Channel',
    identifier: 'youtube',
    display: 'Channel',
    picture: '',
    disabled: false,
    inBetweenSteps: false,
  },
  {
    id: 'gmb-account',
    name: 'Local Business',
    identifier: 'gmb',
    display: '',
    picture: '',
    disabled: false,
    inBetweenSteps: false,
  },
] as any[];

const seedVideoDraft = () => {
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
};

const seedDraft = () => {
  seedVideoDraft();
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

  it('supports individual deselection and restores the review gate', () => {
    renderDestinations();

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Select Founder Instagram on Instagram',
      })
    );
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Deselect Founder Instagram on Instagram',
      })
    );

    expect(useLaunchStore.getState().selectedIntegrations).toEqual([]);
    expect(screen.getByText('0 of 2 accounts selected')).toBeTruthy();
    expect(
      screen
        .getByRole('button', { name: 'Continue to Review' })
        .hasAttribute('disabled')
    ).toBe(true);
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

  it('preserves existing per-account settings during Select all', () => {
    const instagramSettings = {
      post_type: 'reel',
      collaborators: ['creator'],
    };

    useLaunchStore.getState().setSelectedIntegrations([
      {
        selectedIntegrations: availableIntegrations[0],
        settings: instagramSettings,
      },
    ]);

    renderDestinations();
    fireEvent.click(screen.getByRole('button', { name: 'Select all' }));

    const selected = useLaunchStore.getState().selectedIntegrations;
    expect(selected).toHaveLength(2);
    expect(
      selected.find(
        (item) => item.integration.id === 'instagram-account'
      )?.settings
    ).toEqual(instagramSettings);
    expect(
      selected.find((item) => item.integration.id === 'linkedin-account')
        ?.settings
    ).toEqual({});
  });

  it('groups usable accounts and excludes disabled and intermediary accounts', () => {
    renderDestinations();

    expect(
      screen.getByRole('heading', { name: 'Instagram', level: 3 })
    ).toBeTruthy();
    expect(
      screen.getByRole('heading', { name: 'LinkedIn', level: 3 })
    ).toBeTruthy();
    expect(screen.getByText('Creator Team')).toBeTruthy();
    expect(screen.queryByText('Disabled account')).toBeNull();
    expect(screen.queryByText('Intermediary account')).toBeNull();
    expect(
      screen.queryByRole('heading', { name: 'Facebook', level: 3 })
    ).toBeNull();
    expect(
      screen.queryByRole('heading', { name: 'Threads', level: 3 })
    ).toBeNull();
  });

  it('consolidates provider variants under canonical platform labels', () => {
    useLaunchStore.getState().reset();
    useGuidedComposerStore.getState().resetGuidedComposer();
    seedVideoDraft();
    useLaunchStore
      .getState()
      .setAllIntegrations(providerVariantIntegrations);

    renderDestinations();

    const linkedInHeading = screen.getByRole('heading', {
      name: 'LinkedIn',
      level: 3,
    });
    const instagramHeading = screen.getByRole('heading', {
      name: 'Instagram',
      level: 3,
    });

    expect(
      screen.getAllByRole('heading', { name: 'LinkedIn', level: 3 })
    ).toHaveLength(1);
    expect(
      screen.getAllByRole('heading', { name: 'Instagram', level: 3 })
    ).toHaveLength(1);
    expect(linkedInHeading.closest('section')?.textContent).toContain(
      '2 accounts'
    );
    expect(instagramHeading.closest('section')?.textContent).toContain(
      '2 accounts'
    );
    expect(
      screen.getByRole('heading', { name: 'YouTube', level: 3 })
    ).toBeTruthy();
    expect(
      screen.getByRole('heading', { name: 'Google Business', level: 3 })
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Select LinkedIn Page on LinkedIn' })
    ).toBeTruthy();
    expect(
      screen.getByRole('button', {
        name: 'Select Instagram Direct on Instagram',
      })
    ).toBeTruthy();
    expect(screen.queryByText('Linkedin Page')).toBeNull();
    expect(screen.queryByText('Instagram Standalone')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Youtube' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Gmb' })).toBeNull();
  });

  it('returns canonical identities for provider aliases and branded names', () => {
    expect(getGuidedPlatformIdentity('linkedin')).toEqual({
      key: 'linkedin',
      label: 'LinkedIn',
    });
    expect(getGuidedPlatformIdentity('linkedin-page')).toEqual({
      key: 'linkedin',
      label: 'LinkedIn',
    });
    expect(getGuidedPlatformIdentity('instagram-standalone')).toEqual({
      key: 'instagram',
      label: 'Instagram',
    });
    expect(getGuidedPlatformIdentity('youtube').label).toBe('YouTube');
    expect(getGuidedPlatformIdentity('gmb').label).toBe('Google Business');
    expect(getGuidedPlatformIdentity('tiktok').label).toBe('TikTok');
  });

  it('uses account-image fallback and renders platform identity images', () => {
    renderDestinations();

    const avatar = screen.getByTestId('fallback-image-Founder Instagram');
    expect(avatar.getAttribute('src')).toBe(
      'https://media.example.com/missing-avatar.jpg'
    );

    fireEvent.error(avatar);

    expect(avatar.getAttribute('src')).toBe('/no-picture.jpg');
    expect(screen.getByTestId('platform-icon-Instagram')).toBeTruthy();
    expect(screen.getByTestId('platform-icon-LinkedIn')).toBeTruthy();
  });

  it('disables destination controls while the shared composer is locked', () => {
    useGuidedComposerStore.getState().setComposerStep('destinations');

    render(
      <GuidedComposerShell locked>
        <div>Existing composer content</div>
      </GuidedComposerShell>
    );

    expect(
      screen.getByRole('button', { name: 'Select all' }).hasAttribute('disabled')
    ).toBe(true);
    expect(
      screen
        .getByRole('button', {
          name: 'Select Founder Instagram on Instagram',
        })
        .hasAttribute('disabled')
    ).toBe(true);
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
