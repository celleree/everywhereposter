import React from 'react';
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

jest.mock('@gitroom/react/helpers/image.with.fallback', () => ({
  __esModule: true,
  default: ({ fallbackSrc: _fallbackSrc, ...props }: any) => <img {...props} />,
}));

jest.mock('@gitroom/react/helpers/video.frame', () => ({
  VideoFrame: () => <div>Video preview</div>,
}));

jest.mock('@gitroom/frontend/components/launches/helpers/date.picker', () => ({
  DatePicker: ({ date, onChange }: any) => (
    <button
      type="button"
      aria-label="Choose scheduled date"
      onClick={() => onChange(date.add(1, 'day'))}
    >
      {date.format('YYYY-MM-DD HH:mm')}
    </button>
  ),
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

import {
  GuidedComposerPublish,
  GuidedComposerPublishBridgeProvider,
  GuidedPublishSubmitResult,
  pollGuidedPublishPost,
  useRegisterGuidedComposerPublish,
} from '../../apps/frontend/src/components/new-launch/guided.composer.publish';
import { useGuidedComposerStore } from '../../apps/frontend/src/components/new-launch/guided.composer.store';
import { useLaunchStore } from '../../apps/frontend/src/components/new-launch/store';

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

const disabledX = {
  id: 'x-disabled',
  name: 'Disabled X',
  identifier: 'x',
  display: 'X',
  picture: '',
  disabled: false,
  inBetweenSteps: false,
} as any;

const seedPublishState = () => {
  useLaunchStore.getState().reset();
  useGuidedComposerStore.getState().resetGuidedComposer();
  useLaunchStore
    .getState()
    .setAllIntegrations([linkedinPersonal, linkedinPage, disabledX]);
  useLaunchStore.getState().setSelectedIntegrations(
    [linkedinPersonal, linkedinPage, disabledX].map((integration) => ({
      selectedIntegrations: integration,
      settings: {},
    }))
  );
  useLaunchStore.getState().addGlobalValue(0, [
    {
      id: 'post-value-1',
      content: '<p>Original global caption</p>',
      delay: 0,
      media: [
        {
          id: 'image-1',
          path: 'https://media.example.com/post.png',
          thumbnail: 'https://media.example.com/post-thumb.png',
        },
      ],
    },
  ]);
  useLaunchStore.getState().setChars(linkedinPersonal.id, 3000);
  useLaunchStore.getState().setChars(linkedinPage.id, 3000);
  useLaunchStore.getState().setChars(disabledX.id, 280);
  useGuidedComposerStore.getState().reconcileReviewDrafts([
    {
      destinationId: linkedinPersonal.id,
      platform: 'linkedin',
      sourceFingerprint: 'personal-fingerprint',
      caption: 'Final founder caption.',
      baselineCaption: 'Generated founder caption.',
      baselineSource: 'generated',
      originalCaption: 'Original caption.',
      warnings: [],
    },
    {
      destinationId: linkedinPage.id,
      platform: 'linkedin',
      sourceFingerprint: 'page-fingerprint',
      caption: 'Final company caption.',
      baselineCaption: 'Generated company caption.',
      baselineSource: 'generated',
      originalCaption: 'Original caption.',
      warnings: [],
    },
    {
      destinationId: disabledX.id,
      platform: 'x',
      sourceFingerprint: 'x-fingerprint',
      caption: 'This destination must stay disabled.',
      baselineCaption: 'Generated X caption.',
      baselineSource: 'generated',
      originalCaption: 'Original caption.',
      warnings: [],
    },
  ]);
  useGuidedComposerStore
    .getState()
    .setReviewDestinationEnabled(disabledX.id, false);
};

const RegisterSubmitter = ({
  submitter,
}: {
  submitter: (request: any) => Promise<GuidedPublishSubmitResult>;
}) => {
  useRegisterGuidedComposerPublish(submitter, true);
  return null;
};

const renderPublish = (
  submitter: (request: any) => Promise<GuidedPublishSubmitResult>,
  onSubmittingChange = jest.fn()
) =>
  render(
    <GuidedComposerPublishBridgeProvider>
      <RegisterSubmitter submitter={submitter} />
      <GuidedComposerPublish onSubmittingChange={onSubmittingChange} />
    </GuidedComposerPublishBridgeProvider>
  );

describe('guided composer publish', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    seedPublishState();
  });

  it('submits one immutable snapshot for enabled accounts and blocks duplicate clicks', async () => {
    let resolveSubmission:
      | ((result: GuidedPublishSubmitResult) => void)
      | undefined;
    const submitter = jest.fn(
      () =>
        new Promise<GuidedPublishSubmitResult>((resolve) => {
          resolveSubmission = resolve;
        })
    );
    mockFetch.mockImplementation(async (url: string) => ({
      ok: true,
      json: async () => ({
        posts: [
          {
            id: url.endsWith('post-personal') ? 'post-personal' : 'post-page',
            state: 'PUBLISHED',
          },
        ],
      }),
    }));

    renderPublish(submitter);
    const publishButton = await screen.findByRole('button', {
      name: 'Publish now',
    });

    fireEvent.click(publishButton);
    fireEvent.click(publishButton);

    expect(submitter).toHaveBeenCalledTimes(1);
    expect(submitter).toHaveBeenCalledWith({
      type: 'now',
      destinationIds: [linkedinPersonal.id, linkedinPage.id],
      captionOverrides: {
        [linkedinPersonal.id]: 'Final founder caption.',
        [linkedinPage.id]: 'Final company caption.',
      },
    });

    await act(async () => {
      resolveSubmission?.({
        ok: true,
        posts: [
          { postId: 'post-personal', integration: linkedinPersonal.id },
          { postId: 'post-page', integration: linkedinPage.id },
        ],
      });
    });

    expect(
      await screen.findByText(
        'Publishing was confirmed for every enabled destination.'
      )
    ).toBeTruthy();
    expect(mockFetch.mock.calls.map(([url]) => url)).toEqual([
      '/posts/post-personal',
      '/posts/post-page',
    ]);
    expect(
      useGuidedComposerStore.getState().reviewDrafts[linkedinPersonal.id]
        .caption
    ).toBe('Final founder caption.');
    expect(screen.queryByText('Disabled X')).toBeNull();
  });

  it('uses the schedule path and reports QUEUE as scheduled', async () => {
    const submitter = jest.fn().mockResolvedValue({
      ok: true,
      posts: [
        { postId: 'scheduled-personal', integration: linkedinPersonal.id },
        { postId: 'scheduled-page', integration: linkedinPage.id },
      ],
    });
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ posts: [{ state: 'QUEUE' }] }),
    });

    renderPublish(submitter);
    fireEvent.click(screen.getByRole('radio', { name: /Schedule/ }));
    expect(screen.getByLabelText('Scheduled date and time')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Choose scheduled date'));
    fireEvent.click(screen.getByRole('button', { name: 'Schedule post' }));

    await waitFor(() =>
      expect(submitter).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'schedule' })
      )
    );
    expect(
      await screen.findByText('The enabled destinations are scheduled.')
    ).toBeTruthy();
    expect(screen.getAllByText('Scheduled')).toHaveLength(2);
  });

  it('preserves the draft and locks resubmission after an ambiguous failure', async () => {
    const submitter = jest.fn().mockResolvedValue({
      ok: false,
      kind: 'transport',
      message: 'The connection closed before a response arrived.',
      ambiguous: true,
    });

    renderPublish(submitter);
    fireEvent.click(await screen.findByRole('button', { name: 'Publish now' }));

    expect((await screen.findByRole('alert')).textContent).toContain(
      'The connection closed before a response arrived.'
    );
    expect(submitter).toHaveBeenCalledTimes(1);
    expect(
      useGuidedComposerStore.getState().reviewDrafts[linkedinPage.id].caption
    ).toBe('Final company caption.');
    expect(screen.queryByRole('button', { name: 'Prepare retry' })).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Publish now' }).hasAttribute('disabled')
    ).toBe(true);
    expect(submitter).toHaveBeenCalledTimes(1);
  });

  it('locks an ERROR without release identifiers and does not resubmit', async () => {
    const submitter = jest.fn().mockResolvedValue({
      ok: true,
      posts: [
        { postId: 'post-personal', integration: linkedinPersonal.id },
        { postId: 'post-page', integration: linkedinPage.id },
      ],
    });
    mockFetch.mockImplementation(async (url: string) => ({
      ok: true,
      json: async () => ({
        posts: [
          {
            id: url.slice('/posts/'.length),
            state: url.endsWith('post-page') ? 'ERROR' : 'PUBLISHED',
            ...(url.endsWith('post-page')
              ? {
                  error: 'Provider rejected this destination.',
                  releaseId: null,
                  releaseURL: null,
                }
              : {}),
          },
        ],
      }),
    }));

    renderPublish(submitter);
    fireEvent.click(await screen.findByRole('button', { name: 'Publish now' }));

    expect(
      await screen.findByText(
        'At least one destination failed, but retry is locked because publishing may already have started or the account requires reconnection.'
      )
    ).toBeTruthy();
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Check the calendar and connected accounts before retrying to avoid a duplicate post.'
    );
    expect(screen.getByText('Published')).toBeTruthy();
    expect(screen.getByText('Failed')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Prepare retry' })).toBeNull();

    const publishButton = screen.getByRole('button', { name: 'Publish now' });
    expect(publishButton.hasAttribute('disabled')).toBe(true);
    fireEvent.click(publishButton);
    await waitFor(() => expect(submitter).toHaveBeenCalledTimes(1));
  });

  it('polls a returned post until PUBLISHED and stops at the configured timeout', async () => {
    let attempts = 0;
    const publishedFetcher = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        posts: [
          {
            id: 'returned-post',
            state: attempts++ === 0 ? 'QUEUE' : 'PUBLISHED',
          },
        ],
      }),
    }));
    let clock = 0;
    const published = await pollGuidedPublishPost({
      fetcher: publishedFetcher,
      reference: {
        postId: 'returned-post',
        integration: linkedinPersonal.id,
      },
      timing: 'now',
      timeoutMs: 10,
      intervalMs: 5,
      now: () => clock,
      pause: async (milliseconds) => {
        clock += milliseconds;
      },
    });

    expect(published.status).toBe('published');
    expect(publishedFetcher).toHaveBeenCalledTimes(2);
    expect(publishedFetcher).toHaveBeenCalledWith(
      '/posts/returned-post',
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );

    clock = 0;
    const queuedFetcher = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ posts: [{ id: 'slow-post', state: 'QUEUE' }] }),
    });
    const timedOut = await pollGuidedPublishPost({
      fetcher: queuedFetcher,
      reference: { postId: 'slow-post', integration: linkedinPage.id },
      timing: 'now',
      timeoutMs: 10,
      intervalMs: 5,
      now: () => clock,
      pause: async (milliseconds) => {
        clock += milliseconds;
      },
    });

    expect(timedOut.status).toBe('processing');
    expect(timedOut.message).toContain('Status checks stopped');
    expect(queuedFetcher).toHaveBeenCalledTimes(2);
  });

  it('terminates a never-resolving status request inside the polling window', async () => {
    let requestSignal: AbortSignal | undefined;
    const startedAt = Date.now();
    const result = await pollGuidedPublishPost({
      fetcher: async (_url, options) => {
        requestSignal = options?.signal;
        return await new Promise(() => undefined);
      },
      reference: {
        postId: 'hanging-post',
        integration: linkedinPersonal.id,
      },
      timing: 'now',
      timeoutMs: 25,
      intervalMs: 5,
    });

    expect(Date.now() - startedAt).toBeLessThan(250);
    expect(requestSignal?.aborted).toBe(true);
    expect(result.status).toBe('processing');
    expect(result.message).toContain('timed out');
  });

  it('waits for the full post chain and maps any child error as failure', async () => {
    let clock = 0;
    const chainFetcher = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          posts: [
            { id: 'thread-root', state: 'PUBLISHED' },
            { id: 'thread-child', state: 'QUEUE' },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          posts: [
            { id: 'thread-root', state: 'PUBLISHED' },
            { id: 'thread-child', state: 'PUBLISHED' },
          ],
        }),
      });
    const published = await pollGuidedPublishPost({
      fetcher: chainFetcher,
      reference: {
        postId: 'thread-root',
        integration: linkedinPersonal.id,
      },
      timing: 'now',
      timeoutMs: 10,
      intervalMs: 5,
      now: () => clock,
      pause: async (milliseconds) => {
        clock += milliseconds;
      },
    });

    expect(published.status).toBe('published');
    expect(chainFetcher).toHaveBeenCalledTimes(2);

    const failed = await pollGuidedPublishPost({
      fetcher: async () => ({
        ok: true,
        json: async () => ({
          posts: [
            { id: 'failed-root', state: 'PUBLISHED' },
            {
              id: 'failed-child',
              state: 'ERROR',
              error: 'Comment failed.',
            },
          ],
        }),
      }),
      reference: {
        postId: 'failed-root',
        integration: linkedinPage.id,
      },
      timing: 'now',
    });

    expect(failed).toMatchObject({
      status: 'failed',
      message: 'Comment failed.',
      retryable: false,
    });
  });

  it('does not show Scheduled when a schedule submission fails', async () => {
    const submitter = jest.fn().mockResolvedValue({
      ok: false,
      kind: 'validation',
      message: 'Schedule validation failed.',
      ambiguous: false,
    });

    renderPublish(submitter);
    fireEvent.click(screen.getByRole('radio', { name: /Schedule/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Schedule post' }));

    expect((await screen.findByRole('alert')).textContent).toContain(
      'Schedule validation failed.'
    );
    expect(screen.queryByText('Scheduled')).toBeNull();
    expect(screen.getAllByText('Failed')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Prepare retry' })).toBeTruthy();
  });

  it('maps explicit backend reconnect state without claiming publication', async () => {
    const result = await pollGuidedPublishPost({
      fetcher: async () => ({
        ok: true,
        json: async () => ({
          posts: [
            {
              id: 'reconnect-post',
              state: 'ERROR',
              integration: { refreshNeeded: true },
            },
          ],
        }),
      }),
      reference: {
        postId: 'reconnect-post',
        integration: linkedinPersonal.id,
      },
      timing: 'now',
    });

    expect(result.status).toBe('reconnect-required');
    expect(result.status).not.toBe('published');
  });
});
