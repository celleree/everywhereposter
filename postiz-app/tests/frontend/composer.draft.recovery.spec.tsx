import React, { StrictMode } from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  cleanup,
} from '@testing-library/react';
import dayjs from 'dayjs';

let mockUser: any = { id: 'user-1', orgId: 'org-1' };
const mockFetch = jest.fn();
jest.mock('@gitroom/frontend/components/layout/user.context', () => ({
  useUser: () => mockUser,
}));
jest.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () => mockFetch,
}));
jest.mock('@gitroom/frontend/components/layout/set.timezone', () => ({
  newDayjs: () => require('dayjs')('2035-01-01T12:00:00Z'),
}));
jest.mock(
  '@gitroom/frontend/components/launches/helpers/use.existing.data',
  () => ({ useExistingData: () => ({}) })
);
jest.mock(
  '@gitroom/frontend/components/launches/general.preview.component',
  () => ({ GeneralPreviewComponent: () => null })
);
jest.mock(
  '@gitroom/frontend/components/launches/helpers/use.integration',
  () => {
    const React = require('react');
    return { IntegrationContext: React.createContext({}) };
  }
);
jest.mock('@gitroom/frontend/components/launches/internal.channels', () => ({
  InternalChannels: () => null,
}));
jest.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}));
jest.mock('swr', () => ({
  __esModule: true,
  default: () => ({ data: { internalPlugs: [] } }),
}));
jest.mock('@gitroom/frontend/components/media/media.component', () => ({
  MediaComponent: () => null,
}));
jest.mock('@gitroom/frontend/components/layout/new-modal', () => ({
  useModals: () => ({
    openModal: jest.fn(),
    closeAll: jest.fn(),
    closeById: jest.fn(),
    closeCurrent: jest.fn(),
  }),
}));
jest.mock('@gitroom/react/helpers/image.with.fallback', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@gitroom/react/helpers/safe.image', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@gitroom/react/helpers/video.frame', () => ({
  VideoFrame: () => <div data-testid="video-preview" />,
}));
jest.mock('@gitroom/frontend/components/launches/helpers/date.picker', () => ({
  DatePicker: () => null,
}));
jest.mock('@gitroom/frontend/components/new-launch/manage.modal', () => {
  const React = require('react');
  const { useFormContext } = require('react-hook-form');
  const {
    useLaunchStore,
  } = require('../../apps/frontend/src/components/new-launch/store');
  const {
    withProvider,
    PostComment,
  } = require('../../apps/frontend/src/components/new-launch/providers/high.order.provider');
  const Settings = () => {
    const form = useFormContext();
    return <input aria-label="Privacy setting" {...form.register('privacy')} />;
  };
  const Provider = withProvider({
    postComment: PostComment.ALL,
    minimumCharacters: [],
    maximumCharacters: 5000,
    SettingsComponent: Settings,
  });
  return {
    ManageModal: () => {
      const selections = useLaunchStore(
        (state: any) => state.selectedIntegrations
      );
      return (
        <div data-testid="manage-modal">
          <div id="social-settings" />
          {selections.map((selected: any) => (
            <Provider
              key={selected.integration.id}
              id={selected.integration.id}
              ref={selected.ref}
            />
          ))}
        </div>
      );
    },
  };
});

import { CreatePostComposer } from '../../apps/frontend/src/components/create/create.post.composer';
import { useLaunchStore } from '../../apps/frontend/src/components/new-launch/store';
import { useGuidedComposerStore } from '../../apps/frontend/src/components/new-launch/guided.composer.store';
import { buildGuidedGenerationFingerprint } from '../../apps/frontend/src/components/new-launch/guided.composer.generation';
import { buildGuidedReviewDraftSeeds } from '../../apps/frontend/src/components/new-launch/guided.composer.review';
import {
  ComposerDraftRecovery,
  composerDraftKey,
  hydrateComposerDraft,
  readComposerDraft,
  snapshotComposerDraft,
  useComposerDraftRecovery,
  INTERRUPTED_GENERATION,
  readSubmissionStatus,
} from '../../apps/frontend/src/components/new-launch/composer.draft.recovery';

const integration: any = {
  id: 'channel-1',
  identifier: 'linkedin',
  name: 'Business',
  type: 'social',
  editor: 'normal',
  disabled: false,
  inBetweenSteps: false,
  additionalSettings: '[]',
  picture: '',
  time: [],
};
const props = {
  standaloneCreate: true,
  date: dayjs('2035-01-01T12:00:00Z'),
  allIntegrations: [integration],
  integrations: [integration],
  reopenModal: () => {},
  mutate: () => {},
};
const key = () => composerDraftKey(mockUser.id, mockUser.orgId);
const draft = () =>
  readComposerDraft(localStorage.getItem(key())!, mockUser.id, mockUser.orgId);
const composer = () => <CreatePostComposer {...props} />;
function seedReview() {
  const fingerprint = buildGuidedGenerationFingerprint({
    mediaId: 'media-1',
    destinations: [integration],
    captionMode: 'generate',
    sourceCaption: '',
    additionalContext: 'Audience context',
  });
  const response: any = {
    requestId: 'request-1',
    status: 'complete',
    results: [
      {
        platform: 'linkedin',
        draft: 'Generated caption',
        origin: 'generated',
        warnings: [],
      },
    ],
    warnings: [],
  };
  useGuidedComposerStore
    .getState()
    .completeGeneration(response, [], fingerprint);
  useGuidedComposerStore.getState().reconcileReviewDrafts(
    buildGuidedReviewDraftSeeds({
      destinations: [integration],
      generatedResponse: response,
      generationInputFingerprint: fingerprint,
      unsupportedDestinationIds: new Set(),
      fallbackCaption: 'Original draft',
      originalCaption: 'Original draft',
    })
  );
  useGuidedComposerStore
    .getState()
    .editReviewCaption(integration.id, 'Manually reviewed caption');
  useGuidedComposerStore.getState().setComposerStep('review');
}
function editDraft() {
  const launch = useLaunchStore.getState();
  launch.setGlobalValueText(0, 'Original draft');
  launch.setGlobalValueMedia(0, [
    {
      id: 'media-1',
      path: '/uploads/photo.jpg',
      alt: 'Product photo',
      thumbnailTimestamp: 4.2,
    } as any,
  ]);
  launch.addOrRemoveSelectedIntegration(integration, {});
  launch.setDate(dayjs('2035-04-05T14:15:00Z'));
  launch.addRemoveInternal(integration.id, true);
  launch.addInternalValue(0, integration.id, [
    { id: 'comment-1', content: 'Platform comment', delay: 7, media: [] },
  ]);
  useGuidedComposerStore.getState().setAdditionalContext('Audience context');
  seedReview();
}

beforeEach(() => {
  mockUser = { id: 'user-1', orgId: 'org-1' };
  localStorage.clear();
  process.env.NEXT_PUBLIC_GUIDED_COMPOSER_SHELL = 'true';
  useLaunchStore.getState().reset();
  useGuidedComposerStore.getState().resetGuidedComposer();
  mockFetch.mockReset().mockImplementation(async (url: string) => ({
    ok: true,
    json: async () =>
      url.includes('/transcription')
        ? { mediaId: 'media-1', status: 'READY' }
        : {
            id: url.split('/').pop(),
            path: '/uploads/photo.jpg',
            type: 'image',
          },
  }));
});
afterEach(() => {
  cleanup();
  delete process.env.NEXT_PUBLIC_GUIDED_COMPOSER_SHELL;
});

describe('reviewed immediate publication recovery', () => {
  let recovery: ReturnType<typeof useComposerDraftRecovery>;
  const Probe = () => { recovery = useComposerDraftRecovery(); return <span>Immediate fixture</span>; };
  const status = (id: string, state = 'processing', recoverability = 'locked') => ({ submissionId: id, destinations: [{
    integrationId: 'channel-1', postId: 'root-1', generation: 1, postState: state === 'published' ? 'PUBLISHED' : 'QUEUE',
    providerState: state === 'published' ? 'SUCCEEDED' : state === 'uncertain' ? 'UNCERTAIN' : 'READY',
    workflowState: state === 'failed-before-provider' ? 'FAILED' : 'unknown', state, recoverability,
  }] });
  const mount = async () => {
    const view = render(<ComposerDraftRecovery integrations={[integration]}><Probe /></ComposerDraftRecovery>);
    await screen.findByText('Immediate fixture');
    act(() => useLaunchStore.getState().setGlobalValue([{ id: 'source', content: 'Reviewed caption', delay: 0, media: [] }]));
    return view;
  };
  const begin = async () => {
    let id: string | null = null;
    await act(async () => { id = await recovery.beginImmediateSubmission(['channel-1']); });
    return id!;
  };
  beforeEach(() => {
    let held = false;
    Object.defineProperty(navigator, 'locks', { configurable: true, value: {
      request: jest.fn(async (_name: string, _options: unknown, run: any) => {
        if (held) return run(null);
        held = true; try { return await run({ name: 'fixture-lock' }); } finally { held = false; }
      }),
    } });
  });

  it('flushes one durable identity before admission and refuses repeated confirmation', async () => {
    await mount(); const id = await begin();
    expect(id).toMatch(/^[a-f0-9]{32}$/);
    expect(draft().journal).toMatchObject({ attemptId: id, durableImmediate: true, destinationIds: ['channel-1'] });
    expect(await begin()).toBeNull();
    expect(draft().journal?.attemptId).toBe(id);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it.each(['missing-locks', 'busy-lock', 'storage-failure'])('starts no request when %s prevents persistence/coordination', async failure => {
    await mount();
    if (failure === 'missing-locks') Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined });
    if (failure === 'busy-lock') (navigator.locks.request as jest.Mock).mockImplementation(async (_name, _options, run) => run(null));
    const spy = failure === 'storage-failure' ? jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw Error('quota'); }) : null;
    try { expect(await begin()).toBeNull(); expect(mockFetch).not.toHaveBeenCalled(); } finally { spy?.mockRestore(); }
  });

  it('adopts a competing tab identity rather than overwriting it', async () => {
    await mount();
    const other = snapshotComposerDraft(mockUser.id, mockUser.orgId, 'now', { attemptId: 'other-tab-attempt-123', startedAt: 1, destinationIds: ['channel-1'], durableImmediate: true });
    localStorage.setItem(key(), JSON.stringify(other));
    expect(await begin()).toBeNull();
    expect(draft().journal?.attemptId).toBe('other-tab-attempt-123');
  });

  it('recovers a lost backend response after refresh through GET only', async () => {
    const view = await mount(); const id = await begin(); view.unmount();
    mockFetch.mockImplementation(async () => ({ ok: true, json: async () => status(id, 'published', 'complete') }));
    await mount();
    await screen.findByText('Business: Published');
    expect(mockFetch).toHaveBeenCalledWith(`/posts/submissions/${id}`, expect.objectContaining({ method: 'GET' }));
    expect(mockFetch.mock.calls.every(([, options]) => options.method === 'GET')).toBe(true);
    expect(await begin()).toBeNull();
  });

  it.each(['404', 'lookup-failure', 'malformed', 'uncertain'])('keeps %s outcomes locked, including new-draft controls', async mode => {
    await mount(); const id = await begin();
    mockFetch.mockImplementation(async () => {
      if (mode === 'lookup-failure') throw Error('offline');
      return { ok: mode !== '404', json: async () => mode === 'malformed' ? { ...status(id), destinations: [] } : status(id, 'uncertain') };
    });
    await act(async () => recovery.checkImmediateSubmission());
    fireEvent.click(screen.getByRole('button', { name: 'Start a new draft' }));
    await screen.findByText('Resolve the existing publishing attempt before starting a new draft.');
    expect(draft().journal?.attemptId).toBe(id);
    expect(screen.queryByRole('button', { name: 'Resume pending dispatch' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Retry publishing to/ })).toBeNull();
    expect(mockFetch.mock.calls.every(([, options]) => options.method === 'GET')).toBe(true);
  });

  it.each([['processing', 'resume-dispatch', 'Resume pending dispatch', '/resume'],
    ['failed-before-provider', 'retry-before-provider', 'Retry publishing to Business', '/destinations/channel-1/retry']])(
    'uses only the existing %s recovery action', async (state, recoverability, label, suffix) => {
      await mount(); const id = await begin();
      mockFetch.mockImplementation(async () => ({ ok: true, json: async () => status(id, state, recoverability) }));
      await act(async () => recovery.checkImmediateSubmission());
      fireEvent.click(await screen.findByRole('button', { name: label }));
      await waitFor(() => expect(mockFetch).toHaveBeenCalledWith(`/posts/submissions/${id}${suffix}`, expect.objectContaining({ method: 'POST' })));
      expect(mockFetch.mock.calls.some(([url]) => url === '/posts')).toBe(false);
    }
  );

  it('rejects status identity/destination mismatches and never offers actions for uncertain provider calls', () => {
    const journal = { attemptId: 'attempt-1234567890', startedAt: 1, destinationIds: ['channel-1'], durableImmediate: true as const };
    expect(() => readSubmissionStatus(status('other-attempt-123'), journal)).toThrow();
    const response = status(journal.attemptId, 'uncertain', 'retry-before-provider');
    expect(() => readSubmissionStatus(response, journal)).toThrow();
    response.destinations[0].integrationId = 'foreign-channel';
    expect(() => readSubmissionStatus(response, journal)).toThrow();
  });

  it('discards late status responses after an organization change', async () => {
    const view = await mount(); const id = await begin();
    let release!: (value: any) => void;
    mockFetch.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    let pending!: Promise<void>;
    act(() => { pending = recovery.checkImmediateSubmission(); });
    mockUser = { id: 'user-1', orgId: 'another-org' };
    view.rerender(<ComposerDraftRecovery integrations={[integration]}><Probe /></ComposerDraftRecovery>);
    await screen.findByText('Immediate fixture');
    await act(async () => { release({ ok: true, json: async () => status(id, 'published', 'complete') }); await pending; });
    expect(screen.queryByText('Business: Published')).toBeNull();
    expect(localStorage.getItem(key()) || '').not.toContain(id);
  });
});

it('recovers meaningful work and live provider settings through the actual standalone Create mount chain', async () => {
  const view = render(composer());
  await screen.findByTestId('manage-modal');
  act(editDraft);
  fireEvent.change(await screen.findByLabelText('Privacy setting'), {
    target: { value: 'public' },
  });
  await waitFor(() =>
    expect(draft().destinations[0].settings.privacy).toBe('public')
  );
  expect(draft().global[0].media).toEqual([
    { id: 'media-1', alt: 'Product photo', thumbnailTimestamp: 4.2 },
  ]);
  expect(JSON.stringify(draft())).not.toContain('/uploads/photo.jpg');
  view.unmount();
  expect(useLaunchStore.getState().global).toHaveLength(0);
  render(composer());
  await screen.findByTestId('manage-modal');
  expect(useLaunchStore.getState().global).toHaveLength(1);
  expect(useLaunchStore.getState().global[0].content).toBe('Original draft');
  expect(useLaunchStore.getState().global[0].media[0]).toMatchObject({
    alt: 'Product photo',
    thumbnailTimestamp: 4.2,
  });
  expect(useLaunchStore.getState().date.toISOString()).toBe(
    '2035-04-05T14:15:00.000Z'
  );
  expect(
    useLaunchStore
      .getState()
      .internal[0].integrationValue.some(
        (value) => value.content === 'Platform comment' && value.delay === 7
      )
  ).toBe(true);
  expect(useGuidedComposerStore.getState().additionalContext).toBe(
    'Audience context'
  );
  expect(
    useGuidedComposerStore.getState().reviewDrafts[integration.id].caption
  ).toBe('Manually reviewed caption');
  expect(
    (screen.getByLabelText('Privacy setting') as HTMLInputElement).value
  ).toBe('public');
  expect(
    mockFetch.mock.calls.every(([, options]) => options?.method === 'GET')
  ).toBe(true);
});

it('survives Strict Mode and a short close/reopen with text-only caption options', async () => {
  const view = render(<StrictMode>{composer()}</StrictMode>);
  await screen.findByTestId('manage-modal');
  act(() => {
    useLaunchStore.getState().setGlobalValueText(0, 'Text draft');
    useGuidedComposerStore.getState().setSourceCaption('Source caption');
    useGuidedComposerStore.getState().setCaptionMode('use-everywhere');
    useGuidedComposerStore.getState().setComposerStep('destinations');
  });
  view.unmount();
  render(<StrictMode>{composer()}</StrictMode>);
  await screen.findByTestId('manage-modal');
  expect(useLaunchStore.getState().global).toHaveLength(1);
  expect(useLaunchStore.getState().global[0].content).toBe('Text draft');
  expect(useGuidedComposerStore.getState()).toMatchObject({
    sourceCaption: 'Source caption',
    captionMode: 'use-everywhere',
    composerStep: 'destinations',
  });
});

it('hydrates fresh integration metadata before Review chooses its active destination', async () => {
  const second: any = {
    ...integration,
    id: 'channel-2',
    name: 'Second account',
  };
  const view = render(
    <CreatePostComposer {...props} allIntegrations={[integration, second]} />
  );
  await screen.findByTestId('manage-modal');
  act(() => {
    useLaunchStore.getState().setGlobalValueText(0, 'Text draft');
    useLaunchStore.getState().addOrRemoveSelectedIntegration(integration, {});
    useLaunchStore.getState().addOrRemoveSelectedIntegration(second, {});
    useGuidedComposerStore.getState().setComposerStep('review');
  });
  fireEvent.click(await screen.findByRole('tab', { name: /Second account/ }));
  expect(useLaunchStore.getState().current).toBe(second.id);
  view.unmount();
  render(
    <CreatePostComposer {...props} allIntegrations={[integration, second]} />
  );
  await screen.findByTestId('manage-modal');
  expect(useLaunchStore.getState().current).toBe(second.id);
  expect(
    screen
      .getByRole('tab', { name: /Second account/ })
      .getAttribute('aria-selected')
  ).toBe('true');
});

it('keeps missing media and unavailable destination drafts intact for retry', async () => {
  const view = render(composer());
  await screen.findByTestId('manage-modal');
  act(editDraft);
  view.unmount();
  const before = localStorage.getItem(key());
  mockFetch.mockResolvedValue({ ok: false });
  const blocked = render(composer());
  await screen.findByRole('button', { name: 'Retry recovery' });
  expect(localStorage.getItem(key())).toBe(before);
  expect(screen.queryByTestId('manage-modal')).toBeNull();
  blocked.unmount();
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => ({
      id: 'media-1',
      path: '/uploads/authoritative.jpg',
      type: 'image',
    }),
  });
  render(
    <CreatePostComposer
      {...props}
      allIntegrations={[{ ...integration, disabled: true }]}
    />
  );
  await screen.findByRole('button', { name: 'Retry recovery' });
  expect(localStorage.getItem(key())).toBe(before);
});

it('isolates users and organizations and rejects corrupt or non-JSON state', async () => {
  const view = render(composer());
  await screen.findByTestId('manage-modal');
  act(() => useLaunchStore.getState().setGlobalValueText(0, 'Private draft'));
  view.unmount();
  const original = localStorage.getItem(key());
  for (const identity of [
    { id: 'user-2', orgId: 'org-1' },
    { id: 'user-1', orgId: 'org-2' },
  ]) {
    mockUser = identity;
    const next = render(composer());
    await screen.findByTestId('manage-modal');
    expect(useLaunchStore.getState().global[0].content).toBe('');
    next.unmount();
  }
  expect(localStorage.getItem(composerDraftKey('user-1', 'org-1'))).toBe(
    original
  );
  expect(() => readComposerDraft(original!, 'user-2', 'org-1')).toThrow();
  mockUser = { id: 'user-1', orgId: 'org-1' };
  localStorage.setItem(key(), '{broken');
  render(composer());
  await screen.findByRole('button', { name: 'Retry recovery' });
  expect(localStorage.getItem(key())).toBe('{broken');
});

it('restores interrupted generation without restarting providers or overwriting reviewed text', async () => {
  const view = render(composer());
  await screen.findByTestId('manage-modal');
  act(editDraft);
  act(() =>
    useGuidedComposerStore.getState().startGeneration('interrupted-input')
  );
  const caption =
    useGuidedComposerStore.getState().reviewDrafts[integration.id].caption;
  view.unmount();
  render(composer());
  await screen.findByTestId('manage-modal');
  expect(useGuidedComposerStore.getState().generationError).toBe(
    INTERRUPTED_GENERATION
  );
  expect(
    useGuidedComposerStore.getState().reviewDrafts[integration.id].caption
  ).toBe(caption);
  expect(
    mockFetch.mock.calls.every(([, options]) => options?.method === 'GET')
  ).toBe(true);
});

it('refuses late asynchronous media hydration after the recovery boundary unmounts', async () => {
  useLaunchStore.getState().setGlobalValue([
    {
      id: 'post-1',
      content: 'Saved',
      delay: 0,
      media: [{ id: 'media-1', path: '/uploads/photo.jpg' }],
    },
  ]);
  const saved = snapshotComposerDraft('user-1', 'org-1', 'now', null);
  let release!: () => void;
  const deferred = new Promise<void>((resolve) => {
    release = resolve;
  });
  const pending = hydrateComposerDraft(
    saved,
    [],
    (async () => {
      await deferred;
      return {
        ok: true,
        json: async () => ({ id: 'media-1', path: '/uploads/photo.jpg' }),
      };
    }) as any,
    () => false
  );
  useLaunchStore.getState().setGlobalValueText(0, 'New session');
  release();
  await pending;
  expect(useLaunchStore.getState().global[0].content).toBe('New session');
});

it('flushes a publishing marker before mutation and blocks every recovered attempt including accepted or uncertain requests', async () => {
  let mutate = jest.fn();
  function Attempt() {
    const recovery = useComposerDraftRecovery();
    return (
      <button
        disabled={recovery.publishLocked}
        onClick={() => {
          if (recovery.beginSubmission(['channel-1'])) mutate(draft().journal);
        }}
      >
        Submit fixture
      </button>
    );
  }
  const view = render(
    <ComposerDraftRecovery integrations={[]}>
      <Attempt />
    </ComposerDraftRecovery>
  );
  await screen.findByRole('button', { name: 'Submit fixture' });
  act(() =>
    useLaunchStore
      .getState()
      .setGlobalValue([{ id: 'post-1', content: 'Saved', delay: 0, media: [] }])
  );
  fireEvent.click(screen.getByRole('button', { name: 'Submit fixture' }));
  expect(mutate).toHaveBeenCalledWith(
    expect.objectContaining({ destinationIds: ['channel-1'] })
  );
  view.unmount();
  render(
    <ComposerDraftRecovery integrations={[]}>
      <Attempt />
    </ComposerDraftRecovery>
  );
  const recovered = await screen.findByRole('button', {
    name: 'Submit fixture',
  });
  expect(recovered).toBeDisabled();
  fireEvent.click(recovered);
  expect(mutate).toHaveBeenCalledTimes(1);
});

it('recovers standalone legacy Create with the guided rollout flag disabled', async () => {
  process.env.NEXT_PUBLIC_GUIDED_COMPOSER_SHELL = 'false';
  const view = render(composer());
  await screen.findByTestId('manage-modal');
  act(() => {
    useLaunchStore.getState().setGlobalValueText(0, 'Legacy caption');
    useLaunchStore
      .getState()
      .setGlobalValueMedia(0, [{ id: 'media-1', path: '/uploads/photo.jpg' }]);
    useLaunchStore.getState().addOrRemoveSelectedIntegration(integration, {});
    useLaunchStore.getState().setCurrent(integration.id);
  });
  fireEvent.change(await screen.findByLabelText('Privacy setting'), {
    target: { value: 'private' },
  });
  view.unmount();
  render(composer());
  await screen.findByTestId('manage-modal');
  expect(useLaunchStore.getState().global[0].content).toBe('Legacy caption');
  expect(useLaunchStore.getState().global[0].media[0].path).toBe(
    '/uploads/photo.jpg'
  );
  expect(
    (screen.getByLabelText('Privacy setting') as HTMLInputElement).value
  ).toBe('private');
});

it('retains another tab publishing marker during stale autosaves and locks submission', async () => {
  function Attempt() {
    const recovery = useComposerDraftRecovery();
    return (
      <button
        disabled={recovery.publishLocked}
        onClick={() => recovery.beginSubmission(['channel-1'])}
      >
        Cross-tab submit
      </button>
    );
  }
  render(
    <ComposerDraftRecovery integrations={[]}>
      <Attempt />
    </ComposerDraftRecovery>
  );
  await screen.findByRole('button', { name: 'Cross-tab submit' });
  act(() =>
    useLaunchStore
      .getState()
      .setGlobalValue([{ id: 'post-1', content: 'Saved', delay: 0, media: [] }])
  );
  const journal = {
    destinationIds: ['channel-1'],
    startedAt: Date.now(),
    attemptId: 'foreign-tab-attempt',
  };
  localStorage.setItem(key(), JSON.stringify({ ...draft(), journal }));
  act(() => window.dispatchEvent(new StorageEvent('storage', { key: key() })));
  act(() => useLaunchStore.getState().setGlobalValueText(0, 'Stale tab edit'));
  expect(draft().journal).toEqual(journal);
  expect(
    screen.getByRole('button', { name: 'Cross-tab submit' })
  ).toBeDisabled();
});

it('warns before leaving when quota failure prevents saving the latest work', async () => {
  render(composer());
  await screen.findByTestId('manage-modal');
  const storage = jest
    .spyOn(Storage.prototype, 'setItem')
    .mockImplementation(() => {
      throw new Error('Quota exceeded');
    });
  try {
    act(() => useLaunchStore.getState().setGlobalValueText(0, 'Unsaved text'));
    await screen.findByText(/Your draft cannot be saved in this browser/);
    const leaving = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(leaving);
    expect(leaving.defaultPrevented).toBe(true);
    expect(useLaunchStore.getState().global[0].content).toBe('Unsaved text');
  } finally {
    storage.mockRestore();
  }
});

it('conservatively blocks a legacy publishing journal without an attempt identity', async () => {
  const view = render(composer());
  await screen.findByTestId('manage-modal');
  act(() =>
    useLaunchStore.getState().setGlobalValueText(0, 'Previously attempted work')
  );
  view.unmount();
  const saved = {
    ...draft(),
    journal: { destinationIds: ['channel-1'], startedAt: Date.now() },
  };
  localStorage.setItem(key(), JSON.stringify(saved));
  const raw = localStorage.getItem(key());
  render(composer());
  await screen.findByRole('button', { name: 'Retry recovery' });
  expect(screen.queryByTestId('manage-modal')).toBeNull();
  expect(localStorage.getItem(key())).toBe(raw);
});

it('locks an orphaned unsent preparation after reopening and consumes an actual request only once', async () => {
  const attempts: boolean[] = [];
  function Prepare() {
    const recovery = useComposerDraftRecovery();
    return (
      <>
        <button
          disabled={recovery.publishLocked}
          onClick={() => recovery.prepareSubmission(['channel-1'])}
        >
          Prepare fixture
        </button>
        <button
          disabled={recovery.publishLocked}
          onClick={() => {
            attempts.push(
              recovery.beginSubmission(['channel-1']),
              recovery.beginSubmission(['channel-1'])
            );
            recovery.safeSubmissionFailure();
          }}
        >
          Consume fixture
        </button>
      </>
    );
  }
  const view = render(
    <ComposerDraftRecovery integrations={[]}>
      <Prepare />
    </ComposerDraftRecovery>
  );
  await screen.findByRole('button', { name: 'Prepare fixture' });
  act(() =>
    useLaunchStore
      .getState()
      .setGlobalValue([{ id: 'post-1', content: 'Saved', delay: 0, media: [] }])
  );
  fireEvent.click(screen.getByRole('button', { name: 'Prepare fixture' }));
  expect(draft().journal).toBeTruthy();
  expect(
    screen.getByRole('button', { name: 'Consume fixture' })
  ).not.toBeDisabled();
  view.unmount();
  const reopened = render(
    <ComposerDraftRecovery integrations={[]}>
      <Prepare />
    </ComposerDraftRecovery>
  );
  expect(
    await screen.findByRole('button', { name: 'Consume fixture' })
  ).toBeDisabled();
  reopened.unmount();
  localStorage.clear();
  render(
    <ComposerDraftRecovery integrations={[]}>
      <Prepare />
    </ComposerDraftRecovery>
  );
  await screen.findByRole('button', { name: 'Prepare fixture' });
  act(() =>
    useLaunchStore
      .getState()
      .setGlobalValue([{ id: 'post-2', content: 'Saved', delay: 0, media: [] }])
  );
  fireEvent.click(screen.getByRole('button', { name: 'Consume fixture' }));
  expect(attempts).toEqual([true, false]);
  expect(draft().journal).toBeTruthy();
});

it.each(['true', 'false'])(
  'reopens newly saved nullable media metadata with guided shell %s',
  async (guided) => {
    process.env.NEXT_PUBLIC_GUIDED_COMPOSER_SHELL = guided;
    const view = render(composer());
    await screen.findByTestId('manage-modal');
    act(() => {
      editDraft();
      const media: any = {
        id: 'media-1',
        path: '/uploads/photo.jpg',
        alt: null,
        thumbnailTimestamp: null,
      };
      useLaunchStore.getState().setGlobalValueMedia(0, [media]);
      useLaunchStore
        .getState()
        .setInternalValueMedia(integration.id, 1, [media]);
    });
    expect(draft().global[0].media).toEqual([{ id: 'media-1' }]);
    expect(draft().internal[0].integrationValue[1].media).toEqual([
      { id: 'media-1' },
    ]);
    view.unmount();
    render(composer());
    await screen.findByTestId('manage-modal');
    expect(useLaunchStore.getState().global[0]).toMatchObject({
      content: 'Original draft',
      media: [{ id: 'media-1', path: '/uploads/photo.jpg' }],
    });
    expect(
      useLaunchStore.getState().internal[0].integrationValue[1]
    ).toMatchObject({
      content: 'Platform comment',
      delay: 7,
      media: [{ id: 'media-1', path: '/uploads/photo.jpg' }],
    });
    expect(screen.queryByRole('button', { name: 'Retry recovery' })).toBeNull();
    expect(localStorage.getItem(key())).not.toBeNull();
  }
);

it.each([
  { alt: null },
  { thumbnailTimestamp: null },
  { alt: null, thumbnailTimestamp: null },
])(
  'recovers an existing v1 draft with nullable metadata %j without losing work',
  async (metadata) => {
    const view = render(composer());
    await screen.findByTestId('manage-modal');
    act(editDraft);
    view.unmount();
    const saved = draft();
    saved.global[0].media = [{ id: 'media-1', ...metadata } as any];
    saved.internal[0].integrationValue[1].media = [
      { id: 'media-1', ...metadata } as any,
    ];
    saved.destinations[0].settings.privacy = 'private';
    const raw = JSON.stringify(saved);
    localStorage.setItem(key(), raw);
    mockFetch.mockClear();
    expect(
      readComposerDraft(raw, mockUser.id, mockUser.orgId).global[0].media
    ).toEqual([{ id: 'media-1' }]);
    expect(localStorage.getItem(key())).toBe(raw);
    render(composer());
    await screen.findByTestId('manage-modal');
    expect(useLaunchStore.getState().global[0].content).toBe('Original draft');
    expect(useLaunchStore.getState().global[0].media[0].id).toBe('media-1');
    expect(useLaunchStore.getState().global[0].media[0].path).toBe(
      '/uploads/photo.jpg'
    );
    expect(
      useLaunchStore.getState().internal[0].integrationValue[1]
    ).toMatchObject({
      content: 'Platform comment',
      delay: 7,
      media: [{ id: 'media-1' }],
    });
    expect(useLaunchStore.getState().date.toISOString()).toBe(
      '2035-04-05T14:15:00.000Z'
    );
    expect(
      useGuidedComposerStore.getState().reviewDrafts[integration.id].caption
    ).toBe('Manually reviewed caption');
    expect(
      (screen.getByLabelText('Privacy setting') as HTMLInputElement).value
    ).toBe('private');
    expect(draft().global[0].media).toEqual([{ id: 'media-1' }]);
    expect(draft().internal[0].integrationValue[1].media).toEqual([
      { id: 'media-1' },
    ]);
    expect(mockFetch.mock.calls.some(([url]) => url === '/media/media-1')).toBe(
      true
    );
    expect(
      mockFetch.mock.calls.every(([, options]) => options?.method === 'GET')
    ).toBe(true);
  }
);

it('preserves empty alt text and zero thumbnail timestamps during recovery', async () => {
  const view = render(composer());
  await screen.findByTestId('manage-modal');
  const media: any = {
    id: 'media-1',
    path: '/uploads/photo.jpg',
    alt: '',
    thumbnailTimestamp: 0,
  };
  act(() => {
    editDraft();
    useLaunchStore.getState().setGlobalValueMedia(0, [media]);
  });
  const saved = readComposerDraft(
    JSON.stringify(
      snapshotComposerDraft(mockUser.id, mockUser.orgId, 'now', null)
    ),
    mockUser.id,
    mockUser.orgId
  );
  expect(saved.global[0].media).toEqual([
    { id: 'media-1', alt: '', thumbnailTimestamp: 0 },
  ]);
  view.unmount();
  await hydrateComposerDraft(saved, [integration], mockFetch);
  expect(useLaunchStore.getState().global[0].media[0]).toMatchObject({
    id: 'media-1',
    alt: '',
    thumbnailTimestamp: 0,
  });
});

it.each([
  { alt: 42 },
  { alt: false },
  { alt: {} },
  { alt: [] },
  { thumbnailTimestamp: '0' },
  { thumbnailTimestamp: false },
  { thumbnailTimestamp: -1 },
  { thumbnailTimestamp: {} },
  { thumbnailTimestamp: [] },
])(
  'retains malformed non-null media metadata %j as blocked recovery',
  async (metadata) => {
    const view = render(composer());
    await screen.findByTestId('manage-modal');
    act(editDraft);
    view.unmount();
    const saved = draft();
    for (const location of ['global', 'internal']) {
      const altered = JSON.parse(JSON.stringify(saved));
      const values =
        location === 'global'
          ? altered.global
          : altered.internal[0].integrationValue;
      values[0].media = [{ id: 'media-1', ...metadata }];
      const raw = JSON.stringify(altered);
      expect(() =>
        readComposerDraft(raw, mockUser.id, mockUser.orgId)
      ).toThrow();
      localStorage.setItem(key(), raw);
      const blocked = render(composer());
      await screen.findByRole('button', { name: 'Retry recovery' });
      expect(localStorage.getItem(key())).toBe(raw);
      expect(screen.queryByTestId('manage-modal')).toBeNull();
      blocked.unmount();
    }
  }
);

it.each(['true', 'false'])('starts a usable empty composer without reloading after acknowledging recovered publishing (guided %s)', async enabled => {
  process.env.NEXT_PUBLIC_GUIDED_COMPOSER_SHELL = enabled;
  const first = render(<StrictMode>{composer()}</StrictMode>);
  await screen.findByTestId('manage-modal');
  act(() => useLaunchStore.getState().setGlobalValueText(0, 'Previous caption'));
  const saved = draft();
  first.unmount();
  localStorage.setItem(key(), JSON.stringify({ ...saved, journal: { attemptId: 'previous', destinationIds: ['channel-1'], startedAt: Date.now() } }));
  const recovered = render(<StrictMode>{composer()}</StrictMode>);
  await screen.findByRole('region', { name: 'Publishing recovery' });
  fireEvent.click(screen.getByRole('button', { name: 'Acknowledge notice' }));
  expect(screen.getByText('Publishing remains locked until you start a new draft.')).toBeTruthy();
  expect(draft().journal?.attemptId).toBe('previous');
  const confirm = jest.spyOn(window, 'confirm').mockReturnValue(false);
  fireEvent.click(screen.getByRole('button', { name: 'Start a new draft' }));
  expect(draft().journal?.attemptId).toBe('previous');
  expect(useLaunchStore.getState().global[0].content).toBe('Previous caption');
  confirm.mockReturnValue(true);
  fireEvent.click(screen.getByRole('button', { name: 'Start a new draft' }));
  await screen.findByTestId('manage-modal');
  await waitFor(() => expect(useLaunchStore.getState().global).toHaveLength(1));
  expect(useLaunchStore.getState().global[0]).toMatchObject({ content: '', media: [] });
  expect(screen.queryByRole('region', { name: 'Publishing recovery' })).toBeNull();
  act(() => useLaunchStore.getState().setGlobalValueText(0, 'New caption'));
  expect(draft().journal).toBeNull();
  recovered.unmount();
  render(<StrictMode>{composer()}</StrictMode>);
  await screen.findByTestId('manage-modal');
  expect(useLaunchStore.getState().global[0].content).toBe('New caption');
  confirm.mockRestore();
});
