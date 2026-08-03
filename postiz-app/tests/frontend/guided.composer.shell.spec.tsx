import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import {
  GuidedComposerShell,
  shouldUseGuidedComposerShell,
} from '../../apps/frontend/src/components/new-launch/guided.composer.shell';
import { useGuidedComposerStore } from '../../apps/frontend/src/components/new-launch/guided.composer.store';

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

describe('guided composer shell', () => {
  beforeEach(() => {
    useGuidedComposerStore.getState().resetGuidedComposer();
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
