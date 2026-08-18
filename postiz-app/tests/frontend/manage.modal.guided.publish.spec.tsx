import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mockFetch = jest.fn();
const mockCheckAllValid = jest.fn();
const mockShow = jest.fn();
const mockCloseAll = jest.fn();
const mockMutate = jest.fn();

jest.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () => mockFetch,
}));

jest.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}));

jest.mock('@gitroom/react/toaster/toaster', () => ({
  useToaster: () => ({ show: mockShow }),
}));

jest.mock('@gitroom/frontend/components/layout/new-modal', () => ({
  useModals: () => ({
    openModal: jest.fn(),
    closeAll: mockCloseAll,
    closeById: jest.fn(),
    closeCurrent: jest.fn(),
  }),
}));

jest.mock(
  '@gitroom/frontend/components/launches/helpers/use.existing.data',
  () => ({
    useExistingData: () => ({
      group: undefined,
      integration: undefined,
      posts: [],
      settings: {},
    }),
  })
);

jest.mock(
  '@gitroom/frontend/components/settings/shortlink-preference.component',
  () => ({
    useShortlinkPreference: () => ({ data: { shortlink: 'YES' } }),
  })
);

jest.mock(
  '@gitroom/frontend/components/new-launch/providers/show.all.providers',
  () => {
    const ReactModule = require('react');
    return {
      ShowAllProviders: ReactModule.forwardRef((_props: any, ref: any) => {
        ReactModule.useImperativeHandle(ref, () => ({
          checkAllValid: mockCheckAllValid,
          getAllValues: jest.fn(),
          triggerAll: jest.fn(),
        }));
        return null;
      }),
    };
  }
);

jest.mock(
  '@gitroom/frontend/components/new-launch/picks.socials.component',
  () => ({
    PicksSocialsComponent: () => null,
  })
);
jest.mock('@gitroom/frontend/components/new-launch/editor', () => ({
  EditorWrapper: () => null,
}));
jest.mock('@gitroom/frontend/components/new-launch/select.current', () => ({
  SelectCurrent: () => null,
}));
jest.mock('@gitroom/frontend/components/launches/helpers/date.picker', () => ({
  DatePicker: ({ date }: any) => (
    <div aria-label="Selected schedule time">
      {date.format('YYYY-MM-DD HH:mm')}
    </div>
  ),
}));
jest.mock('@gitroom/frontend/components/launches/repeat.component', () => ({
  RepeatComponent: () => null,
}));
jest.mock('@gitroom/frontend/components/launches/tags.component', () => ({
  TagsComponent: () => null,
}));
jest.mock('@gitroom/frontend/components/launches/select.customer', () => ({
  SelectCustomer: () => null,
}));
jest.mock(
  '@gitroom/frontend/components/new-launch/dummy.code.component',
  () => ({
    DummyCodeComponent: () => null,
  })
);
jest.mock('@gitroom/frontend/components/media/media.component', () => ({
  MediaBox: () => null,
}));
jest.mock('@gitroom/react/helpers/video.or.image', () => ({
  VideoOrImage: () => null,
}));
jest.mock('@gitroom/react/helpers/image.with.fallback', () => ({
  __esModule: true,
  default: ({ fallbackSrc: _fallbackSrc, ...props }: any) => <img {...props} />,
}));
jest.mock('@gitroom/react/helpers/video.frame', () => ({
  VideoFrame: () => null,
}));
jest.mock('@gitroom/react/helpers/use.media.directory', () => ({
  useMediaDirectory: () => ({ set: (path: string) => path }),
}));
jest.mock('@gitroom/frontend/components/media/new.uploader', () => ({
  cancelUppyUploads: jest.fn(),
  useUppyUploader: () => ({
    addFile: jest.fn(),
    clear: jest.fn(),
  }),
}));
jest.mock('react-dropzone', () => ({
  useDropzone: () => ({
    getRootProps: () => ({}),
    getInputProps: () => ({}),
    isDragActive: false,
    open: jest.fn(),
  }),
}));
jest.mock('@uppy/react', () => ({ Dashboard: () => null }));
jest.mock('@copilotkit/react-core', () => ({ useCopilotReadable: jest.fn() }));
jest.mock('@copilotkit/react-ui', () => ({ CopilotPopup: () => null }));
jest.mock('@gitroom/react/form/button', () => ({
  Button: ({ children, ...props }: any) => (
    <button {...props}>{children}</button>
  ),
}));
jest.mock('@gitroom/react/helpers/delete.dialog', () => ({
  deleteDialog: jest.fn().mockResolvedValue(true),
}));
jest.mock('@gitroom/nestjs-libraries/services/make.is', () => ({
  makeId: () => 'guided-group',
}));
jest.mock('@gitroom/frontend/components/ui/icons', () => ({
  SettingsIcon: () => null,
  ChevronDownIcon: () => null,
  CloseIcon: () => null,
  TrashIcon: () => null,
  DropdownArrowSmallIcon: () => null,
}));
jest.mock(
  '@gitroom/frontend/components/new-launch/providers/high.order.provider',
  () => ({ PostComment: { ALL: 'ALL' } })
);

import { ManageModal } from '../../apps/frontend/src/components/new-launch/manage.modal';
import {
  GuidedComposerPublish,
  GuidedComposerPublishBridgeProvider,
} from '../../apps/frontend/src/components/new-launch/guided.composer.publish';
import { useGuidedComposerStore } from '../../apps/frontend/src/components/new-launch/guided.composer.store';
import { useLaunchStore } from '../../apps/frontend/src/components/new-launch/store';

const founderLinkedIn = {
  id: 'linkedin-founder',
  name: 'Founder LinkedIn',
  identifier: 'linkedin',
  display: 'Founder',
  picture: '',
  disabled: false,
  inBetweenSteps: false,
} as any;

const companyLinkedIn = {
  id: 'linkedin-company',
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

const media = [
  {
    id: 'video-1',
    path: 'https://media.example.com/video.mp4',
    alt: 'Product demo',
    thumbnail: 'https://media.example.com/video-thumb.jpg',
    thumbnailTimestamp: 4,
  },
];

const providerResult = (
  integration: any,
  settings: Record<string, unknown>,
  valid = true
) => ({
  integration,
  valid,
  errors: true,
  maximumCharacters: 3000,
  settings,
  values: [
    {
      id: `${integration.id}-root`,
      content: `Provider caption for ${integration.id}`,
      delay: 0,
      media,
    },
    {
      id: `${integration.id}-comment`,
      content: `Provider comment for ${integration.id}`,
      delay: 5,
      media: [],
    },
  ],
  fix: jest.fn(),
  preview: jest.fn(),
});

let providerResults: any[] = [];

const seedStores = () => {
  useLaunchStore.getState().reset();
  useGuidedComposerStore.getState().resetGuidedComposer();
  useLaunchStore
    .getState()
    .setAllIntegrations([founderLinkedIn, companyLinkedIn, disabledX]);
  useLaunchStore.getState().setSelectedIntegrations(
    [founderLinkedIn, companyLinkedIn, disabledX].map((integration) => ({
      selectedIntegrations: integration,
      settings: {},
    }))
  );
  useLaunchStore.getState().addGlobalValue(0, [
    {
      id: 'global-root',
      content: 'Global caption',
      delay: 0,
      media,
    },
  ]);
  useLaunchStore.getState().setChars(founderLinkedIn.id, 3000);
  useLaunchStore.getState().setChars(companyLinkedIn.id, 3000);
  useLaunchStore.getState().setChars(disabledX.id, 280);
  useGuidedComposerStore.getState().reconcileReviewDrafts([
    {
      destinationId: founderLinkedIn.id,
      platform: 'linkedin',
      sourceFingerprint: 'founder-review',
      caption: 'Edited founder caption.',
      baselineCaption: 'Founder baseline.',
      baselineSource: 'generated',
      originalCaption: 'Original caption.',
      warnings: [],
    },
    {
      destinationId: companyLinkedIn.id,
      platform: 'linkedin',
      sourceFingerprint: 'company-review',
      caption: 'Edited company caption.',
      baselineCaption: 'Company baseline.',
      baselineSource: 'generated',
      originalCaption: 'Original caption.',
      warnings: [],
    },
    {
      destinationId: disabledX.id,
      platform: 'x',
      sourceFingerprint: 'disabled-review',
      caption: 'Disabled caption.',
      baselineCaption: 'Disabled baseline.',
      baselineSource: 'generated',
      originalCaption: 'Original caption.',
      warnings: [],
    },
  ]);
  useGuidedComposerStore
    .getState()
    .setReviewDestinationEnabled(disabledX.id, false);

  providerResults = [
    providerResult(founderLinkedIn, {
      __type: 'linkedin',
      visibility: 'PUBLIC',
    }),
    providerResult(companyLinkedIn, {
      __type: 'linkedin-page',
      organization: 'company-1',
    }),
    providerResult(disabledX, { __type: 'x' }),
  ];
  mockCheckAllValid.mockImplementation(async (destinationIds?: string[]) => {
    const scope = destinationIds ? new Set(destinationIds) : null;
    return providerResults.filter(
      (result) => !scope || scope.has(result.integration.id)
    );
  });
};

const manageModalProps = {
  date: useLaunchStore.getState().date,
  integrations: [founderLinkedIn, companyLinkedIn, disabledX],
  reopenModal: jest.fn(),
  mutate: mockMutate,
  standaloneCreate: true,
};

const renderGuidedManageModal = () =>
  render(
    <GuidedComposerPublishBridgeProvider>
      <ManageModal {...manageModalProps} guidedComposerActive />
      <GuidedComposerPublish />
    </GuidedComposerPublishBridgeProvider>
  );

const postPayload = () => {
  const call = mockFetch.mock.calls.find(
    ([url, options]) => url === '/posts' && options?.method === 'POST'
  );
  return call ? JSON.parse(call[1].body) : undefined;
};

describe('ManageModal guided publishing bridge', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockCheckAllValid.mockReset();
    mockShow.mockReset();
    mockCloseAll.mockReset();
    mockMutate.mockReset();
    seedStores();
    mockFetch.mockImplementation(async (url: string, options?: RequestInit) => {
      if (url === '/posts/should-shortlink') {
        return { ok: true, json: async () => ({ ask: true }) };
      }
      if (url === '/posts' && options?.method === 'POST') {
        const payload = JSON.parse(options.body as string);
        return {
          ok: true,
          json: async () =>
            payload.posts.map((post: any) => ({
              postId: `post-${post.integration.id}`,
              integration: post.integration.id,
            })),
        };
      }
      if (url.startsWith('/posts/post-')) {
        const postId = url.slice('/posts/'.length);
        return {
          ok: true,
          json: async () => ({ posts: [{ id: postId, state: 'PUBLISHED' }] }),
        };
      }
      throw new Error(`Unexpected request: ${url}`);
    });
  });

  it('submits enabled destinations with independent Review captions and preserved provider data', async () => {
    renderGuidedManageModal();
    fireEvent.click(await screen.findByRole('button', { name: 'Publish now' }));

    await waitFor(() => expect(postPayload()).toBeTruthy());
    expect(mockCheckAllValid).toHaveBeenCalledWith([
      founderLinkedIn.id,
      companyLinkedIn.id,
    ]);

    const payload = postPayload();
    expect(payload).toMatchObject({
      type: 'now',
      shortLink: true,
      posts: [
        {
          integration: { id: founderLinkedIn.id },
          settings: { __type: 'linkedin', visibility: 'PUBLIC' },
          value: [
            {
              content: 'Edited founder caption.',
              image: media,
            },
            { content: `Provider comment for ${founderLinkedIn.id}` },
          ],
        },
        {
          integration: { id: companyLinkedIn.id },
          settings: {
            __type: 'linkedin-page',
            organization: 'company-1',
          },
          value: [
            {
              content: 'Edited company caption.',
              image: media,
            },
            { content: `Provider comment for ${companyLinkedIn.id}` },
          ],
        },
      ],
    });
    expect(payload.posts).toHaveLength(2);
    expect(providerResults[0].values[0].content).toBe(
      `Provider caption for ${founderLinkedIn.id}`
    );
    expect(mockCloseAll).not.toHaveBeenCalled();
    expect(mockMutate).toHaveBeenCalledTimes(1);
    expect(
      await screen.findByText(
        'Publishing was confirmed for every enabled destination.'
      )
    ).toBeTruthy();
  });

  it('uses the existing schedule type and UTC date', async () => {
    const scheduledDate = useLaunchStore
      .getState()
      .date.year(2035)
      .month(3)
      .date(12)
      .hour(16)
      .minute(45)
      .second(0);
    useLaunchStore.getState().setDate(scheduledDate);
    let resolvePreflight: ((response: any) => void) | undefined;
    const pendingPreflight = new Promise<any>((resolve) => {
      resolvePreflight = resolve;
    });
    mockFetch.mockImplementation(async (url: string, options?: RequestInit) => {
      if (url === '/posts/should-shortlink') {
        return pendingPreflight;
      }
      if (url === '/posts' && options?.method === 'POST') {
        const payload = JSON.parse(options.body as string);
        return {
          ok: true,
          json: async () =>
            payload.posts.map((post: any) => ({
              postId: `scheduled-${post.integration.id}`,
              integration: post.integration.id,
            })),
        };
      }
      if (url.startsWith('/posts/scheduled-')) {
        return {
          ok: true,
          json: async () => ({ posts: [{ state: 'QUEUE' }] }),
        };
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    renderGuidedManageModal();
    fireEvent.click(screen.getByRole('radio', { name: /Schedule/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Schedule post' }));

    await waitFor(() =>
      expect(
        mockFetch.mock.calls.some(
          ([url]) => url === '/posts/should-shortlink'
        )
      ).toBe(true)
    );
    const changedDate = scheduledDate.add(1, 'day');
    act(() => {
      useLaunchStore.getState().setDate(changedDate);
    });
    await act(async () => {
      resolvePreflight?.({ ok: true, json: async () => ({ ask: false }) });
    });

    await waitFor(() => expect(postPayload()).toBeTruthy());
    expect(postPayload()).toMatchObject({
      type: 'schedule',
      date: scheduledDate.utc().format('YYYY-MM-DDTHH:mm:ss'),
    });
    expect(useLaunchStore.getState().date.valueOf()).toBe(changedDate.valueOf());
    expect(
      await screen.findByText('The enabled destinations are scheduled.')
    ).toBeTruthy();
  });

  it('keeps retry available when the captured schedule expires during preflight', async () => {
    const scheduledDate = useLaunchStore
      .getState()
      .date.year(2035)
      .month(3)
      .date(12)
      .hour(16)
      .minute(45)
      .second(0);
    let now = scheduledDate.valueOf() - 10_000;
    const nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => now);
    useLaunchStore.getState().setDate(scheduledDate);
    let resolvePreflight: ((response: any) => void) | undefined;
    const pendingPreflight = new Promise<any>((resolve) => {
      resolvePreflight = resolve;
    });
    mockFetch.mockImplementation(async (url: string) => {
      if (url === '/posts/should-shortlink') {
        return pendingPreflight;
      }
      if (url === '/posts') {
        throw new Error('The post request must not be attempted.');
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    try {
      renderGuidedManageModal();
      fireEvent.click(screen.getByRole('radio', { name: /Schedule/ }));
      fireEvent.click(screen.getByRole('button', { name: 'Schedule post' }));

      await waitFor(() =>
        expect(
          mockFetch.mock.calls.some(
            ([url]) => url === '/posts/should-shortlink'
          )
        ).toBe(true)
      );
      now = scheduledDate.startOf('second').valueOf();
      await act(async () => {
        resolvePreflight?.({ ok: true, json: async () => ({ ask: false }) });
      });

      expect(postPayload()).toBeUndefined();
      expect(
        await screen.findAllByText(
          'Choose a scheduled time that is in the future.'
        )
      ).not.toHaveLength(0);
      expect(
        screen.getByRole('button', { name: 'Prepare retry' })
      ).toBeTruthy();
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('routes guided provider validation failures to the existing settings form and retries with corrected values', async () => {
    providerResults[0] = providerResult(
      founderLinkedIn,
      { __type: 'linkedin' },
      false
    );
    providerResults[0].fix = jest.fn(() =>
      useLaunchStore.getState().setCurrent(founderLinkedIn.id)
    );
    act(() => {
      useGuidedComposerStore
        .getState()
        .setReviewDestinationEnabled(companyLinkedIn.id, false);
    });
    useGuidedComposerStore.getState().setComposerStep('publish');
    renderGuidedManageModal();
    fireEvent.click(await screen.findByRole('button', { name: 'Publish now' }));

    expect((await screen.findByRole('alert')).textContent).toContain(
      'Please fix your settings'
    );
    expect(
      mockFetch.mock.calls.some(
        ([url, options]) => url === '/posts' && options?.method === 'POST'
      )
    ).toBe(false);
    expect(providerResults[0].fix).toHaveBeenCalledTimes(1);
    expect(useLaunchStore.getState().current).toBe(founderLinkedIn.id);
    expect(useGuidedComposerStore.getState().composerStep).toBe('upload');
    expect(
      screen
        .getByText('Advanced settings')
        .closest('section')
        ?.getAttribute('data-guided-composer-section')
    ).toBe('settings');
    expect(
      document
        .querySelector('#social-settings')
        ?.parentElement?.className.includes('hidden')
    ).toBe(false);
    expect(
      useGuidedComposerStore.getState().reviewDrafts[founderLinkedIn.id].caption
    ).toBe('Edited founder caption.');

    providerResults[0] = {
      ...providerResults[0],
      valid: true,
      settings: {
        __type: 'linkedin',
        visibility: 'CONNECTIONS',
      },
    };
    act(() => {
      useGuidedComposerStore
        .getState()
        .setReviewDestinationEnabled(companyLinkedIn.id, true);
    });

    fireEvent.click(
      await screen.findByRole('button', { name: 'Prepare retry' })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Publish now' }));

    await waitFor(() => expect(postPayload()).toBeTruthy());
    expect(mockCheckAllValid).toHaveBeenNthCalledWith(1, [
      founderLinkedIn.id,
    ]);
    expect(mockCheckAllValid).toHaveBeenNthCalledWith(2, [
      founderLinkedIn.id,
      companyLinkedIn.id,
    ]);
    expect(postPayload().posts).toHaveLength(2);
    expect(postPayload().posts[0]).toMatchObject({
      integration: { id: founderLinkedIn.id },
      settings: {
        __type: 'linkedin',
        visibility: 'CONNECTIONS',
      },
    });
    expect(postPayload().posts[0].value[0].content).toBe(
      'Edited founder caption.'
    );
    expect(
      mockFetch.mock.calls.filter(
        ([url, options]) => url === '/posts' && options?.method === 'POST'
      )
    ).toHaveLength(1);
  });

  it.each<[
    string,
    () => Promise<any>
  ]>([
    [
      'a rejected request',
      () => Promise.reject(new Error('Shortlink service unavailable.')),
    ],
    [
      'a non-2xx response',
      () =>
        Promise.resolve({
          ok: false,
          json: async () => ({ ask: false }),
        }),
    ],
    [
      'invalid JSON',
      () =>
        Promise.resolve({
          ok: true,
          json: async () => {
            throw new SyntaxError('Invalid JSON.');
          },
        }),
    ],
    [
      'a malformed response',
      () =>
        Promise.resolve({
          ok: true,
          json: async () => ({ ask: 'yes' }),
        }),
    ],
  ])(
    'allows a safe retry when shortlink preflight returns %s',
    async (_label, firstPreflight) => {
      let preflightAttempts = 0;
      mockFetch.mockImplementation(
        async (url: string, options?: RequestInit) => {
          if (url === '/posts/should-shortlink') {
            preflightAttempts += 1;
            if (preflightAttempts === 1) {
              return firstPreflight();
            }
            return { ok: true, json: async () => ({ ask: false }) };
          }
          if (url === '/posts' && options?.method === 'POST') {
            const payload = JSON.parse(options.body as string);
            return {
              ok: true,
              json: async () =>
                payload.posts.map((post: any) => ({
                  postId: `post-${post.integration.id}`,
                  integration: post.integration.id,
                })),
            };
          }
          if (url.startsWith('/posts/post-')) {
            const postId = url.slice('/posts/'.length);
            return {
              ok: true,
              json: async () => ({
                posts: [{ id: postId, state: 'PUBLISHED' }],
              }),
            };
          }
          throw new Error(`Unexpected request: ${url}`);
        }
      );

      renderGuidedManageModal();
      fireEvent.click(
        await screen.findByRole('button', { name: 'Publish now' })
      );

      expect((await screen.findByRole('alert')).textContent).toContain(
        'The shortlink check could not be completed. Please try again.'
      );
      expect(postPayload()).toBeUndefined();
      fireEvent.click(screen.getByRole('button', { name: 'Prepare retry' }));
      fireEvent.click(screen.getByRole('button', { name: 'Publish now' }));

      await waitFor(() => expect(postPayload()).toBeTruthy());
      expect(preflightAttempts).toBe(2);
      expect(
        mockFetch.mock.calls.filter(
          ([url, options]) => url === '/posts' && options?.method === 'POST'
        )
      ).toHaveLength(1);
    }
  );

  it('treats every guided non-2xx post response as ambiguous and locks retry', async () => {
    mockFetch.mockImplementation(async (url: string, options?: RequestInit) => {
      if (url === '/posts/should-shortlink') {
        return { ok: true, json: async () => ({ ask: false }) };
      }
      if (url === '/posts' && options?.method === 'POST') {
        return {
          ok: false,
          text: async () => JSON.stringify({ message: 'Backend failed.' }),
        };
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    renderGuidedManageModal();
    fireEvent.click(await screen.findByRole('button', { name: 'Publish now' }));

    expect(await screen.findAllByText('Backend failed.')).toHaveLength(3);
    expect(
      screen.getByText(
        'Check the calendar and connected accounts before retrying to avoid a duplicate post.'
      )
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Prepare retry' })).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Publish now' }).hasAttribute('disabled')
    ).toBe(true);
    expect(
      useGuidedComposerStore.getState().reviewDrafts[founderLinkedIn.id].caption
    ).toBe('Edited founder caption.');
  });

  it('keeps normal composer publishing unscoped and unchanged', async () => {
    render(<ManageModal {...manageModalProps} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Post Now' }));

    await waitFor(() => expect(postPayload()).toBeTruthy());
    expect(mockCheckAllValid).toHaveBeenCalledWith(undefined);
    expect(postPayload().posts).toHaveLength(3);
    expect(postPayload().posts[0].value[0].content).toBe(
      `Provider caption for ${founderLinkedIn.id}`
    );
    expect(mockCloseAll).toHaveBeenCalledTimes(1);
    expect(mockShow).toHaveBeenCalledWith('Added successfully');
  });
});
