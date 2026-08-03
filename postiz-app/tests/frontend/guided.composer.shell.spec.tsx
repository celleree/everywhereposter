import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import {
  GuidedComposerShell,
  shouldUseGuidedComposerShell,
} from '../../apps/frontend/src/components/new-launch/guided.composer.shell';
import { useGuidedComposerStore } from '../../apps/frontend/src/components/new-launch/guided.composer.store';

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
      screen.getByText('Choose the platforms and connected accounts for this post.')
    ).toBeTruthy();
    expect(screen.queryByText('Existing composer content')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));

    expect(screen.getByText('Existing composer content')).toBeTruthy();
    expect(useGuidedComposerStore.getState().composerStep).toBe('upload');
  });

  it('renders a placeholder for later phases without rendering upload content', () => {
    useGuidedComposerStore.getState().setComposerStep('review');

    render(
      <GuidedComposerShell>
        <div>Existing composer content</div>
      </GuidedComposerShell>
    );

    expect(
      screen.getByText('Review and refine each platform-specific version.')
    ).toBeTruthy();
    expect(
      screen.getByText(
        'The existing controls for this stage will be connected in the next implementation phase.'
      )
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Continue to Publish' })
    ).toBeTruthy();
    expect(screen.queryByText('Existing composer content')).toBeNull();
  });

  it('shows the bounded final publish placeholder', () => {
    useGuidedComposerStore.getState().setComposerStep('publish');

    render(
      <GuidedComposerShell>
        <div>Existing composer content</div>
      </GuidedComposerShell>
    );

    expect(
      screen.getByText('Confirm the timing and destinations before publishing.')
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Publish' }).hasAttribute('disabled')
    ).toBe(true);
    expect(screen.queryByRole('button', { name: /Continue to/ })).toBeNull();
  });

  it('enables the shell only for normal new-post creation', () => {
    expect(shouldUseGuidedComposerShell({})).toBe(true);
    expect(
      shouldUseGuidedComposerShell({ existingIntegration: 'integration-id' })
    ).toBe(false);
    expect(shouldUseGuidedComposerShell({ isCreateSet: true })).toBe(false);
    expect(shouldUseGuidedComposerShell({ dummy: true })).toBe(false);
  });
});
