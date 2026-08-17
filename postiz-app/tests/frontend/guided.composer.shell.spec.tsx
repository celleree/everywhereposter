import React, { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mockFetch = jest.fn();

jest.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () => mockFetch,
}));

jest.mock('@gitroom/frontend/components/media/media.component', () => ({
  MediaBox: () => null,
}));

jest.mock('@gitroom/react/helpers/image.with.fallback', () => ({
  __esModule: true,
  default: ({ fallbackSrc: _fallbackSrc, ...props }: any) => <img {...props} />,
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
import {
  GuidedPublishSubmitResult,
  useRegisterGuidedComposerPublish,
} from '../../apps/frontend/src/components/new-launch/guided.composer.publish';

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

const PublishBridge = ({
  submitter,
}: {
  submitter: (request: any) => Promise<GuidedPublishSubmitResult>;
}) => {
  useRegisterGuidedComposerPublish(submitter, true);
  return <div>Existing composer content</div>;
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
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 'transcription-1',
        mediaId: 'video-1',
        generation: 1,
        status: 'READY',
        text: 'Persisted transcript.',
        error: null,
      }),
    });
    useGuidedComposerStore.getState().resetGuidedComposer();
    useLaunchStore.getState().reset();
    seedUploadedVideo();
  });

  it('requests transcription as soon as a guided video Media ID is selected', async () => {
    render(
      <GuidedComposerShell>
        <div>Existing composer content</div>
      </GuidedComposerShell>
    );

    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith(
        '/media/video-1/transcription/ensure',
        { method: 'POST' }
      )
    );
    expect(useGuidedComposerStore.getState()).toMatchObject({
      sourceMediaId: 'video-1',
      transcriptionStatus: 'READY',
    });
  });

  it('does not request transcription for a normal image upload', async () => {
    useLaunchStore.getState().setGlobalValueMedia(0, [
      {
        id: 'image-1',
        path: 'https://media.example.com/image.png',
        type: 'image',
      } as any,
    ]);

    render(
      <GuidedComposerShell>
        <div>Existing composer content</div>
      </GuidedComposerShell>
    );

    await act(async () => undefined);
    expect(mockFetch).not.toHaveBeenCalledWith(
      expect.stringContaining('/transcription/'),
      expect.anything()
    );
    expect(useGuidedComposerStore.getState().sourceMediaId).toBeNull();
  });

  it('shows a non-blocking transcription state while destinations remain available', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 'transcription-1',
        mediaId: 'video-1',
        generation: 1,
        status: 'PROCESSING',
        text: null,
        error: null,
      }),
    });

    const view = render(
      <GuidedComposerShell>
        <div>Existing composer content</div>
      </GuidedComposerShell>
    );

    expect(
      await screen.findByText('Transcribing… You can continue choosing destinations.')
    ).toBeTruthy();
    const continueButton = screen.getByRole('button', {
      name: 'Continue to Destinations',
    });
    expect(continueButton.hasAttribute('disabled')).toBe(false);
    fireEvent.click(continueButton);
    expect(useGuidedComposerStore.getState().composerStep).toBe('destinations');
    view.unmount();
  });

  it('replaces the explicit source, deletes the old media, and ignores late state', async () => {
    render(
      <GuidedComposerShell>
        <div>Existing composer content</div>
      </GuidedComposerShell>
    );
    await waitFor(() =>
      expect(useGuidedComposerStore.getState().sourceMediaId).toBe('video-1')
    );

    useGuidedComposerStore.getState().startGeneration('old-fingerprint');
    act(() => {
      useLaunchStore.getState().setGlobalValueMedia(0, [
        ...(useLaunchStore.getState().global[0]?.media || []),
        {
          id: 'video-2',
          path: 'https://media.example.com/replacement.mov',
          type: 'video',
        } as any,
      ]);
    });

    await waitFor(() =>
      expect(useGuidedComposerStore.getState().sourceMediaId).toBe('video-2')
    );
    expect(mockFetch).toHaveBeenCalledWith('/media/video-1', {
      method: 'DELETE',
    });
    expect(mockFetch).toHaveBeenCalledWith(
      '/media/video-2/transcription/ensure',
      { method: 'POST' }
    );
    expect(useLaunchStore.getState().global[0].media).toEqual([
      expect.objectContaining({ id: 'video-2' }),
    ]);
    expect(useGuidedComposerStore.getState().generationStatus).toBe('idle');

    act(() => {
      useGuidedComposerStore
        .getState()
        .setTranscriptionState('video-1', 'READY');
    });
    expect(useGuidedComposerStore.getState().sourceMediaId).toBe('video-2');
  });

  it('keeps the latest replacement when another video is selected during deletion', async () => {
    let resolveDeletion: ((response: { ok: boolean }) => void) | undefined;
    mockFetch.mockImplementation((url: string, options?: RequestInit) => {
      if (url === '/media/video-1' && options?.method === 'DELETE') {
        return new Promise((resolve) => {
          resolveDeletion = resolve;
        });
      }

      const mediaId = url.match(/^\/media\/([^/]+)\/transcription/)?.[1];
      return Promise.resolve({
        ok: true,
        json: async () => ({
          id: `transcription-${mediaId}`,
          mediaId,
          generation: 1,
          status: 'READY',
          text: 'Persisted transcript.',
          error: null,
        }),
      });
    });

    render(
      <GuidedComposerShell>
        <div>Existing composer content</div>
      </GuidedComposerShell>
    );
    await waitFor(() =>
      expect(useGuidedComposerStore.getState().sourceMediaId).toBe('video-1')
    );

    act(() => {
      useLaunchStore.getState().setGlobalValueMedia(0, [
        ...(useLaunchStore.getState().global[0]?.media || []),
        {
          id: 'video-2',
          path: 'https://media.example.com/replacement-1.mov',
          type: 'video',
        } as any,
      ]);
    });
    await waitFor(() => expect(resolveDeletion).toBeDefined());

    act(() => {
      useLaunchStore.getState().setGlobalValueMedia(0, [
        ...(useLaunchStore.getState().global[0]?.media || []),
        {
          id: 'video-3',
          path: 'https://media.example.com/replacement-2.mp4',
          type: 'video',
        } as any,
      ]);
    });
    await act(async () => resolveDeletion?.({ ok: true }));

    await waitFor(() =>
      expect(useGuidedComposerStore.getState().sourceMediaId).toBe('video-3')
    );
    expect(useGuidedComposerStore.getState().sourceMediaId).not.toBe('video-2');
  });

  it('invalidates and backend-deletes the guided source on attachment removal', async () => {
    render(
      <GuidedComposerShell>
        <div>Existing composer content</div>
      </GuidedComposerShell>
    );
    await waitFor(() =>
      expect(useGuidedComposerStore.getState().sourceMediaId).toBe('video-1')
    );

    act(() => useLaunchStore.getState().setGlobalValueMedia(0, []));

    await waitFor(() =>
      expect(useGuidedComposerStore.getState().sourceMediaId).toBeNull()
    );
    expect(mockFetch).toHaveBeenCalledWith('/media/video-1', {
      method: 'DELETE',
    });
    expect(useGuidedComposerStore.getState()).toMatchObject({
      transcriptionStatus: 'IDLE',
      generationStatus: 'idle',
    });
  });

  it('restores the guided source when backend deletion is not confirmed', async () => {
    let resolveDeletion: ((response: { ok: boolean }) => void) | undefined;
    mockFetch.mockImplementation((url: string, options?: RequestInit) => {
      if (url === '/media/video-1' && options?.method === 'DELETE') {
        return new Promise((resolve) => {
          resolveDeletion = resolve;
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({
          id: 'transcription-1',
          mediaId: 'video-1',
          generation: 1,
          status: 'READY',
          text: 'Persisted transcript.',
          error: null,
        }),
      });
    });
    render(
      <GuidedComposerShell>
        <div>Existing composer content</div>
      </GuidedComposerShell>
    );
    await waitFor(() =>
      expect(useGuidedComposerStore.getState().sourceMediaId).toBe('video-1')
    );

    act(() => useLaunchStore.getState().setGlobalValueMedia(0, []));

    await waitFor(() => expect(resolveDeletion).toBeDefined());
    expect(useGuidedComposerStore.getState().sourceMediaId).toBe('video-1');
    expect(useLaunchStore.getState().global[0].media).toEqual([
      expect.objectContaining({ id: 'video-1' }),
    ]);

    act(() => resolveDeletion?.({ ok: false }));

    expect(
      await screen.findByText(
        'The previous video could not be removed. Please try again.'
      )
    ).toBeTruthy();
    expect(useGuidedComposerStore.getState().sourceMediaId).toBe('video-1');
    expect(useLaunchStore.getState().global[0].media).toEqual([
      expect.objectContaining({ id: 'video-1' }),
    ]);
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
      screen
        .getByRole('radio', { name: /Create captions for me/ })
        .hasAttribute('checked')
    ).toBe(true);
    expect(
      screen.getByRole('button', { name: 'Continue to Destinations' })
    ).toBeTruthy();
    expect(screen.getByText('Step 1 of 4')).toBeTruthy();
    expect(screen.getByText('Step 4 of 4')).toBeTruthy();
  });

  it('keeps the existing provider settings section visible on Guided Upload', () => {
    render(
      <GuidedComposerShell>
        <div id="social-content">
          <section
            data-testid="guided-settings-section"
            data-guided-composer-section="settings"
          >
            Existing provider settings
          </section>
          <section data-testid="unguided-section">Unrelated section</section>
        </div>
      </GuidedComposerShell>
    );

    expect(
      window.getComputedStyle(screen.getByTestId('guided-settings-section'))
        .display
    ).not.toBe('none');
    expect(
      window.getComputedStyle(screen.getByTestId('unguided-section')).display
    ).toBe('none');
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
    expect(
      screen.getByText('Upload progress and cancel controls')
    ).toBeTruthy();
  });

  it('allows a valid legacy text draft to continue without media', () => {
    useLaunchStore.getState().setGlobalValueMedia(0, []);
    useLaunchStore.getState().setGlobalValueText(0, 'A normal text-only post.');

    render(
      <GuidedComposerShell>
        <div>Existing composer content</div>
      </GuidedComposerShell>
    );

    const continueButton = screen.getByRole('button', {
      name: 'Continue to Destinations',
    });
    expect(continueButton.hasAttribute('disabled')).toBe(false);
    expect(screen.queryByLabelText('Additional context')).toBeNull();

    fireEvent.click(continueButton);
    expect(useGuidedComposerStore.getState().composerStep).toBe('destinations');
  });

  it('keeps an empty legacy draft blocked', () => {
    useLaunchStore.getState().setGlobalValueMedia(0, []);

    render(
      <GuidedComposerShell>
        <div>Existing composer content</div>
      </GuidedComposerShell>
    );

    expect(
      screen.getByText('Enter post text or add media to continue.')
    ).toBeTruthy();
    expect(
      screen
        .getByRole('button', { name: 'Continue to Destinations' })
        .hasAttribute('disabled')
    ).toBe(true);
  });

  it('allows an image-only legacy draft and preserves its media', () => {
    const image = {
      id: 'image-1',
      path: 'https://media.example.com/image.png',
      type: 'image',
    } as any;
    useLaunchStore.getState().setGlobalValueMedia(0, [image]);

    render(
      <GuidedComposerShell>
        <div>Existing composer content</div>
      </GuidedComposerShell>
    );

    const continueButton = screen.getByRole('button', {
      name: 'Continue to Destinations',
    });
    expect(continueButton.hasAttribute('disabled')).toBe(false);
    expect(screen.queryByLabelText('Additional context')).toBeNull();

    fireEvent.click(continueButton);
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));

    expect(useLaunchStore.getState().global[0].media).toEqual([image]);
  });

  it('does not treat an unsupported WebM library asset as a valid source', () => {
    useLaunchStore.getState().setGlobalValueMedia(0, [
      {
        id: 'webm-video',
        path: 'https://media.example.com/video.webm',
        type: 'video',
      } as any,
    ]);

    render(
      <GuidedComposerShell>
        <div>Existing composer content</div>
      </GuidedComposerShell>
    );

    expect(
      screen.getByText('Upload an MP4 or MOV video to continue.')
    ).toBeTruthy();
    expect(
      screen
        .getByRole('button', { name: 'Continue to Destinations' })
        .hasAttribute('disabled')
    ).toBe(true);
    expect(mockFetch).not.toHaveBeenCalledWith(
      expect.stringContaining('/transcription/'),
      expect.anything()
    );
  });

  it('requires and preserves a user caption for caption-based modes', () => {
    render(
      <GuidedComposerShell>
        <div>Existing composer content</div>
      </GuidedComposerShell>
    );

    const continueButton = screen.getByRole('button', {
      name: 'Continue to Destinations',
    });
    expect(continueButton.hasAttribute('disabled')).toBe(false);

    fireEvent.change(screen.getByLabelText('Additional context'), {
      target: { value: 'Use the founder audience and mention the beta.' },
    });
    fireEvent.click(
      screen.getByRole('radio', {
        name: /Use my caption on every platform/,
      })
    );

    expect(screen.getByText('Enter your caption to continue.')).toBeTruthy();
    expect(continueButton.hasAttribute('disabled')).toBe(true);

    fireEvent.change(screen.getByLabelText('Your caption'), {
      target: { value: 'One caption for every platform.' },
    });
    expect(continueButton.hasAttribute('disabled')).toBe(false);

    fireEvent.click(
      screen.getByRole('radio', {
        name: /Adapt my caption for each platform/,
      })
    );

    fireEvent.change(screen.getByLabelText('Your caption'), {
      target: { value: '' },
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

  it('does not mutate mixed image and supported video media', () => {
    const mixedMedia = [
      {
        id: 'image-1',
        path: 'https://media.example.com/image.png',
        type: 'image',
      },
      {
        id: 'video-1',
        path: 'https://media.example.com/video.mp4',
        type: 'video',
      },
    ] as any;
    useLaunchStore.getState().setGlobalValueMedia(0, mixedMedia);

    render(
      <GuidedComposerShell>
        <div>Existing composer content</div>
      </GuidedComposerShell>
    );

    expect(useLaunchStore.getState().global[0].media).toEqual(mixedMedia);
    expect(screen.getByLabelText('Additional context')).toBeTruthy();

    fireEvent.click(
      screen.getByRole('radio', {
        name: /Adapt my caption for each platform/,
      })
    );
    const continueButton = screen.getByRole('button', {
      name: 'Continue to Destinations',
    });
    expect(continueButton.hasAttribute('disabled')).toBe(true);
    expect(useLaunchStore.getState().global[0].media).toEqual(mixedMedia);

    fireEvent.change(screen.getByLabelText('Your caption'), {
      target: { value: 'One video caption for every destination.' },
    });
    expect(continueButton.hasAttribute('disabled')).toBe(false);
    expect(useLaunchStore.getState().global[0].media).toEqual(mixedMedia);
  });

  it('renders the Review step while hiding upload content', async () => {
    const integration = {
      id: 'linkedin-account',
      name: 'Founder LinkedIn',
      identifier: 'linkedin',
      display: 'LinkedIn',
      disabled: false,
      inBetweenSteps: false,
    } as any;
    useLaunchStore.getState().setAllIntegrations([integration]);
    useLaunchStore
      .getState()
      .setSelectedIntegrations([
        { selectedIntegrations: integration, settings: {} },
      ]);
    useLaunchStore.getState().setGlobalValueMedia(0, []);
    useLaunchStore
      .getState()
      .setGlobalValueText(0, '<p>Original review caption</p>');
    useGuidedComposerStore.getState().setComposerStep('review');

    render(
      <GuidedComposerShell>
        <div>Existing composer content</div>
      </GuidedComposerShell>
    );

    expect(
      await screen.findByLabelText('Founder LinkedIn caption')
    ).toBeTruthy();
    expect(screen.getByText('Destinations selected')).toBeTruthy();
    expect(screen.queryByText(/existing controls for this stage/)).toBeNull();
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

  it('renders the final Publish step and locks navigation during submission', async () => {
    const integration = {
      id: 'linkedin-account',
      name: 'Founder LinkedIn',
      identifier: 'linkedin',
      display: 'LinkedIn',
      picture: '',
      disabled: false,
      inBetweenSteps: false,
    } as any;
    useLaunchStore.getState().setAllIntegrations([integration]);
    useLaunchStore
      .getState()
      .setSelectedIntegrations([
        { selectedIntegrations: integration, settings: {} },
      ]);
    useLaunchStore.getState().setGlobalValueMedia(0, []);
    useLaunchStore.getState().setGlobalValueText(0, 'Final global caption');
    useLaunchStore.getState().setChars(integration.id, 3000);
    useGuidedComposerStore.getState().reconcileReviewDrafts([
      {
        destinationId: integration.id,
        platform: 'linkedin',
        sourceFingerprint: 'publish-shell-review',
        caption: 'Final reviewed caption.',
        baselineCaption: 'Generated caption.',
        baselineSource: 'generated',
        originalCaption: 'Original caption.',
        warnings: [],
      },
    ]);
    useGuidedComposerStore.getState().setComposerStep('publish');
    let resolveSubmission:
      | ((result: GuidedPublishSubmitResult) => void)
      | undefined;
    const submitter = jest.fn(
      () =>
        new Promise<GuidedPublishSubmitResult>((resolve) => {
          resolveSubmission = resolve;
        })
    );
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        posts: [{ id: 'published-post', state: 'PUBLISHED' }],
      }),
    });

    render(
      <GuidedComposerShell>
        <PublishBridge submitter={submitter} />
      </GuidedComposerShell>
    );

    expect(
      screen.getByText('Confirm the timing and destinations before publishing.')
    ).toBeTruthy();
    expect(screen.getByText('Confirm your post')).toBeTruthy();
    const publishButton = await screen.findByRole('button', {
      name: 'Publish now',
    });
    expect(publishButton.hasAttribute('disabled')).toBe(false);
    expect(screen.queryByRole('button', { name: /Continue to/ })).toBeNull();
    expect(screen.queryByText(/existing controls for this stage/)).toBeNull();

    fireEvent.click(publishButton);
    expect(screen.getByRole('button', { name: 'Back' }).hasAttribute('disabled')).toBe(
      true
    );

    await act(async () => {
      resolveSubmission?.({
        ok: true,
        posts: [
          { postId: 'published-post', integration: integration.id },
        ],
      });
    });

    expect(
      await screen.findByText(
        'Publishing was confirmed for every enabled destination.'
      )
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Back' }).hasAttribute('disabled')).toBe(
      false
    );

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Continue to Publish' })
    );

    expect(
      await screen.findByText(
        'Publishing was confirmed for every enabled destination.'
      )
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Publish now' }).hasAttribute('disabled')
    ).toBe(true);
    expect(submitter).toHaveBeenCalledTimes(1);
  });

  it('preserves an ambiguous publish lock across Back navigation', async () => {
    const integration = {
      id: 'linkedin-account',
      name: 'Founder LinkedIn',
      identifier: 'linkedin',
      display: 'LinkedIn',
      picture: '',
      disabled: false,
      inBetweenSteps: false,
    } as any;
    useLaunchStore.getState().setAllIntegrations([integration]);
    useLaunchStore
      .getState()
      .setSelectedIntegrations([
        { selectedIntegrations: integration, settings: {} },
      ]);
    useLaunchStore.getState().setGlobalValueMedia(0, []);
    useLaunchStore.getState().setGlobalValueText(0, 'Final global caption');
    useLaunchStore.getState().setChars(integration.id, 3000);
    useGuidedComposerStore.getState().reconcileReviewDrafts([
      {
        destinationId: integration.id,
        platform: 'linkedin',
        sourceFingerprint: 'ambiguous-publish-review',
        caption: 'Final reviewed caption.',
        baselineCaption: 'Generated caption.',
        baselineSource: 'generated',
        originalCaption: 'Original caption.',
        warnings: [],
      },
    ]);
    useGuidedComposerStore.getState().setComposerStep('publish');
    const submitter = jest.fn().mockResolvedValue({
      ok: false,
      kind: 'transport',
      message: 'The connection closed before a response arrived.',
      ambiguous: true,
    });

    render(
      <GuidedComposerShell>
        <PublishBridge submitter={submitter} />
      </GuidedComposerShell>
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Publish now' }));
    expect((await screen.findByRole('alert')).textContent).toContain(
      'The connection closed before a response arrived.'
    );
    expect(screen.queryByRole('button', { name: 'Prepare retry' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Continue to Publish' })
    );

    expect((await screen.findByRole('alert')).textContent).toContain(
      'The connection closed before a response arrived.'
    );
    expect(
      screen.getByRole('button', { name: 'Publish now' }).hasAttribute('disabled')
    ).toBe(true);
    expect(submitter).toHaveBeenCalledTimes(1);
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
    expect(shouldUseGuidedComposerShell({ enabled: true, dummy: true })).toBe(
      false
    );
  });
});
