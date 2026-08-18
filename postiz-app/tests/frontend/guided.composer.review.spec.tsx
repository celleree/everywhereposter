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
import {
  getGuidedReviewCaptionSourceLabel,
  getGuidedReviewDestinationLimit,
} from '../../apps/frontend/src/components/new-launch/guided.composer.review';
import {
  GuidedReviewDraftSeed,
  useGuidedComposerStore,
} from '../../apps/frontend/src/components/new-launch/guided.composer.store';
import { useLaunchStore } from '../../apps/frontend/src/components/new-launch/store';

Object.assign(global, { TextEncoder, TextDecoder });

const linkedinPersonal = {
  id: 'linkedin-personal',
  name: 'Founder LinkedIn',
  identifier: 'linkedin',
  display: 'Founder',
  picture: '',
  disabled: false,
  inBetweenSteps: false,
} as any;

const linkedinPage = {
  id: 'linkedin-page',
  name: 'Company LinkedIn',
  identifier: 'linkedin-page',
  display: 'Company',
  picture: '',
  disabled: false,
  inBetweenSteps: false,
} as any;

const xAccount = {
  id: 'x-account',
  name: 'Founder X',
  identifier: 'x',
  display: 'X',
  picture: '',
  disabled: false,
  inBetweenSteps: false,
} as any;

const mastodonAccount = {
  id: 'mastodon-account',
  name: 'Founder Mastodon',
  identifier: 'mastodon',
  display: 'Mastodon',
  picture: '',
  disabled: false,
  inBetweenSteps: false,
} as any;

const generatedResult = (
  platform: 'linkedin' | 'x',
  draft: string,
  origin: 'generated' | 'original' | 'adapted' = 'generated',
  warnings: Array<{ code: string; message: string }> = []
) => ({
  platform,
  draft,
  origin,
  charCount: draft.length,
  confidence: 0.9,
  antiGenericScore: 0.9,
  rewritten: false,
  warnings,
});

const generatedResponse = (
  results = [generatedResult('linkedin', 'Shared LinkedIn caption.')],
  requestId = 'review-request-1'
) => ({
  requestId,
  status: 'complete' as const,
  sourceConfidence: 0.9,
  warnings: [],
  results,
  imagePlans: [],
});

const streamResponse = (payload: ReturnType<typeof generatedResponse>) => {
  const chunks = [
    `${JSON.stringify({ name: 'completed', data: payload })}\n`,
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

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
};

const seedGeneratedReview = ({
  destinations = [linkedinPersonal, linkedinPage],
  response = generatedResponse(),
  captionMode = 'generate' as const,
  sourceCaption = '',
}: {
  destinations?: any[];
  response?: ReturnType<typeof generatedResponse>;
  captionMode?: 'generate' | 'use-everywhere' | 'adapt-by-platform';
  sourceCaption?: string;
} = {}) => {
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
  useGuidedComposerStore.getState().setCaptionMode(captionMode);
  useGuidedComposerStore.getState().setSourceCaption(sourceCaption);
  useGuidedComposerStore.setState({
    sourceMediaId: 'video-1',
    transcriptionStatus: 'READY',
  });
  const fingerprint = buildGuidedGenerationFingerprint({
    mediaId: 'video-1',
    destinations,
    captionMode,
    sourceCaption,
    additionalContext: '',
  });
  useGuidedComposerStore
    .getState()
    .completeGeneration(response as any, [], fingerprint);
  useGuidedComposerStore.getState().setComposerStep('review');
};

const renderReview = () =>
  render(
    <GuidedComposerShell>
      <div>Existing composer</div>
    </GuidedComposerShell>
  );

describe('guided composer review', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    useGuidedComposerStore.getState().resetGuidedComposer();
    useLaunchStore.getState().reset();
  });

  it('merges reconciliation seeds, reseeds material changes, and prunes genuine removals', () => {
    const seed: GuidedReviewDraftSeed = {
      destinationId: linkedinPersonal.id,
      platform: 'linkedin',
      sourceFingerprint: 'source-1',
      caption: 'Generated baseline',
      baselineCaption: 'Generated baseline',
      baselineSource: 'generated',
      originalCaption: '',
      warnings: [],
    };
    const store = useGuidedComposerStore.getState();

    store.reconcileReviewDrafts([seed]);
    useGuidedComposerStore
      .getState()
      .editReviewCaption(linkedinPersonal.id, 'User edit');
    useGuidedComposerStore.getState().reconcileReviewDrafts([{ ...seed }]);

    expect(
      useGuidedComposerStore.getState().reviewDrafts[linkedinPersonal.id]
    ).toMatchObject({ caption: 'User edit', source: 'edited' });

    useGuidedComposerStore.getState().reconcileReviewDrafts([]);
    expect(
      useGuidedComposerStore.getState().reviewDrafts[linkedinPersonal.id]
    ).toMatchObject({ caption: 'User edit', source: 'edited' });

    useGuidedComposerStore
      .getState()
      .setReviewDestinationEnabled(linkedinPersonal.id, false);
    const staleRequestToken = useGuidedComposerStore
      .getState()
      .startReviewRegeneration(linkedinPersonal.id)!;
    useGuidedComposerStore.getState().reconcileReviewDrafts([
      {
        ...seed,
        sourceFingerprint: 'source-2',
        caption: 'Materially changed baseline',
        baselineCaption: 'Materially changed baseline',
      },
    ]);
    expect(
      useGuidedComposerStore.getState().reviewDrafts[linkedinPersonal.id]
    ).toMatchObject({
      caption: 'Materially changed baseline',
      source: 'generated',
      enabled: false,
    });
    useGuidedComposerStore
      .getState()
      .completeReviewRegeneration(
        linkedinPersonal.id,
        'source-1',
        staleRequestToken,
        generatedResult('linkedin', 'Stale result') as any
      );
    expect(
      useGuidedComposerStore.getState().reviewDrafts[linkedinPersonal.id]
        .caption
    ).toBe('Materially changed baseline');

    useGuidedComposerStore.getState().pruneReviewDrafts([]);
    expect(
      useGuidedComposerStore.getState().reviewDrafts[linkedinPersonal.id]
    ).toBeUndefined();

    useGuidedComposerStore.getState().reconcileReviewDrafts([seed]);
    useGuidedComposerStore
      .getState()
      .completeReviewRegeneration(
        linkedinPersonal.id,
        'source-1',
        staleRequestToken,
        generatedResult('linkedin', 'Stale re-add result') as any
      );

    expect(
      useGuidedComposerStore.getState().reviewDrafts[linkedinPersonal.id]
    ).toMatchObject({
      caption: 'Generated baseline',
      source: 'generated',
      enabled: true,
    });
  });

  it('does not seed Generate review from a hidden stale source caption', async () => {
    seedGeneratedReview({
      destinations: [linkedinPersonal],
      response: generatedResponse([]),
      sourceCaption: 'Hidden stale caption',
    });
    useLaunchStore
      .getState()
      .setGlobalValueText(0, '<p>Visible legacy draft</p>');

    renderReview();

    expect(
      await screen.findByLabelText('Founder LinkedIn caption')
    ).toHaveProperty('value', 'Visible legacy draft');
    expect(screen.queryByDisplayValue('Hidden stale caption')).toBeNull();
  });

  it('completes unsupported-only Use Everywhere without an AI request', async () => {
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
    useLaunchStore.getState().setAllIntegrations([mastodonAccount]);
    useLaunchStore.getState().setSelectedIntegrations([
      { selectedIntegrations: mastodonAccount, settings: {} },
    ]);
    useGuidedComposerStore.getState().setCaptionMode('use-everywhere');
    useGuidedComposerStore
      .getState()
      .setSourceCaption('Use this caption everywhere.');
    useGuidedComposerStore.setState({
      composerStep: 'destinations',
      sourceMediaId: 'video-1',
      transcriptionStatus: 'READY',
    });

    renderReview();
    fireEvent.click(
      screen.getByRole('button', { name: 'Continue to Review' })
    );

    expect(
      await screen.findByLabelText('Founder Mastodon caption')
    ).toHaveProperty('value', 'Use this caption everywhere.');
    expect(
      screen.getByText(
        'Automatic caption generation is not available for this destination. Review the original caption before continuing.'
      )
    ).toBeTruthy();
    expect(mockFetch).not.toHaveBeenCalled();
    expect(useGuidedComposerStore.getState()).toMatchObject({
      composerStep: 'review',
      generationStatus: 'complete',
      generatedResponse: null,
      unsupportedDestinations: [mastodonAccount],
    });
  });

  it('seeds same-platform accounts independently and edits only one', async () => {
    seedGeneratedReview();
    renderReview();

    const founderCaption = await screen.findByLabelText(
      'Founder LinkedIn caption'
    );
    expect(founderCaption).toHaveProperty('value', 'Shared LinkedIn caption.');
    expect(screen.getByText('AI generated')).toBeTruthy();

    fireEvent.change(founderCaption, { target: { value: 'Founder edit' } });
    expect(screen.getByText('Edited by you')).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: /Company LinkedIn/ }));
    expect(screen.getByLabelText('Company LinkedIn caption')).toHaveProperty(
      'value',
      'Shared LinkedIn caption.'
    );
    expect(useGuidedComposerStore.getState().reviewDrafts).toMatchObject({
      'linkedin-personal': { caption: 'Founder edit', source: 'edited' },
      'linkedin-page': {
        caption: 'Shared LinkedIn caption.',
        source: 'generated',
      },
    });

    fireEvent.change(screen.getByLabelText('Company LinkedIn caption'), {
      target: { value: 'Company edit' },
    });
    fireEvent.click(screen.getByRole('tab', { name: /Founder LinkedIn/ }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Reset Founder LinkedIn caption' })
    );

    expect(screen.getByLabelText('Founder LinkedIn caption')).toHaveProperty(
      'value',
      'Shared LinkedIn caption.'
    );
    expect(
      useGuidedComposerStore.getState().reviewDrafts[linkedinPage.id]
    ).toMatchObject({
      caption: 'Company edit',
      source: 'edited',
      enabled: true,
    });

    fireEvent.click(
      screen.getByRole('button', { name: 'Disable Founder LinkedIn' })
    );
    expect(
      useGuidedComposerStore.getState().reviewDrafts[linkedinPage.id]
    ).toMatchObject({ caption: 'Company edit', enabled: true });
    fireEvent.click(
      screen.getByRole('button', { name: 'Include Founder LinkedIn' })
    );
    expect(
      useGuidedComposerStore.getState().reviewDrafts[linkedinPage.id]
    ).toMatchObject({ caption: 'Company edit', enabled: true });
  });

  it('preserves generated state and edits through a full-shell integration refresh', async () => {
    seedGeneratedReview({ destinations: [linkedinPersonal] });
    const generatedState = useGuidedComposerStore.getState();
    const generatedResponseBeforeRefresh = generatedState.generatedResponse;
    const fingerprintBeforeRefresh = generatedState.generationInputFingerprint;
    renderReview();

    fireEvent.change(await screen.findByLabelText('Founder LinkedIn caption'), {
      target: { value: 'Edit that survives a reload' },
    });
    const continueButton = screen.getByRole('button', {
      name: 'Continue to Publish',
    });
    expect(continueButton).not.toBeDisabled();

    act(() => useLaunchStore.setState({ integrations: [] }));
    await waitFor(() =>
      expect(useGuidedComposerStore.getState()).toMatchObject({
        generatedResponse: generatedResponseBeforeRefresh,
        generationInputFingerprint: fingerprintBeforeRefresh,
        reviewDrafts: {
          [linkedinPersonal.id]: {
            caption: 'Edit that survives a reload',
            source: 'edited',
          },
        },
      })
    );
    expect(continueButton).toBeDisabled();

    act(() =>
      useLaunchStore.setState({
        integrations: [{ ...linkedinPersonal } as any],
      })
    );

    expect(
      await screen.findByLabelText('Founder LinkedIn caption')
    ).toHaveProperty('value', 'Edit that survives a reload');
    expect(screen.getByText('Edited by you')).toBeTruthy();
    expect(useGuidedComposerStore.getState()).toMatchObject({
      generatedResponse: generatedResponseBeforeRefresh,
      generationInputFingerprint: fingerprintBeforeRefresh,
      reviewDrafts: {
        [linkedinPersonal.id]: {
          caption: 'Edit that survives a reload',
          source: 'edited',
        },
      },
    });
    expect(mockFetch).not.toHaveBeenCalled();
    expect(continueButton).not.toBeDisabled();
  });

  it('maps every source label and resets an adapted caption', async () => {
    expect(getGuidedReviewCaptionSourceLabel('generated')).toBe('AI generated');
    expect(getGuidedReviewCaptionSourceLabel('original')).toBe(
      'Original caption'
    );
    expect(getGuidedReviewCaptionSourceLabel('adapted')).toBe(
      'Adapted from your caption'
    );
    expect(getGuidedReviewCaptionSourceLabel('edited')).toBe('Edited by you');

    seedGeneratedReview({
      destinations: [linkedinPersonal],
      response: generatedResponse([
        generatedResult('linkedin', 'Adapted baseline', 'adapted'),
      ]),
      captionMode: 'adapt-by-platform',
      sourceCaption: 'The original user caption',
    });
    renderReview();

    const caption = await screen.findByLabelText('Founder LinkedIn caption');
    expect(screen.getByText('Adapted from your caption')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'View original' }));
    expect(
      screen.getByText('Your original caption').parentElement?.textContent
    ).toContain('The original user caption');

    fireEvent.change(caption, { target: { value: 'Edited adaptation' } });
    expect(screen.getByText('Edited by you')).toBeTruthy();
    fireEvent.click(
      screen.getByRole('button', { name: 'Reset Founder LinkedIn caption' })
    );

    expect(caption).toHaveProperty('value', 'Adapted baseline');
    expect(screen.getByText('Adapted from your caption')).toBeTruthy();
  });

  it('regenerates only the requested destination and uses it as the new reset baseline', async () => {
    seedGeneratedReview({
      response: generatedResponse([
        generatedResult('linkedin', 'Initial adaptation', 'adapted'),
      ]),
      captionMode: 'adapt-by-platform',
      sourceCaption: 'Original caption',
    });
    mockFetch.mockResolvedValue(
      streamResponse(
        generatedResponse(
          [generatedResult('linkedin', 'Regenerated adaptation', 'adapted')],
          'regenerated-request'
        )
      )
    );
    renderReview();

    await screen.findByLabelText('Founder LinkedIn caption');
    fireEvent.click(screen.getByRole('tab', { name: /Company LinkedIn/ }));
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Regenerate Company LinkedIn caption',
      })
    );

    await waitFor(() =>
      expect(
        useGuidedComposerStore.getState().reviewDrafts[linkedinPage.id].caption
      ).toBe('Regenerated adaptation')
    );
    expect(
      useGuidedComposerStore.getState().reviewDrafts[linkedinPersonal.id]
        .caption
    ).toBe('Initial adaptation');

    const companyCaption = screen.getByLabelText('Company LinkedIn caption');
    fireEvent.change(companyCaption, {
      target: { value: 'Later manual edit' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Reset Company LinkedIn caption' })
    );
    expect(companyCaption).toHaveProperty('value', 'Regenerated adaptation');
    expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toMatchObject({
      mediaId: 'video-1',
      platforms: ['linkedin'],
      captionMode: 'adapt-by-platform',
      sourceCaption: 'Original caption',
    });
  });

  it('ignores an older regeneration success after a newer attempt completes', async () => {
    const sourceFingerprint = 'stable-source';
    useGuidedComposerStore.getState().reconcileReviewDrafts([
      {
        destinationId: linkedinPersonal.id,
        platform: 'linkedin',
        sourceFingerprint,
        caption: 'Original baseline',
        baselineCaption: 'Original baseline',
        baselineSource: 'generated',
        originalCaption: '',
        warnings: [],
      },
    ]);
    const first = deferred<any>();
    const second = deferred<any>();
    const store = useGuidedComposerStore.getState();
    const firstToken = store.startReviewRegeneration(linkedinPersonal.id)!;
    const firstRequest = first.promise.then((result) =>
      useGuidedComposerStore
        .getState()
        .completeReviewRegeneration(
          linkedinPersonal.id,
          sourceFingerprint,
          firstToken,
          result
        )
    );
    const secondToken = useGuidedComposerStore
      .getState()
      .startReviewRegeneration(linkedinPersonal.id)!;
    const secondRequest = second.promise.then((result) =>
      useGuidedComposerStore
        .getState()
        .completeReviewRegeneration(
          linkedinPersonal.id,
          sourceFingerprint,
          secondToken,
          result
        )
    );

    second.resolve(generatedResult('linkedin', 'Newer result'));
    await secondRequest;
    first.resolve(generatedResult('linkedin', 'Older result'));
    await firstRequest;

    expect(
      useGuidedComposerStore.getState().reviewDrafts[linkedinPersonal.id]
    ).toMatchObject({
      caption: 'Newer result',
      baselineCaption: 'Newer result',
      regenerationStatus: 'idle',
      regenerationRequestToken: null,
    });
  });

  it('ignores a stale regeneration failure and applies only the current failure', async () => {
    const sourceFingerprint = 'stable-source';
    useGuidedComposerStore.getState().reconcileReviewDrafts([
      {
        destinationId: linkedinPersonal.id,
        platform: 'linkedin',
        sourceFingerprint,
        caption: 'Caption to preserve',
        baselineCaption: 'Caption to preserve',
        baselineSource: 'generated',
        originalCaption: '',
        warnings: [],
      },
    ]);
    const first = deferred<any>();
    const second = deferred<any>();
    const settleFailure = async (
      request: Promise<any>,
      token: number,
      fallbackMessage: string
    ) => {
      try {
        await request;
      } catch (error: any) {
        useGuidedComposerStore
          .getState()
          .failReviewRegeneration(
            linkedinPersonal.id,
            sourceFingerprint,
            token,
            error?.message || fallbackMessage
          );
      }
    };
    const firstToken = useGuidedComposerStore
      .getState()
      .startReviewRegeneration(linkedinPersonal.id)!;
    const firstRequest = settleFailure(
      first.promise,
      firstToken,
      'First failed'
    );
    const secondToken = useGuidedComposerStore
      .getState()
      .startReviewRegeneration(linkedinPersonal.id)!;
    const secondRequest = settleFailure(
      second.promise,
      secondToken,
      'Second failed'
    );

    first.reject(new Error('Stale failure'));
    await firstRequest;
    expect(
      useGuidedComposerStore.getState().reviewDrafts[linkedinPersonal.id]
    ).toMatchObject({
      caption: 'Caption to preserve',
      regenerationStatus: 'loading',
      regenerationRequestToken: secondToken,
      regenerationError: null,
    });

    second.reject(new Error('Current failure'));
    await secondRequest;
    expect(
      useGuidedComposerStore.getState().reviewDrafts[linkedinPersonal.id]
    ).toMatchObject({
      caption: 'Caption to preserve',
      regenerationStatus: 'failed',
      regenerationRequestToken: null,
      regenerationError: 'Current failure',
    });
  });

  it('preserves the caption when destination regeneration fails', async () => {
    seedGeneratedReview({ destinations: [linkedinPersonal] });
    mockFetch.mockRejectedValue(new Error('Regeneration unavailable'));
    renderReview();

    const caption = await screen.findByLabelText('Founder LinkedIn caption');
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Regenerate Founder LinkedIn caption',
      })
    );

    expect(await screen.findByText('Regeneration unavailable')).toBeTruthy();
    expect(caption).toHaveProperty('value', 'Shared LinkedIn caption.');
  });

  it('blocks Continue while the active destination is regenerating', async () => {
    seedGeneratedReview({ destinations: [linkedinPersonal] });
    const response = deferred<Response>();
    mockFetch.mockReturnValue(response.promise);
    renderReview();

    await screen.findByLabelText('Founder LinkedIn caption');
    const continueButton = screen.getByRole('button', {
      name: 'Continue to Publish',
    });
    expect(continueButton).not.toBeDisabled();

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Regenerate Founder LinkedIn caption',
      })
    );
    await waitFor(() =>
      expect(
        useGuidedComposerStore.getState().reviewDrafts[linkedinPersonal.id]
          .regenerationStatus
      ).toBe('loading')
    );
    expect(continueButton).toBeDisabled();

    act(() =>
      response.resolve(
        streamResponse(
          generatedResponse([
            generatedResult('linkedin', 'Regenerated caption'),
          ])
        )
      )
    );
    await waitFor(() => expect(continueButton).not.toBeDisabled());
  });

  it('uses destination limits, renders warnings, blocks errors, and allows disabling the invalid destination', async () => {
    seedGeneratedReview({
      destinations: [linkedinPersonal, xAccount],
      response: generatedResponse([
        generatedResult('linkedin', 'Ready caption'),
        generatedResult('x', 'Too long', 'generated', [
          { code: 'TONE_WARNING', message: 'Review the generated tone.' },
        ]),
      ]),
    });
    useLaunchStore.setState({
      chars: { [linkedinPersonal.id]: 3000, [xAccount.id]: 5 },
    });
    renderReview();

    await screen.findByLabelText('Founder LinkedIn caption');
    fireEvent.click(screen.getByRole('tab', { name: /Founder X/ }));

    expect(
      screen.getByTestId('review-character-count-x-account').textContent
    ).toContain('8 / 5 characters');
    expect(screen.getByText('Review the generated tone.')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain(
      '3 characters over the 5-character limit'
    );
    const continueButton = screen.getByRole('button', {
      name: 'Continue to Publish',
    });
    expect(continueButton).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Disable Founder X' }));
    expect(continueButton).not.toBeDisabled();

    fireEvent.click(screen.getByRole('tab', { name: /Founder LinkedIn/ }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Disable Founder LinkedIn' })
    );
    expect(continueButton).toBeDisabled();
    expect(
      screen.getByText('Include at least one destination to continue.')
    ).toBeTruthy();

    fireEvent.click(
      screen.getByRole('button', { name: 'Include Founder LinkedIn' })
    );
    expect(continueButton).not.toBeDisabled();
    expect(
      getGuidedReviewDestinationLimit({ providerLimit: 5, platform: 'x' })
    ).toBe(5);
  });

  it('uses final-submission weighted character validation for X', async () => {
    const weightedCaption = '界'.repeat(141);
    seedGeneratedReview({
      destinations: [xAccount],
      response: generatedResponse([
        generatedResult('x', weightedCaption),
      ]),
    });
    useLaunchStore.setState({ chars: { [xAccount.id]: 280 } });

    renderReview();

    await screen.findByLabelText('Founder X caption');
    expect(
      screen.getByTestId('review-character-count-x-account').textContent
    ).toContain('282 / 280 characters');
    expect(screen.getByRole('alert').textContent).toContain(
      '2 characters over the 280-character limit'
    );
    expect(
      screen.getByRole('button', { name: 'Continue to Publish' })
    ).toBeDisabled();
  });

  it('normalizes entity-sensitive X captions like final submission', async () => {
    seedGeneratedReview({
      destinations: [xAccount],
      response: generatedResponse([generatedResult('x', 'A & B')]),
    });
    useLaunchStore.setState({ chars: { [xAccount.id]: 5 } });

    renderReview();

    await screen.findByLabelText('Founder X caption');
    expect(
      screen.getByTestId('review-character-count-x-account').textContent
    ).toContain('9 / 5 characters');
    expect(screen.getByRole('alert').textContent).toContain(
      '4 characters over the 5-character limit'
    );
    expect(
      screen.getByRole('button', { name: 'Continue to Publish' })
    ).toBeDisabled();
  });

  it('blocks normalized-empty X content without media', async () => {
    seedGeneratedReview({
      destinations: [xAccount],
      response: generatedResponse([generatedResult('x', '<p></p>')]),
    });
    useLaunchStore.getState().setGlobalValueMedia(0, []);

    renderReview();

    await screen.findByLabelText('Founder X caption');
    expect(
      screen.getByTestId('review-character-count-x-account').textContent
    ).toContain('0 / 280 characters');
    expect(screen.getByRole('alert').textContent).toContain(
      'Add a caption or media before continuing.'
    );
    expect(
      screen.getByRole('button', { name: 'Continue to Publish' })
    ).toBeDisabled();
  });

  it('preserves edits across normal navigation and removes deselected destinations', async () => {
    seedGeneratedReview();
    renderReview();

    const founderCaption = await screen.findByLabelText(
      'Founder LinkedIn caption'
    );
    fireEvent.change(founderCaption, {
      target: { value: 'Persistent founder edit' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue to Review' }));

    expect(
      await screen.findByLabelText('Founder LinkedIn caption')
    ).toHaveProperty('value', 'Persistent founder edit');
    expect(mockFetch).not.toHaveBeenCalled();

    act(() =>
      useLaunchStore
        .getState()
        .setSelectedIntegrations([
          { selectedIntegrations: linkedinPersonal, settings: {} },
        ])
    );

    await waitFor(() =>
      expect(screen.queryByRole('tab', { name: /Company LinkedIn/ })).toBeNull()
    );
    expect(
      useGuidedComposerStore.getState().reviewDrafts[linkedinPage.id]
    ).toBeUndefined();
    await waitFor(() =>
      expect(useGuidedComposerStore.getState()).toMatchObject({
        generatedResponse: null,
        generationInputFingerprint: null,
      })
    );
  });

  it('invalidates generation when another material input changes', async () => {
    seedGeneratedReview({ destinations: [linkedinPersonal] });
    renderReview();

    await screen.findByLabelText('Founder LinkedIn caption');
    act(() =>
      useGuidedComposerStore
        .getState()
        .setAdditionalContext('A materially different generation context')
    );

    await waitFor(() =>
      expect(useGuidedComposerStore.getState()).toMatchObject({
        generatedResponse: null,
        generationInputFingerprint: null,
      })
    );
  });

  it('waits for every selected destination before starting generation', async () => {
    const destinations = [linkedinPersonal, linkedinPage, xAccount];
    seedGeneratedReview({ destinations });
    useGuidedComposerStore.getState().resetGeneration();
    useGuidedComposerStore.getState().setComposerStep('destinations');
    useLaunchStore.setState({
      integrations: [linkedinPersonal, linkedinPage],
    });
    mockFetch.mockResolvedValue(
      streamResponse(
        generatedResponse([
          generatedResult('linkedin', 'Complete LinkedIn caption'),
          generatedResult('x', 'Complete X caption'),
        ])
      )
    );
    renderReview();

    const continueButton = screen.getByRole('button', {
      name: 'Continue to Review',
    });
    expect(continueButton).toBeDisabled();
    fireEvent.click(continueButton);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(useGuidedComposerStore.getState()).toMatchObject({
      composerStep: 'destinations',
      generationStatus: 'idle',
      generatedResponse: null,
    });

    act(() =>
      useLaunchStore.setState({
        integrations: destinations,
      })
    );
    await waitFor(() => expect(continueButton).not.toBeDisabled());

    fireEvent.click(continueButton);
    await waitFor(() =>
      expect(useGuidedComposerStore.getState()).toMatchObject({
        composerStep: 'review',
        generationStatus: 'complete',
      })
    );
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(mockFetch.mock.calls[0][1].body).platforms).toEqual([
      'linkedin',
      'x',
    ]);
  });
});
