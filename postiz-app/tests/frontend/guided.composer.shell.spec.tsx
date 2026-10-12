import React, { useState } from 'react';
import { TextEncoder, TextDecoder } from 'node:util';
Object.assign(global, { TextEncoder, TextDecoder });
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

  const quickAccounts = [
    {
      id: 'quick-x',
      name: 'Quick X',
      identifier: 'x',
      type: 'social',
      inBetweenSteps: false,
    },
    {
      id: 'quick-linkedin',
      name: 'Quick LinkedIn',
      identifier: 'linkedin',
      type: 'social',
      inBetweenSteps: false,
    },
    {
      id: 'disabled',
      name: 'Disabled account',
      identifier: 'x',
      type: 'social',
      disabled: true,
    },
    {
      id: 'reconnect',
      name: 'Reconnect account',
      identifier: 'facebook',
      type: 'social',
      refreshNeeded: true,
    },
    {
      id: 'unsupported',
      name: 'Blog account',
      identifier: 'medium',
      type: 'social',
    },
    {
      id: 'tiktok',
      name: 'TikTok account',
      identifier: 'tiktok',
      type: 'social',
    },
  ] as any[];
  const quickResponse = (overrides: any = {}) => ({
    requestId: 'quick-generation',
    status: 'complete',
    sourceConfidence: 0.8,
    warnings: [],
    imagePlans: [],
    results: ['x', 'linkedin'].map((platform) => ({
      platform,
      draft: `${platform} grounded caption`,
      origin: 'generated',
      warnings: [],
      charCount: 25,
    })),
    ...overrides,
  });
  const quickFetch = (generation = quickResponse(), accounts = quickAccounts) => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url === '/integrations/list')
        return { ok: true, json: async () => ({ integrations: accounts }) };
      if (url === '/posts/copy/generate') {
        let read = false;
        const bytes = new TextEncoder().encode(
          JSON.stringify({ name: 'completed', data: generation }) + '\n'
        );
        return {
          ok: true,
          body: {
            getReader: () => ({
              read: async () =>
                read
                  ? { done: true }
                  : ((read = true), { done: false, value: bytes }),
            }),
          },
        };
      }
      if (url.startsWith('/posts/'))
        return {
          ok: true,
          json: async () => ({ posts: [{ state: 'PUBLISHED' }] }),
        };
      return { ok: true, json: async () => ({ status: 'READY', text: '' }) };
    });
  };
  const renderQuick = (submitter: any) =>
    render(
      <GuidedComposerShell>
        <PublishBridge submitter={submitter} />
      </GuidedComposerShell>
    );

  it('runs Quick Upload once with dynamic accounts, generated copy and visible exclusions', async () => {
    quickFetch();
    const submitter = jest.fn(async () => ({
      ok: true,
      posts: [
        { postId: 'posted-x', integration: 'quick-x' },
        { postId: 'posted-linkedin', integration: 'quick-linkedin' },
      ],
    }));
    renderQuick(submitter);
    expect(screen.getByText(/without individual review/)).toBeTruthy();
    const quick = screen.getByRole('button', {
      name: 'Quick Upload',
      exact: true,
    });
    fireEvent.click(quick);
    fireEvent.click(quick);
    await waitFor(() => expect(submitter).toHaveBeenCalledTimes(1));
    expect(submitter).toHaveBeenCalledWith({
      type: 'now',
      quickUpload: true,
      sourceMediaId: 'video-1',
      destinationIds: ['quick-x', 'quick-linkedin'],
      captionOverrides: {
        'quick-x': 'x grounded caption',
        'quick-linkedin': 'linkedin grounded caption',
      },
    });
    await waitFor(() => expect(screen.getAllByText('Published')).toHaveLength(2));
    expect(screen.getByText('Quick Upload results')).toBeTruthy();
    expect(screen.queryByText(/captions approved in Review/)).toBeNull();
    expect(screen.getByTestId('quick-skip-disabled').textContent).toContain(
      'disabled'
    );
    expect(screen.getByTestId('quick-skip-reconnect').textContent).toContain(
      'Reconnect required'
    );
    expect(screen.getByTestId('quick-skip-tiktok').textContent).toContain(
      'privacy'
    );
    expect(useLaunchStore.getState().global[0].media[0].id).toBe('video-1');
  });

  it('publishes a valid partial result while skipping missing platform copy', async () => {
    quickFetch(
      quickResponse({
        status: 'partial',
        warnings: [
          {
            code: 'PLATFORM_GENERATION_FAILED',
            message: 'LinkedIn generation failed',
          },
        ],
        results: quickResponse().results.slice(0, 1),
      })
    );
    const submitter = jest.fn(async () => ({
      ok: true,
      posts: [{ postId: 'posted-x', integration: 'quick-x' }],
    }));
    renderQuick(submitter);
    fireEvent.click(
      screen.getByRole('button', { name: 'Quick Upload', exact: true })
    );
    await waitFor(() => expect(submitter).toHaveBeenCalledTimes(1));
    expect(submitter.mock.calls[0][0].destinationIds).toEqual(['quick-x']);
    expect(screen.getByTestId('quick-skip-quick-linkedin').textContent).toContain(
      'Skipped'
    );
  });

  it('retains valid no-speech visual generation without substituting fallback captions', async () => {
    quickFetch(
      quickResponse({
        warnings: [
          {
            code: 'NO_TRANSCRIPT',
            message: 'No speech; grounded frames available',
          },
        ],
      })
    );
    const submitter = jest.fn(async () => ({
      ok: true,
      posts: [
        { postId: 'posted-x', integration: 'quick-x' },
        { postId: 'posted-linkedin', integration: 'quick-linkedin' },
      ],
    }));
    renderQuick(submitter);
    fireEvent.click(
      screen.getByRole('button', { name: 'Quick Upload', exact: true })
    );
    await waitFor(() => expect(submitter).toHaveBeenCalledTimes(1));
  });

  it.each([
    'no accounts',
    'generation failed',
    'warning',
    'blank caption',
    'fallback caption',
  ])(
    'does not publish for %s and keeps media available for Customize',
    async (failure) => {
      const generation = quickResponse();
      if (failure === 'generation failed')
        Object.assign(generation, { status: 'failed', results: [] });
      if (failure === 'warning')
        generation.warnings = [
          { code: 'SOURCE_FACTS_THIN', message: 'Review weak grounding' },
        ] as any;
      if (failure === 'blank caption')
        generation.results.forEach((result) => (result.draft = ''));
      if (failure === 'fallback caption')
        generation.results.forEach((result) => (result.origin = 'original'));
      quickFetch(generation, failure === 'no accounts' ? [] : quickAccounts);
      const submitter = jest.fn();
      renderQuick(submitter);
      fireEvent.click(
        screen.getByRole('button', { name: 'Quick Upload', exact: true })
      );
      await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
      expect(submitter).not.toHaveBeenCalled();
      fireEvent.click(
        screen.getByRole('button', { name: 'Customize', exact: true })
      );
      expect(useLaunchStore.getState().global[0].media[0].id).toBe('video-1');
    }
  );

  it('keeps uncertain submissions locked in the automatic path', async () => {
    quickFetch();
    const submitter = jest.fn(async () => ({
      ok: false,
      kind: 'transport',
      ambiguous: true,
      message: 'Response lost',
    }));
    renderQuick(submitter);
    fireEvent.click(
      screen.getByRole('button', { name: 'Quick Upload', exact: true })
    );
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('Response lost')
    );
    expect(submitter).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Prepare retry' })).toBeNull();
    await act(async () => undefined);
    expect(submitter).toHaveBeenCalledTimes(1);
  });

  it.each(['failed', 'reconnect-required'])(
    'retains partial success and %s without resubmission',
    async (status) => {
      quickFetch();
      const originalFetch = mockFetch.getMockImplementation()!;
      mockFetch.mockImplementation(async (url: string, options: any) =>
        url === '/posts/posted-linkedin'
          ? {
              ok: true,
              json: async () => ({
                posts: [
                  {
                    id: 'posted-linkedin',
                    state: 'ERROR',
                    error: 'Provider rejected the video',
                    integration: {
                      refreshNeeded: status === 'reconnect-required',
                    },
                  },
                ],
              }),
            }
          : originalFetch(url, options)
      );
      const submitter = jest.fn(async () => ({
        ok: true,
        posts: [
          { postId: 'posted-x', integration: 'quick-x' },
          { postId: 'posted-linkedin', integration: 'quick-linkedin' },
        ],
      }));
      renderQuick(submitter);
      fireEvent.click(
        screen.getByRole('button', { name: 'Quick Upload', exact: true })
      );
      await waitFor(() =>
        expect(
          screen.getByTestId('guided-publish-destination-quick-x').textContent
        ).toContain('Published')
      );
      expect(
        screen.getByTestId('guided-publish-destination-quick-linkedin')
          .textContent
      ).toContain(status === 'failed' ? 'Failed' : 'Reconnect required');
      expect(submitter).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole('button', { name: 'Prepare retry' })).toBeNull();
    }
  );

  it('treats an unexpected thrown submission as uncertain and never auto-retries', async () => {
    quickFetch();
    const submitter = jest.fn(async () => {
      throw new Error('Response lost after submission');
    });
    renderQuick(submitter);
    fireEvent.click(
      screen.getByRole('button', { name: 'Quick Upload', exact: true })
    );
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain(
        'Response lost after submission'
      )
    );
    expect(submitter).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Prepare retry' })).toBeNull();
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

  it('replaces the source by detaching it without library deletion and ignores late state', async () => {
    render(
      <GuidedComposerShell>
        <div>Existing composer content</div>
      </GuidedComposerShell>
    );
    await waitFor(() =>
      expect(useGuidedComposerStore.getState().sourceMediaId).toBe('video-1')
    );

    act(() =>
      useGuidedComposerStore.getState().startGeneration('old-fingerprint')
    );
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
    expect(
      mockFetch.mock.calls.some(([, options]) => options?.method === 'DELETE')
    ).toBe(false);
    expect(mockFetch).toHaveBeenCalledWith(
      '/media/video-2/transcription/ensure',
      { method: 'POST' }
    );
    expect(useLaunchStore.getState().global[0].media).toEqual([
      expect.objectContaining({ id: 'video-2' }),
    ]);
    expect(useGuidedComposerStore.getState().generationStatus).toBe('idle');

    act(() => {
      useGuidedComposerStore.getState().setTranscriptionState('video-1', 'READY');
    });
    expect(useGuidedComposerStore.getState().sourceMediaId).toBe('video-2');
  });

  it('preserves unrelated attachments and their order when replacing the source', async () => {
    const image = { id: 'image-1', path: '/image.png' };
    const otherVideo = { id: 'video-other', path: '/other.mp4' };
    useLaunchStore
      .getState()
      .setGlobalValueMedia(0, [
        image,
        ...useLaunchStore.getState().global[0].media,
        otherVideo,
      ]);
    render(
      <GuidedComposerShell>
        <div>Composer</div>
      </GuidedComposerShell>
    );
    await waitFor(() =>
      expect(useGuidedComposerStore.getState().sourceMediaId).toBe('video-1')
    );
    const replacement = { id: 'video-2', path: '/replacement.mov' };
    act(() => useLaunchStore.getState().appendGlobalValueMedia(0, [replacement]));
    await waitFor(() =>
      expect(useGuidedComposerStore.getState().sourceMediaId).toBe('video-2')
    );
    expect(useLaunchStore.getState().global[0].media).toEqual([
      image,
      otherVideo,
      replacement,
    ]);
    expect(
      mockFetch.mock.calls.some(([, options]) => options?.method === 'DELETE')
    ).toBe(false);
  });

  it.each(['image-1', 'video-1', 'video-other'])(
    'detaches %s without restoring it or changing unrelated attachments',
    async (mediaId) => {
      const attachments = [
        { id: 'image-1', path: '/image.png' },
        { id: 'video-1', path: '/video.mp4' },
        { id: 'video-other', path: '/other.mov' },
      ];
      useLaunchStore.getState().setGlobalValueMedia(0, attachments);
      render(
        <GuidedComposerShell>
          <div>Composer</div>
        </GuidedComposerShell>
      );
      await waitFor(() =>
        expect(useGuidedComposerStore.getState().sourceMediaId).toBe('video-1')
      );
      act(() => useLaunchStore.getState().detachGlobalValueMedia(0, mediaId));
      await waitFor(() =>
        expect(useLaunchStore.getState().global[0].media).toEqual(
          attachments.filter((item) => item.id !== mediaId)
        )
      );
      expect(
        mockFetch.mock.calls.some(([, options]) => options?.method === 'DELETE')
      ).toBe(false);
      expect(screen.queryByRole('button', { name: 'Retry cleanup' })).toBeNull();
    }
  );

  it('invalidates generated review state when the final source is detached', async () => {
    render(
      <GuidedComposerShell>
        <div>Composer</div>
      </GuidedComposerShell>
    );
    await waitFor(() =>
      expect(useGuidedComposerStore.getState().sourceMediaId).toBe('video-1')
    );
    act(() => {
      useGuidedComposerStore.getState().startGeneration('video-1-generation');
      useGuidedComposerStore.getState().reconcileReviewDrafts([
        {
          destinationId: 'linkedin-1',
          platform: 'linkedin',
          sourceFingerprint: 'video-1-generation',
          caption: 'Caption',
          baselineCaption: 'Caption',
          baselineSource: 'generated',
          originalCaption: 'Caption',
          warnings: [],
        },
      ]);
      useLaunchStore.getState().detachGlobalValueMedia(0, 'video-1');
    });
    await waitFor(() =>
      expect(useGuidedComposerStore.getState()).toMatchObject({
        sourceMediaId: null,
        transcriptionStatus: 'IDLE',
        generationStatus: 'idle',
        reviewDrafts: {},
      })
    );
    expect(useLaunchStore.getState().global[0].media).toEqual([]);
    expect(
      mockFetch.mock.calls.some(([, options]) => options?.method === 'DELETE')
    ).toBe(false);
  });

  it('does not restore a detached source when its pending transcription completes', async () => {
    let finishTranscription: (response: any) => void = () => {};
    mockFetch.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishTranscription = resolve;
        })
    );
    render(
      <GuidedComposerShell>
        <div>Composer</div>
      </GuidedComposerShell>
    );
    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith(
        '/media/video-1/transcription/ensure',
        { method: 'POST' }
      )
    );
    act(() => useLaunchStore.getState().detachGlobalValueMedia(0, 'video-1'));
    await act(async () =>
      finishTranscription({
        ok: true,
        json: async () => ({ mediaId: 'video-1', status: 'READY', text: null }),
      })
    );
    expect(useLaunchStore.getState().global[0].media).toEqual([]);
    expect(useGuidedComposerStore.getState()).toMatchObject({
      sourceMediaId: null,
      transcriptionStatus: 'IDLE',
    });
    expect(
      mockFetch.mock.calls.some(([, options]) => options?.method === 'DELETE')
    ).toBe(false);
  });

  it('allows intentional re-addition of the same library source after detachment', async () => {
    const video = useLaunchStore.getState().global[0].media[0];
    render(
      <GuidedComposerShell>
        <div>Composer</div>
      </GuidedComposerShell>
    );
    await waitFor(() =>
      expect(useGuidedComposerStore.getState().sourceMediaId).toBe(video.id)
    );
    act(() => useLaunchStore.getState().detachGlobalValueMedia(0, video.id));
    await waitFor(() =>
      expect(useGuidedComposerStore.getState().sourceMediaId).toBeNull()
    );
    act(() => useLaunchStore.getState().appendGlobalValueMedia(0, [video]));
    await waitFor(() =>
      expect(useGuidedComposerStore.getState().sourceMediaId).toBe(video.id)
    );
    expect(useLaunchStore.getState().global[0].media).toEqual([video]);
    expect(
      mockFetch.mock.calls.some(([, options]) => options?.method === 'DELETE')
    ).toBe(false);
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
    ).toHaveLength(1); // The shell-owned helper remains pending its coordinated removal.
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
    expect(screen.getByLabelText('Additional context')).toBeTruthy();

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
      screen.getAllByRole('radio', {
        name: /Use my caption on every platform/,
      }).at(-1)!
    );

    expect(screen.getByText('Enter your caption to continue.')).toBeTruthy();
    expect(continueButton.hasAttribute('disabled')).toBe(true);

    fireEvent.change(screen.getAllByLabelText('Your caption').at(-1)!, {
      target: { value: 'One caption for every platform.' },
    });
    expect(continueButton.hasAttribute('disabled')).toBe(false);

    fireEvent.click(
      screen.getAllByRole('radio', {
        name: /Adapt my caption for each platform/,
      }).at(-1)!
    );

    fireEvent.change(screen.getAllByLabelText('Your caption').at(-1)!, {
      target: { value: '' },
    });
    expect(screen.getByText('Enter your caption to continue.')).toBeTruthy();
    expect(continueButton.hasAttribute('disabled')).toBe(true);

    fireEvent.change(screen.getAllByLabelText('Your caption').at(-1)!, {
      target: { value: 'One video should not die on one platform.' },
    });

    expect(continueButton.hasAttribute('disabled')).toBe(false);
    fireEvent.click(continueButton);
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));

    expect(
      (screen.getByLabelText('Additional context') as HTMLTextAreaElement).value
    ).toBe('Use the founder audience and mention the beta.');
    expect(
      (screen.getAllByLabelText('Your caption').at(-1)! as HTMLTextAreaElement).value
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
      screen.getAllByRole('radio', {
        name: /Adapt my caption for each platform/,
      }).at(-1)!
    );
    const continueButton = screen.getByRole('button', {
      name: 'Continue to Destinations',
    });
    expect(continueButton.hasAttribute('disabled')).toBe(true);
    expect(useLaunchStore.getState().global[0].media).toEqual(mixedMedia);

    fireEvent.change(screen.getAllByLabelText('Your caption').at(-1)!, {
      target: { value: 'One video caption for every destination.' },
    });
    expect(continueButton.hasAttribute('disabled')).toBe(false);
    expect(useLaunchStore.getState().global[0].media).toEqual(mixedMedia);
  });

  it('renders Review with the existing editor available for mobile platform posts', async () => {
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
        .classList.contains('guided-review-existing-editor')
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

  it('aborts an active generation request when the composer unmounts', async () => {
    const integration = {
      id: 'linkedin-account',
      name: 'Founder LinkedIn',
      identifier: 'linkedin',
      display: 'LinkedIn',
      disabled: false,
      inBetweenSteps: false,
    } as any;
    let generationSignal: AbortSignal | undefined;
    useLaunchStore.getState().setAllIntegrations([integration]);
    useLaunchStore.getState().setSelectedIntegrations([
      { selectedIntegrations: integration, settings: {} },
    ]);
    useGuidedComposerStore.setState({
      composerStep: 'destinations',
      sourceMediaId: 'video-1',
      transcriptionStatus: 'READY',
    });
    mockFetch.mockImplementation(
      (_url: string, options?: RequestInit) =>
        new Promise((_resolve, reject) => {
          generationSignal = options?.signal || undefined;
          generationSignal?.addEventListener(
            'abort',
            () => {
              const error = new Error('Generation aborted');
              error.name = 'AbortError';
              reject(error);
            },
            { once: true }
          );
        })
    );

    const view = render(
      <GuidedComposerShell>
        <div>Existing composer content</div>
      </GuidedComposerShell>
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Continue to Review' })
    );

    await waitFor(() => expect(generationSignal).toBeDefined());
    expect(generationSignal?.aborted).toBe(false);
    view.unmount();
    expect(generationSignal?.aborted).toBe(true);
    await waitFor(() =>
      expect(useGuidedComposerStore.getState()).toMatchObject({
        composerStep: 'upload',
        generationStatus: 'idle',
        generationError: null,
      })
    );
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

describe('compact composer progress', () => {
  beforeEach(() => {
    useLaunchStore.getState().reset();
    useGuidedComposerStore.getState().resetGuidedComposer();
  });

  it.each(['upload', 'destinations', 'review', 'publish'] as const)('tracks the existing %s state with exactly four steps', (step) => {
    useGuidedComposerStore.getState().setComposerStep(step);
    render(<GuidedComposerShell><div>Existing composer</div></GuidedComposerShell>);
    const nav = screen.getByRole('navigation', { name: 'Post creation progress' });
    expect(nav.querySelectorAll('button')).toHaveLength(4);
    expect(nav.querySelectorAll('[aria-current="step"]')).toHaveLength(1);
    expect(nav.querySelector('[aria-current="step"]')?.getAttribute('aria-label')?.toLowerCase()).toContain(step);
  });
});
