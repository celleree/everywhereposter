import React, { useState } from 'react';
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

import {
  GuidedComposerShell,
  shouldUseGuidedComposerShell,
} from '../../apps/frontend/src/components/new-launch/guided.composer.shell';
import { useGuidedComposerStore } from '../../apps/frontend/src/components/new-launch/guided.composer.store';
import { useLaunchStore } from '../../apps/frontend/src/components/new-launch/store';

const StatefulUploadComposer = () => {
  const [queuedPreset, setQueuedPreset] = useState(false);

  return (
    <div>
      <button type="button" onClick={() => setQueuedPreset(true)}>
        Queue AI preset
      </button>
      <div>{queuedPreset ? 'AI preset queued' : 'No AI preset queued'}</div>
    </div>
  );
};

const seedUploadedVideo = () => {
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

describe('guided composer shell', () => {
  beforeEach(() => {
    useGuidedComposerStore.getState().resetGuidedComposer();
    useLaunchStore.getState().reset();
    seedUploadedVideo();
  });

  it('renders the upload step around the existing composer content', () => {
    render(
      <GuidedComposerShell>
        <div>Existing composer content</div>
      </GuidedComposerShell>
    );

    expect(
      screen.getByRole('navigation', { name: 'Post creation progress' })
    ).toBeTruthy();
    expect(screen.getByText('Create post')).toBeTruthy();
    expect(screen.getByText('Existing composer content')).toBeTruthy();
    expect(screen.getByLabelText('Additional context')).toBeTruthy();
    expect(
      screen.getByRole('radio', { name: /Create captions for me/ })
        .hasAttribute('checked')
    ).toBe(true);
    expect(
      screen.getByRole('button', { name: 'Continue to Destinations' })
    ).toBeTruthy();
    expect(screen.getByText('Step 1 of 4')).toBeTruthy();
    expect(screen.getByText('Step 4 of 4')).toBeTruthy();
  });

  it('moves forward and back while preserving the bounded step flow', () => {
    render(
      <GuidedComposerShell>
        <div>Existing composer content</div>
      </GuidedComposerShell>
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Continue to Destinations' })
    );

    expect(
      screen.getAllByText(
        'Choose the platforms and connected accounts for this post.'
      )
    ).toHaveLength(2);
    expect(
      screen
        .getByTestId('guided-composer-upload-content')
        .hasAttribute('hidden')
    ).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));

    expect(screen.getByText('Existing composer content')).toBeTruthy();
    expect(
      screen
        .getByTestId('guided-composer-upload-content')
        .hasAttribute('hidden')
    ).toBe(false);
    expect(useGuidedComposerStore.getState().composerStep).toBe('upload');
  });

  it('moves focus to the active step heading', () => {
    render(
      <GuidedComposerShell>
        <div>Existing composer content</div>
      </GuidedComposerShell>
    );

    expect(document.activeElement).toBe(
      screen.getByRole('heading', { name: 'Upload' })
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Continue to Destinations' })
    );

    expect(document.activeElement).toBe(
      screen.getByRole('heading', { name: 'Destinations', level: 1 })
    );
  });

  it('preserves local upload composer state between steps', () => {
    render(
      <GuidedComposerShell>
        <StatefulUploadComposer />
      </GuidedComposerShell>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Queue AI preset' }));
    expect(screen.getByText('AI preset queued')).toBeTruthy();

    fireEvent.click(
      screen.getByRole('button', { name: 'Continue to Destinations' })
    );

    expect(
      screen
        .getByTestId('guided-composer-upload-content')
        .hasAttribute('hidden')
    ).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));

    expect(screen.getByText('AI preset queued')).toBeTruthy();
    expect(
      screen
        .getByTestId('guided-composer-upload-content')
        .hasAttribute('hidden')
    ).toBe(false);
  });

  it('keeps the upload step mounted while media is uploading', () => {
    render(
      <GuidedComposerShell locked>
        <div>Upload progress and cancel controls</div>
      </GuidedComposerShell>
    );

    const continueButton = screen.getByRole('button', {
      name: 'Continue to Destinations',
    });
    const destinationsStep = screen.getByRole('button', {
      name: /Destinations Step 2 of 4/,
    });

    expect(continueButton.hasAttribute('disabled')).toBe(true);
    expect(destinationsStep.hasAttribute('disabled')).toBe(true);

    fireEvent.click(continueButton);
    fireEvent.click(destinationsStep);

    expect(useGuidedComposerStore.getState().composerStep).toBe('upload');
    expect(screen.getByText('Upload progress and cancel controls')).toBeTruthy();
  });

  it('requires an uploaded video before continuing', () => {
    useLaunchStore.getState().setGlobalValueMedia(0, []);

    render(
      <GuidedComposerShell>
        <div>Existing composer content</div>
      </GuidedComposerShell>
    );

    expect(screen.getByText('Upload a video to continue.')).toBeTruthy();
    expect(
      screen
        .getByRole('button', { name: 'Continue to Destinations' })
        .hasAttribute('disabled')
    ).toBe(true);
  });

  it('requires and preserves a user caption for caption-based modes', () => {
    render(
      <GuidedComposerShell>
        <div>Existing composer content</div>
      </GuidedComposerShell>
    );

    fireEvent.change(screen.getByLabelText('Additional context'), {
      target: { value: 'Use the founder audience and mention the beta.' },
    });
    fireEvent.click(
      screen.getByRole('radio', {
        name: /Adapt my caption for each platform/,
      })
    );

    const continueButton = screen.getByRole('button', {
      name: 'Continue to Destinations',
    });
    expect(screen.getByText('Enter your caption to continue.')).toBeTruthy();
    expect(continueButton.hasAttribute('disabled')).toBe(true);

    fireEvent.change(screen.getByLabelText('Your caption'), {
      target: { value: 'One video should not die on one platform.' },
    });

    expect(continueButton.hasAttribute('disabled')).toBe(false);
    fireEvent.click(continueButton);
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));

    expect(
      (screen.getByLabelText('Additional context') as HTMLTextAreaElement).value
    ).toBe('Use the founder audience and mention the beta.');
    expect(
      (screen.getByLabelText('Your caption') as HTMLTextAreaElement).value
    ).toBe('One video should not die on one platform.');
    expect(useGuidedComposerStore.getState()).toMatchObject({
      captionMode: 'adapt-by-platform',
      additionalContext: 'Use the founder audience and mention the beta.',
      sourceCaption: 'One video should not die on one platform.',
    });
  });

  it('removes attached media from the shared composer draft', () => {
    render(
      <GuidedComposerShell>
        <div>Existing composer content</div>
      </GuidedComposerShell>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Remove media' }));

    expect(useLaunchStore.getState().global[0].media).toEqual([]);
    expect(screen.getByText('Upload a video to continue.')).toBeTruthy();
  });

  it('renders a placeholder for later phases while hiding upload content', () => {
    useGuidedComposerStore.getState().setComposerStep('review');

    render(
      <GuidedComposerShell>
        <div>Existing composer content</div>
      </GuidedComposerShell>
    );

    expect(
      screen.getAllByText('Review and refine each platform-specific version.')
    ).toHaveLength(2);
    expect(
      screen.getByText(
        'The existing controls for this stage will be connected in the next implementation phase.'
      )
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Continue to Publish' })
    ).toBeTruthy();
    expect(screen.getByText('Existing composer content')).toBeTruthy();
    expect(
      screen
        .getByTestId('guided-composer-upload-content')
        .hasAttribute('hidden')
    ).toBe(true);
  });

  it('shows the bounded final publish placeholder', () => {
    useGuidedComposerStore.getState().setComposerStep('publish');

    render(
      <GuidedComposerShell>
        <div>Existing composer content</div>
      </GuidedComposerShell>
    );

    expect(
      screen.getAllByText(
        'Confirm the timing and destinations before publishing.'
      )
    ).toHaveLength(2);
    expect(
      screen.getByRole('button', { name: 'Publish' }).hasAttribute('disabled')
    ).toBe(true);
    expect(screen.queryByRole('button', { name: /Continue to/ })).toBeNull();
  });

  it('resets guided state when the modal closes from a later step', () => {
    const store = useGuidedComposerStore.getState();
    store.setAdditionalContext('Audience and offer details');
    store.setCaptionMode('adapt-by-platform');
    store.setSourceCaption('Original caption');

    const { unmount } = render(
      <GuidedComposerShell>
        <div>Existing composer content</div>
      </GuidedComposerShell>
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Continue to Destinations' })
    );
    unmount();

    expect(useGuidedComposerStore.getState()).toMatchObject({
      composerStep: 'upload',
      additionalContext: '',
      captionMode: 'generate',
      sourceCaption: '',
    });
  });

  it('keeps the unfinished shell disabled unless explicitly enabled', () => {
    expect(shouldUseGuidedComposerShell({})).toBe(false);
    expect(shouldUseGuidedComposerShell({ enabled: false })).toBe(false);
    expect(shouldUseGuidedComposerShell({ enabled: true })).toBe(true);
    expect(
      shouldUseGuidedComposerShell({
        enabled: true,
        existingIntegration: 'integration-id',
      })
    ).toBe(false);
    expect(
      shouldUseGuidedComposerShell({ enabled: true, isCreateSet: true })
    ).toBe(false);
    expect(
      shouldUseGuidedComposerShell({ enabled: true, dummy: true })
    ).toBe(false);
  });
});