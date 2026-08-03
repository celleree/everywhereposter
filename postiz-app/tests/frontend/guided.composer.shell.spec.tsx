import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
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
    const html = renderToStaticMarkup(
      <GuidedComposerShell>
        <div>Existing composer content</div>
      </GuidedComposerShell>
    );

    expect(html).toContain('Post creation progress');
    expect(html).toContain('Create post');
    expect(html).toContain('Existing composer content');
    expect(html).toContain('Continue to Destinations');
    expect(html).toContain('Step 1 of 4');
    expect(html).toContain('Step 4 of 4');
  });

  it('renders a placeholder for later phases without rendering upload content', () => {
    useGuidedComposerStore.getState().setComposerStep('review');

    const html = renderToStaticMarkup(
      <GuidedComposerShell>
        <div>Existing composer content</div>
      </GuidedComposerShell>
    );

    expect(html).toContain('Review and refine each platform-specific version.');
    expect(html).toContain(
      'The existing controls for this stage will be connected in the next implementation phase.'
    );
    expect(html).toContain('Continue to Publish');
    expect(html).not.toContain('Existing composer content');
  });

  it('shows the bounded final publish placeholder', () => {
    useGuidedComposerStore.getState().setComposerStep('publish');

    const html = renderToStaticMarkup(
      <GuidedComposerShell>
        <div>Existing composer content</div>
      </GuidedComposerShell>
    );

    expect(html).toContain(
      'Confirm the timing and destinations before publishing.'
    );
    expect(html).toContain('disabled=""');
    expect(html).not.toContain('Continue to');
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
