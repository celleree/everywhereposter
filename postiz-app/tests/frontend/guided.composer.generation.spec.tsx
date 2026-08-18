import React from 'react';
import { TextDecoder, TextEncoder } from 'util';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';

const mockFetch = jest.fn();

jest.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () => mockFetch,
}));

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
  () => ({ PostComment: { ALL: 'ALL' } })
);

jest.mock('@gitroom/react/helpers/image.with.fallback', () => ({
  __esModule: true,
  default: ({ fallbackSrc: _fallbackSrc, ...props }: any) => <img {...props} />,
}));

import { GuidedComposerShell } from '../../apps/frontend/src/components/new-launch/guided.composer.shell';
import { buildGuidedGenerationFingerprint } from '../../apps/frontend/src/components/new-launch/guided.composer.generation';
import { useGuidedComposerStore } from '../../apps/frontend/src/components/new-launch/guided.composer.store';
import { useLaunchStore } from '../../apps/frontend/src/components/new-launch/store';

Object.assign(global, { TextEncoder, TextDecoder });

const linkedinPersonal = {
  id: 'linkedin-personal',
  name: 'Founder LinkedIn',
  identifier: 'linkedin',
  display: 'Founder',
  disabled: false,
  inBetweenSteps: false,
} as any;

const linkedinPage = {
  id: 'linkedin-page',
  name: 'Company LinkedIn',
  identifier: 'linkedin-page',
  display: 'Company',
  disabled: false,
  inBetweenSteps: false,
} as any;

const unsupportedDestination = {
  id: 'mastodon-account',
  name: 'Mastodon',
  identifier: 'mastodon',
  display: 'Mastodon',
  disabled: false,
  inBetweenSteps: false,
} as any;

const result = {
  platform: 'linkedin',
  draft: 'A platform-specific LinkedIn draft.',
  origin: 'generated',
  charCount: 37,
  confidence: 0.9,
  antiGenericScore: 0.9,
  rewritten: false,
  warnings: [],
} as const;

const response = (status: 'complete' | 'partial' | 'failed' = 'complete') => ({
  requestId: `request-${status}`,
  status,
  sourceConfidence: 0.9,
  warnings:
    status === 'failed'
      ? [{ code: 'GENERATION_FAILED', message: 'Generation failed safely.' }]
      : [],
  results: status === 'failed' ? [] : [result],
  imagePlans: [],
});

const streamResponse = (payload: ReturnType<typeof response>) => {
  const chunks = [
    `${JSON.stringify({ name: 'copy-generation-started', data: {} })}\n`,
    `${JSON.stringify({
      name: 'completed',
      data: payload,
    })}\n`,
  ].map((chunk) => new TextEncoder().encode(chunk));
  let index = 0;

  return {
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        read: async () =>
          index < chunks.length
            ? { done: false, value: chunks[index++] }
            : { done: true, value: undefined },
      }),
    },
  } as Response;
};

const controlledStreamResponse = (payload: ReturnType<typeof response>) => {
  let readCount = 0;
  let releaseFinal: (() => void) | undefined;
  const firstChunk = new TextEncoder().encode(
    `${JSON.stringify({
      name: 'copy-generation-started',
      data: {},
    })}\n${JSON.stringify({
      name: 'platform-started',
      data: { platform: 'linkedin' },
    })}\n`
  );
  const finalChunk = new TextEncoder().encode(
    `${JSON.stringify({ name: 'completed', data: payload })}\n`
  );

  return {
    response: {
      ok: true,
      status: 200,
      body: {
        getReader: () => ({
          read: () => {
            readCount += 1;
            if (readCount === 1) {
              return Promise.resolve({ done: false, value: firstChunk });
            }
            if (readCount === 2) {
              return new Promise<{ done: false; value: Uint8Array }>(
                (resolve) => {
                  releaseFinal = () =>
                    resolve({ done: false, value: finalChunk });
                }
              );
            }
            return Promise.resolve({ done: true, value: undefined });
          },
        }),
      },
    } as Response,
    finish: () => releaseFinal?.(),
  };
};

const seedDraft = (destinations = [linkedinPersonal]) => {
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
  useLaunchStore.getState().setAllIntegrations(destinations);
  useLaunchStore.getState().setSelectedIntegrations(
    destinations.map((integration) => ({
      selectedIntegrations: integration,
      settings: {},
    }))
  );
  useGuidedComposerStore.getState().setComposerStep('destinations');
  useGuidedComposerStore.setState({
    sourceMediaId: 'video-1',
    transcriptionStatus: 'READY',
    transcriptionError: null,
  });
};

const seedTextDraft = () => {
  seedDraft();
  useLaunchStore.getState().setGlobalValueMedia(0, []);
  useLaunchStore.getState().setGlobalValueText(0, 'A text-only post.');
  useGuidedComposerStore.setState({
    sourceMediaId: null,
    transcriptionStatus: 'IDLE',
  });
};

const seedImageDraft = () => {
  seedDraft();
  useLaunchStore.getState().setGlobalValueMedia(0, [
    {
      id: 'image-1',
      path: 'https://media.example.com/image.png',
      type: 'image',
    } as any,
  ]);
  useGuidedComposerStore.setState({
    sourceMediaId: null,
    transcriptionStatus: 'IDLE',
  });
};

const renderGeneration = () =>
  render(
    <GuidedComposerShell>
      <div>Existing composer content</div>
    </GuidedComposerShell>
  );

describe('guided composer generation transition', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    useGuidedComposerStore.getState().resetGuidedComposer();
    useLaunchStore.getState().reset();
  });

  it('moves a text draft directly to Review without generation', () => {
    seedTextDraft();
    useGuidedComposerStore.setState({
      generationStatus: 'complete',
      generatedResponse: response() as any,
      generationInputFingerprint: 'stale-video-fingerprint',
    });
    renderGeneration();

    fireEvent.click(screen.getByRole('button', { name: 'Continue to Review' }));

    expect(useGuidedComposerStore.getState()).toMatchObject({
      composerStep: 'review',
      generationStatus: 'idle',
      generatedResponse: null,
      generationInputFingerprint: null,
    });
    expect(
      screen
        .getByRole('button', { name: 'Continue to Publish' })
        .hasAttribute('disabled')
    ).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('moves an image draft directly to Review without generation', () => {
    seedImageDraft();
    const originalMedia = useLaunchStore.getState().global[0].media;
    useGuidedComposerStore.setState({
      generationStatus: 'complete',
      generatedResponse: response() as any,
      generationInputFingerprint: 'stale-video-fingerprint',
    });
    renderGeneration();

    const continueButton = screen.getByRole('button', {
      name: 'Continue to Review',
    });
    expect(continueButton.hasAttribute('disabled')).toBe(false);
    fireEvent.click(continueButton);

    expect(useGuidedComposerStore.getState()).toMatchObject({
      composerStep: 'review',
      generationStatus: 'idle',
      generatedResponse: null,
      generationInputFingerprint: null,
    });
    expect(useLaunchStore.getState().global[0].media).toEqual(originalMedia);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('sends the Phase 6 request and generates once for multiple accounts on one platform', async () => {
    seedDraft([linkedinPersonal, linkedinPage]);
    useGuidedComposerStore.setState({
      captionMode: 'adapt-by-platform',
      sourceCaption: 'One authoritative source caption.',
      additionalContext: '  Keep it practical.  ',
    });
    mockFetch.mockResolvedValue(streamResponse(response()));
    renderGeneration();

    fireEvent.click(screen.getByRole('button', { name: 'Continue to Review' }));

    await waitFor(() =>
      expect(useGuidedComposerStore.getState().composerStep).toBe('review')
    );
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({
      mediaId: 'video-1',
      platforms: ['linkedin'],
      captionMode: 'adapt-by-platform',
      sourceCaption: 'One authoritative source caption.',
      additionalContext: 'Keep it practical.',
      goal: 'position',
    });
    expect(useGuidedComposerStore.getState()).toMatchObject({
      generationStatus: 'complete',
      generatedResponse: response(),
    });
  });

  it('locks navigation, prevents duplicate submissions, and displays stream progress', async () => {
    seedDraft();
    const controlled = controlledStreamResponse(response());
    mockFetch.mockResolvedValue(controlled.response);
    renderGeneration();

    const continueButton = screen.getByRole('button', {
      name: 'Continue to Review',
    });
    fireEvent.click(continueButton);
    fireEvent.click(continueButton);

    await waitFor(() =>
      expect(screen.getByText('Generating LinkedIn')).toBeTruthy()
    );
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(
      screen
        .getByRole('button', { name: /Destinations Step 2 of 4/ })
        .hasAttribute('disabled')
    ).toBe(true);
    expect(
      screen.getByRole('button', { name: 'Back' }).hasAttribute('disabled')
    ).toBe(true);
    expect(
      screen
        .getByRole('button', { name: 'Generating captions...' })
        .hasAttribute('disabled')
    ).toBe(true);

    act(() => controlled.finish());
    await waitFor(() =>
      expect(useGuidedComposerStore.getState().composerStep).toBe('review')
    );
  });

  it('preserves partial drafts and unsupported destinations before moving to Review', async () => {
    seedDraft([linkedinPersonal, unsupportedDestination]);
    mockFetch.mockResolvedValue(streamResponse(response('partial')));
    renderGeneration();

    fireEvent.click(screen.getByRole('button', { name: 'Continue to Review' }));

    await waitFor(() =>
      expect(useGuidedComposerStore.getState().composerStep).toBe('review')
    );
    expect(useGuidedComposerStore.getState()).toMatchObject({
      generationStatus: 'partial',
      generatedResponse: response('partial'),
      unsupportedDestinations: [unsupportedDestination],
    });
  });

  it('keeps total failures on Destinations and allows retry', async () => {
    seedDraft();
    mockFetch
      .mockResolvedValueOnce(streamResponse(response('failed')))
      .mockResolvedValueOnce(streamResponse(response()));
    renderGeneration();

    fireEvent.click(screen.getByRole('button', { name: 'Continue to Review' }));

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Retry generation' })
      ).toBeTruthy()
    );
    expect(useGuidedComposerStore.getState()).toMatchObject({
      composerStep: 'destinations',
      generationStatus: 'failed',
      generationError: 'Generation failed safely.',
    });

    fireEvent.click(screen.getByRole('button', { name: 'Retry generation' }));
    await waitFor(() =>
      expect(useGuidedComposerStore.getState().composerStep).toBe('review')
    );
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('shows TRANSCRIPTION_PENDING instead of a missing-final-payload error', async () => {
    seedDraft();
    const pendingResponse = {
      ...response('failed'),
      warnings: [
        {
          code: 'TRANSCRIPTION_PENDING',
          message:
            'The video is still being transcribed. You can retry generation shortly.',
        },
      ],
    };
    mockFetch.mockResolvedValue(streamResponse(pendingResponse as any));
    renderGeneration();

    fireEvent.click(screen.getByRole('button', { name: 'Continue to Review' }));

    expect(
      await screen.findByText(
        'The video is still being transcribed. You can retry generation shortly.'
      )
    ).toBeTruthy();
    expect(useGuidedComposerStore.getState()).toMatchObject({
      composerStep: 'destinations',
      generationStatus: 'failed',
      generationError:
        'The video is still being transcribed. You can retry generation shortly.',
    });
    expect(
      screen.queryByText('Post generation did not return a final payload')
    ).toBeNull();
  });

  it('keeps network failures on Destinations and allows retry', async () => {
    seedDraft();
    mockFetch
      .mockRejectedValueOnce(new Error('Network unavailable'))
      .mockResolvedValueOnce(streamResponse(response()));
    renderGeneration();

    fireEvent.click(screen.getByRole('button', { name: 'Continue to Review' }));

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Retry generation' })
      ).toBeTruthy()
    );
    expect(useGuidedComposerStore.getState()).toMatchObject({
      composerStep: 'destinations',
      generationStatus: 'failed',
      generatedResponse: null,
      generationError: 'Network unavailable',
    });

    fireEvent.click(screen.getByRole('button', { name: 'Retry generation' }));

    await waitFor(() =>
      expect(useGuidedComposerStore.getState().composerStep).toBe('review')
    );
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('ignores a stale generation failure after the source video is replaced', async () => {
    seedDraft();
    let rejectGeneration: ((error: Error) => void) | undefined;
    mockFetch.mockImplementation((url: string, options?: RequestInit) => {
      if (url === '/posts/copy/generate') {
        return new Promise((_resolve, reject) => {
          rejectGeneration = reject;
        });
      }
      if (url === '/media/video-1' && options?.method === 'DELETE') {
        return Promise.resolve({ ok: true });
      }
      if (url === '/media/video-2/transcription/ensure') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: 'transcription-2',
            mediaId: 'video-2',
            generation: 1,
            status: 'READY',
            text: 'Replacement transcript.',
            error: null,
          }),
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    renderGeneration();

    fireEvent.click(screen.getByRole('button', { name: 'Continue to Review' }));
    await waitFor(() => expect(rejectGeneration).toBeDefined());

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

    act(() => rejectGeneration?.(new Error('Late failure from video 1')));

    await waitFor(() =>
      expect(useGuidedComposerStore.getState()).toMatchObject({
        sourceMediaId: 'video-2',
        generationStatus: 'idle',
        generationError: null,
        generationInputFingerprint: null,
      })
    );
  });

  it('retains unsupported-only destinations and does not make a network request', async () => {
    seedDraft([unsupportedDestination]);
    useGuidedComposerStore.getState().setCaptionMode('generate');
    renderGeneration();

    fireEvent.click(screen.getByRole('button', { name: 'Continue to Review' }));

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Retry generation' })
      ).toBeTruthy()
    );
    expect(mockFetch).not.toHaveBeenCalled();
    expect(useGuidedComposerStore.getState()).toMatchObject({
      composerStep: 'destinations',
      generationStatus: 'failed',
      generationError:
        'None of the selected destinations support caption generation yet.',
      unsupportedDestinations: [unsupportedDestination],
    });
  });

  it('blocks Publish when generated results become stale', async () => {
    seedDraft();
    mockFetch.mockResolvedValue(streamResponse(response()));
    renderGeneration();

    fireEvent.click(screen.getByRole('button', { name: 'Continue to Review' }));

    await waitFor(() =>
      expect(useGuidedComposerStore.getState().composerStep).toBe('review')
    );

    const publishButton = screen.getByRole('button', {
      name: 'Continue to Publish',
    });
    expect(publishButton.hasAttribute('disabled')).toBe(false);

    act(() =>
      useGuidedComposerStore
        .getState()
        .setAdditionalContext('Changed while reviewing')
    );

    await waitFor(() =>
      expect(useGuidedComposerStore.getState().generationStatus).toBe('idle')
    );

    expect(useGuidedComposerStore.getState().generatedResponse).toBeNull();
    expect(publishButton.hasAttribute('disabled')).toBe(true);

    fireEvent.click(publishButton);
    expect(useGuidedComposerStore.getState().composerStep).toBe('review');
  });

  it('does not regenerate unchanged inputs but invalidates results after an input change', async () => {
    seedDraft();
    mockFetch.mockImplementation(async () => streamResponse(response()));
    renderGeneration();

    fireEvent.click(screen.getByRole('button', { name: 'Continue to Review' }));
    await waitFor(() =>
      expect(useGuidedComposerStore.getState().composerStep).toBe('review')
    );

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue to Review' }));
    expect(useGuidedComposerStore.getState().composerStep).toBe('review');
    expect(mockFetch).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    act(() =>
      useGuidedComposerStore.getState().setAdditionalContext('New context')
    );
    await waitFor(() =>
      expect(useGuidedComposerStore.getState().generationStatus).toBe('idle')
    );
    expect(useGuidedComposerStore.getState().generatedResponse).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Continue to Review' }));
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
  });

  it('fingerprints every input and keeps generation cleared when a pending request finishes after close', async () => {
    const base = {
      mediaId: 'video-1',
      destinations: [linkedinPersonal],
      captionMode: 'adapt-by-platform' as const,
      sourceCaption: 'Source',
      additionalContext: 'Context',
    };
    const fingerprints = [
      buildGuidedGenerationFingerprint(base),
      buildGuidedGenerationFingerprint({ ...base, mediaId: 'video-2' }),
      buildGuidedGenerationFingerprint({
        ...base,
        destinations: [linkedinPage],
      }),
      buildGuidedGenerationFingerprint({
        ...base,
        captionMode: 'use-everywhere',
      }),
      buildGuidedGenerationFingerprint({ ...base, sourceCaption: 'Changed' }),
      buildGuidedGenerationFingerprint({
        ...base,
        additionalContext: 'Changed',
      }),
    ];
    expect(new Set(fingerprints).size).toBe(fingerprints.length);
    expect(
      buildGuidedGenerationFingerprint({
        ...base,
        additionalContext: '  Context  ',
      })
    ).toBe(buildGuidedGenerationFingerprint(base));

    seedDraft();
    const controlled = controlledStreamResponse(response());
    mockFetch.mockResolvedValue(controlled.response);
    const { unmount } = renderGeneration();
    fireEvent.click(screen.getByRole('button', { name: 'Continue to Review' }));
    await waitFor(() =>
      expect(useGuidedComposerStore.getState().generationStatus).toBe('loading')
    );
    unmount();
    act(() => controlled.finish());

    await waitFor(() =>
      expect(useGuidedComposerStore.getState()).toMatchObject({
        composerStep: 'upload',
        generationStatus: 'idle',
        generatedResponse: null,
        unsupportedDestinations: [],
        generationProgress: '',
        generationError: null,
        generationInputFingerprint: null,
      })
    );
  });
});
