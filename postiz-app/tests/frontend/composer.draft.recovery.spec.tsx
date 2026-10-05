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
