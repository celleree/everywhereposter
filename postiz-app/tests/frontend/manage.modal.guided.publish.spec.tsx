import React, { createRef } from 'react';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

let mockUseActualEditor = false;
const mockFetch = jest.fn();
const mockCheckAllValid = jest.fn();
const mockShow = jest.fn();
const mockCloseAll = jest.fn();
const mockMutate = jest.fn();
const mockOpenFiles = jest.fn();
const mockOpenModal = jest.fn();

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
  useDecisionModal: () => ({ open: jest.fn() }),
  useModals: () => ({
    openModal: mockOpenModal,
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
  EditorWrapper: (props: any) => mockUseActualEditor ? React.createElement(jest.requireActual('@gitroom/frontend/components/new-launch/editor').EditorWrapper, props) : null,
}));
jest.mock('@gitroom/frontend/components/new-launch/select.current', () => ({
  SelectCurrent: () => mockUseActualEditor ? React.createElement(jest.requireActual('@gitroom/frontend/components/new-launch/select.current').SelectCurrent) : null,
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
  MultiMediaComponent: () => null,
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
    open: mockOpenFiles,
  }),
}));
jest.mock('@uppy/react', () => ({ Dashboard: () => null }));
jest.mock('@copilotkit/react-core', () => ({ useCopilotReadable: jest.fn(), useCopilotAction: jest.fn() }));
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
  ChevronUpIcon: () => null,
  ResetIcon: () => null,
  EmojiIcon: () => null,
  ConnectionLineIcon: () => null,
  LockIcon: () => null,
  GlobalIcon: () => null,
  SettingsIcon: () => null,
  ChevronDownIcon: () => null,
  CloseIcon: () => null,
  TrashIcon: () => null,
  DropdownArrowSmallIcon: () => null,
}));
jest.mock(
  '@gitroom/frontend/components/new-launch/providers/high.order.provider',
  () => ({ PostComment: { ALL: 0, POST: 1, COMMENT: 2 } })
);

jest.mock('@gitroom/frontend/components/launches/general.preview.component', () => ({ GeneralPreviewComponent: () => null }));
jest.mock('@gitroom/frontend/components/launches/helpers/use.integration', () => ({ IntegrationContext: require('react').createContext({}) }));
jest.mock('@gitroom/frontend/components/launches/internal.channels', () => ({ InternalChannels: () => null }));
jest.mock('@gitroom/react/helpers/safe.image', () => ({ __esModule: true, default: () => null }));
jest.mock('swr', () => ({ __esModule: true, default: () => ({ data: { internalPlugs: [] }, isLoading: false }) }));

jest.mock('@gitroom/frontend/components/signature', () => ({ SignatureBox: () => null }));
jest.mock('@gitroom/frontend/components/new-launch/delay.component', () => ({ DelayComponent: () => null }));
jest.mock('@tiptap/react', () => ({
  ...jest.requireActual('@tiptap/react'),
  useEditor: (options: any) => ({ ...options, getHTML: () => options.content }),
  EditorContent: ({ editor }: any) => <textarea aria-label="Platform comment or post" value={editor.content} onChange={(event) => editor.onUpdate({ editor: { getHTML: () => event.target.value } })} />,
}));

import { GuidedComposerReview } from '../../apps/frontend/src/components/new-launch/guided.composer.review';
import { GuidedComposerShell } from '../../apps/frontend/src/components/new-launch/guided.composer.shell';
import { ManageModal } from '../../apps/frontend/src/components/new-launch/manage.modal';
import {
  GuidedComposerPublish,
  GuidedComposerPublishBridgeProvider,
} from '../../apps/frontend/src/components/new-launch/guided.composer.publish';
import { useGuidedComposerStore } from '../../apps/frontend/src/components/new-launch/guided.composer.store';
import { useLaunchStore } from '../../apps/frontend/src/components/new-launch/store';

const actualProviderModule = jest.requireActual('../../apps/frontend/src/components/new-launch/providers/high.order.provider');
const MediaPayloadProvider = actualProviderModule.withProvider({
  postComment: actualProviderModule.PostComment.ALL,
  comments: true,
  minimumCharacters: [],
  SettingsComponent: null,
  maximumCharacters: 3000,
});

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
  afterEach(() => document.querySelectorAll('style[data-test-mobile-recovery]').forEach((style) => style.remove()));
  beforeEach(() => {
    mockUseActualEditor = false;
    HTMLElement.prototype.scrollTo = jest.fn();
    mockFetch.mockReset();
    mockCheckAllValid.mockReset();
    mockShow.mockReset();
    mockCloseAll.mockReset();
    mockMutate.mockReset();
    mockOpenFiles.mockReset();
    mockOpenModal.mockReset();
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

  it('removes a guided video from media intent while preserving images', () => {
    const image = {
      id: 'image-1',
      path: 'https://media.example.com/image.png',
      type: 'image',
    } as any;
    useLaunchStore.getState().setGlobalValueMedia(0, [...media, image]);

    const guidedView = renderGuidedManageModal();

    const removeVideo = screen.getByRole('button', { name: 'Remove video' });
    expect(removeVideo.getAttribute('type')).toBe('button');
    expect(removeVideo.className).toContain('h-[36px]');
    expect(removeVideo.className).toContain('w-[36px]');

    fireEvent.click(removeVideo);

    expect(useLaunchStore.getState().global[0].media).toEqual([image]);

    guidedView.unmount();
    useLaunchStore.getState().setGlobalValueMedia(0, [...media, image]);
    render(<ManageModal {...manageModalProps} />);
    expect(screen.queryByRole('button', { name: 'Remove video' })).toBeNull();
  });

  it.each([
    ['photo', { id: 'image-1', path: '/image.png' }, 'Remove image'],
    ['video', { id: 'video-1', path: '/video.mp4' }, 'Remove video'],
  ])(
    'detaches the final %s with the shell mounted and keeps add controls usable',
    async (_kind, attachment, label) => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          mediaId: attachment.id,
          status: 'READY',
          text: null,
        }),
      });
      useLaunchStore.getState().setGlobalValueMedia(0, [attachment]);
      render(
        <GuidedComposerShell>
          <ManageModal {...manageModalProps} guidedComposerActive />
        </GuidedComposerShell>
      );
      fireEvent.click(screen.getByRole('button', { name: label }));
      await waitFor(() =>
        expect(useLaunchStore.getState().global[0].media).toEqual([])
      );
      const choose = screen.getByRole('button', { name: 'Choose files' });
      const library = screen.getByRole('button', { name: 'Media Library' });
      expect(getComputedStyle(choose).display).not.toBe('none');
      expect((choose as HTMLButtonElement).disabled).toBe(false);
      expect(getComputedStyle(library).display).not.toBe('none');
      expect((library as HTMLButtonElement).disabled).toBe(false);
      fireEvent.click(choose);
      fireEvent.click(library);
      expect(mockOpenFiles).toHaveBeenCalled();
      expect(mockOpenModal).toHaveBeenCalled();
      expect(
        mockFetch.mock.calls.some(([, options]) => options?.method === 'DELETE')
      ).toBe(false);
    }
  );

  it('detaches a photo while preserving the shared video and platform-specific attachments', () => {
    const image = { id: 'image-1', path: '/image.png' };
    useLaunchStore.getState().setGlobalValueMedia(0, [image, ...media]);
    useLaunchStore
      .getState()
      .addInternalValue(0, founderLinkedIn.id, [
        {
          id: 'platform-post',
          content: 'Platform caption',
          delay: 0,
          media: [image],
        },
      ]);
    const platformState = useLaunchStore.getState().internal;
    renderGuidedManageModal();
    fireEvent.click(screen.getByRole('button', { name: 'Remove image' }));
    expect(useLaunchStore.getState().global[0].media).toEqual(media);
    expect(useLaunchStore.getState().internal).toEqual(platformState);
    expect(
      mockFetch.mock.calls.some(([, options]) => options?.method === 'DELETE')
    ).toBe(false);
  });

  it('uses current attachment state when an older remove handler runs', () => {
    renderGuidedManageModal();
    const remove = screen.getByRole('button', { name: 'Remove video' });
    const image = { id: 'image-later', path: '/later.png' };
    act(() => {
      useLaunchStore.getState().appendGlobalValueMedia(0, [image]);
      fireEvent.click(remove);
    });
    expect(useLaunchStore.getState().global[0].media).toEqual([image]);
  });

  it('renders exactly Add Caption without a numeric badge in the editor section', () => {
    const { container } = renderGuidedManageModal();
    const section = container.querySelector(
      '[data-guided-composer-section="editor"]'
    )!;
    expect(section.firstElementChild!.children).toHaveLength(1);
    expect(screen.getByText('Add Caption', { exact: true })).toBeTruthy();
    expect(screen.queryByText('Review and edit', { exact: true })).toBeNull();
  });

  it('removes four videos right to left without restoring attachments or hiding upload controls', async () => {
    const attachments = Array.from({ length: 4 }, (_, index) => ({
      id: `video-${index + 1}`,
      path: `/video-${index + 1}.mp4`,
    }));
    mockFetch.mockImplementation(async (url: string) => ({
      ok: true,
      json: async () => ({
        mediaId: url.split('/')[2],
        status: 'READY',
        text: null,
      }),
    }));
    useLaunchStore.getState().setGlobalValueMedia(0, attachments);
    render(
      <GuidedComposerShell>
        <ManageModal {...manageModalProps} guidedComposerActive />
      </GuidedComposerShell>
    );
    for (let count = 4; count > 0; count--) {
      fireEvent.click(
        screen.getAllByRole('button', { name: 'Remove video' })[count - 1]
      );
      await waitFor(() =>
        expect(useLaunchStore.getState().global[0].media).toEqual(
          attachments.slice(0, count - 1)
        )
      );
      expect(
        (
          screen.getByRole('button', {
            name: 'Choose files',
          }) as HTMLButtonElement
        ).disabled
      ).toBe(false);
    }
    expect(screen.queryByRole('button', { name: 'Remove video' })).toBeNull();
    expect(
      mockFetch.mock.calls.some(([, options]) => options?.method === 'DELETE')
    ).toBe(false);
  });

  it('keeps Guided Review captions authoritative while real comment rows are created, edited and submitted', async () => {
    mockUseActualEditor = true;
    useLaunchStore.getState().setSelectedIntegrations(
      [founderLinkedIn, companyLinkedIn].map((integration) => ({ selectedIntegrations: integration, settings: {} }))
    );
    useLaunchStore.getState().setGlobalValueMedia(0, []);
    useLaunchStore.getState().setEditor('none');
    useGuidedComposerStore.getState().setComposerStep('review');
    mockCheckAllValid.mockImplementation(async (ids: string[]) => ids.map((id) => {
      const state = useLaunchStore.getState();
      const integration = state.integrations.find((item) => item.id === id);
      return { ...providerResult(integration, {}), values: state.internal.find((item) => item.integration.id === id)?.integrationValue || state.global };
    }));
    const { container } = render(
      <GuidedComposerShell><ManageModal {...manageModalProps} guidedComposerActive /></GuidedComposerShell>
    );
    const root = screen.getByLabelText('Founder LinkedIn caption');
    fireEvent.change(root, { target: { value: 'Manually refined founder caption' } });
    const editorSection = container.querySelector('[data-guided-composer-section="editor"]') as HTMLElement;
    // No legacy root field is mounted at all, including an offscreen one.
    expect(within(editorSection).queryByRole('textbox')).toBeNull();
    fireEvent.click(within(editorSection).getByText('Founder LinkedIn', { exact: true }));
    const addComment = within(editorSection).getByRole('button', { name: 'Add platform comment or post' });
    expect(addComment.className).not.toContain('absolute');
    expect(addComment.className).toContain('min-h-[44px]');
    fireEvent.click(addComment);
    const comment = await within(editorSection).findByLabelText('Platform comment or post');
    fireEvent.change(comment, { target: { value: 'First platform comment' } });
    expect((root as HTMLTextAreaElement).value).toBe('Manually refined founder caption');
    const draftBeforeContext = useGuidedComposerStore.getState().reviewDrafts[founderLinkedIn.id];
    fireEvent.change(screen.getByLabelText('Optional context'), { target: { value: 'Target founders and keep this concise' } });
    expect(useGuidedComposerStore.getState().reviewDrafts[founderLinkedIn.id]).toBe(draftBeforeContext);
    expect(useLaunchStore.getState().global[0].content).toBe('Global caption');
    fireEvent.change(root, { target: { value: 'Final founder caption' } });
    expect((comment as HTMLTextAreaElement).value).toBe('First platform comment');
    fireEvent.change(comment, { target: { value: 'Final platform comment' } });
    expect(useGuidedComposerStore.getState().reviewDrafts[founderLinkedIn.id].caption).toBe('Final founder caption');
    expect(within(editorSection).getAllByRole('textbox')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Continue to Publish' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Publish now' }));
    await waitFor(() => expect(postPayload()).toBeTruthy());
    const posts = postPayload().posts;
    expect(posts.find((post: any) => post.integration.id === founderLinkedIn.id).value.map((row: any) => row.content)).toEqual(['Final founder caption', 'Final platform comment']);
    expect(posts.find((post: any) => post.integration.id === companyLinkedIn.id).value).toHaveLength(1);
    expect(posts.find((post: any) => post.integration.id === companyLinkedIn.id).value[0].content).toBe('Global caption');
    expect(JSON.stringify(posts)).not.toContain('Target founders and keep this concise');
  });

  it.each(['replace/reorder', 'remove', 'customize'])('resolves current shared media after a platform comment and preserves %s payload semantics', async (change) => {
    mockUseActualEditor = true;
    const photoA = { id: 'photo-a', path: '/photo-a.png' };
    const photoB = { id: 'photo-b', path: '/photo-b.png' };
    const photoC = { id: 'photo-c', path: '/photo-c.png' };
    const custom = { id: 'platform-photo', path: '/platform.png' };
    useLaunchStore.getState().setSelectedIntegrations([{ selectedIntegrations: founderLinkedIn, settings: {} }]);
    useLaunchStore.getState().setGlobalValueMedia(0, [photoA]);
    useGuidedComposerStore.getState().setComposerStep('review');
    const providerRef = createRef<any>();
    mockCheckAllValid.mockImplementation(async () => [await providerRef.current.isValid()]);
    const { container } = render(<GuidedComposerPublishBridgeProvider>
      <MediaPayloadProvider id={founderLinkedIn.id} ref={providerRef} />
      <GuidedComposerReview />
      <ManageModal {...manageModalProps} guidedComposerActive />
      <GuidedComposerPublish />
    </GuidedComposerPublishBridgeProvider>);
    const editor = container.querySelector('[data-guided-composer-section="editor"]') as HTMLElement;
    fireEvent.click(within(editor).getByText('Founder LinkedIn', { exact: true }));
    fireEvent.click(within(editor).getByRole('button', { name: 'Add platform comment or post' }));
    fireEvent.change(await within(editor).findByLabelText('Platform comment or post'), { target: { value: 'Comment survives media changes' } });
    expect(useLaunchStore.getState().internal[0].inheritRootMedia).toBe(true);
    expect(useLaunchStore.getState().internal[0].integrationValue[0].media).toEqual([]);
    expect(providerRef.current.getValues().values[0].media).toEqual([photoA]);
    act(() => {
      useLaunchStore.getState().setGlobalValueMedia(0, [photoB, photoC]);
      if (change === 'replace/reorder') useLaunchStore.getState().setGlobalValueMedia(0, [photoC, photoB]);
      if (change === 'remove') useLaunchStore.getState().removeGlobalValueMedia(0, 0);
      if (change === 'remove') useLaunchStore.getState().detachGlobalValueMedia(0, photoC.id);
      if (change === 'customize') useLaunchStore.getState().setInternalValueMedia(founderLinkedIn.id, 0, [custom]);
      if (change === 'customize') useLaunchStore.getState().setGlobalValueMedia(0, [photoC]);
    });
    const expected = change === 'remove' ? [] : change === 'customize' ? [custom] : [photoC, photoB];
    expect(providerRef.current.getValues().values[0].media).toEqual(expected);
    expect((await providerRef.current.isValid()).values[0].media).toEqual(expected);
    const caption = 'Reviewed caption for the current media';
    fireEvent.change(screen.getByLabelText('Founder LinkedIn caption'), { target: { value: caption } });
    expect(useGuidedComposerStore.getState().reviewDrafts[founderLinkedIn.id].caption).toBe(caption);
    fireEvent.click(screen.getByRole('button', { name: 'Publish now' }));
    await waitFor(() => expect(postPayload()).toBeTruthy());
    expect(postPayload().posts[0].value[0]).toMatchObject({ content: caption, image: expected });
    expect(postPayload().posts[0].value[1].content).toBe('Comment survives media changes');
    expect(JSON.stringify(postPayload())).not.toContain('photo-a');
    expect(JSON.stringify(postPayload())).not.toContain('inheritRootMedia');
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

  it.each(['settings form', 'media/settings checker'])('routes guided %s validation failures to visible mobile settings and retries with corrected values', async (failure) => {
    providerResults[0] = providerResult(
      founderLinkedIn,
      { __type: 'linkedin' },
      failure !== 'settings form'
    );
    if (failure === 'media/settings checker') providerResults[0].errors = 'Carousel can only be created with 2 or more images and no videos.';
    providerResults[0].preview = jest.fn(() => useLaunchStore.getState().setCurrent(founderLinkedIn.id));
    providerResults[0].fix = jest.fn(() =>
      useLaunchStore.getState().setCurrent(founderLinkedIn.id)
    );
    act(() => {
      useGuidedComposerStore
        .getState()
        .setReviewDestinationEnabled(companyLinkedIn.id, false);
    });
    useGuidedComposerStore.getState().setComposerStep('publish');
    // JSDOM has no viewport media engine: apply the real mobile rules directly.
    const sass = require('sass');
    const postcss = require('postcss');
    const source = readFileSync(resolve(__dirname, '../../apps/frontend/src/app/mobile-ui.scss'), 'utf8');
    const css = postcss.parse(sass.compileString(source + '\n@include styles;').css);
    const mobileStyle = document.createElement('style');
    mobileStyle.dataset.testMobileRecovery = 'true';
    css.walkAtRules('media', (rule: any) => {
      if (rule.params === '(max-width: 1025px)') rule.walkRules((node: any) => { if (node.selector.includes('data-guided-provider-recovery')) mobileStyle.textContent += node.toString(); });
    });
    document.head.appendChild(mobileStyle);
    useLaunchStore.getState().setCurrent(founderLinkedIn.id);
    const view = render(<div className="guided-composer-shell" data-composer-step="upload"><GuidedComposerPublishBridgeProvider><ManageModal {...manageModalProps} guidedComposerActive /><GuidedComposerPublish /></GuidedComposerPublishBridgeProvider></div>);
    const settings = screen.getByText('Advanced settings').closest('section') as HTMLElement;
    expect(getComputedStyle(settings).display).toBe('none');
    fireEvent.click(await screen.findByRole('button', { name: 'Publish now' }));

    expect((await screen.findByRole('alert')).textContent).toContain(
      failure === 'settings form' ? 'Please fix your settings' : 'Carousel can only be created'
    );
    expect(
      mockFetch.mock.calls.some(
        ([url, options]) => url === '/posts' && options?.method === 'POST'
      )
    ).toBe(false);
    expect(failure === 'settings form' ? providerResults[0].fix : providerResults[0].preview).toHaveBeenCalledTimes(1);
    expect(useLaunchStore.getState().current).toBe(founderLinkedIn.id);
    expect(useGuidedComposerStore.getState().composerStep).toBe('upload');
    expect(
      screen
        .getByText('Advanced settings')
        .closest('section')
        ?.getAttribute('data-guided-composer-section')
    ).toBe('settings');
    expect(settings.getAttribute('data-guided-provider-recovery')).toBe('true');
    expect(getComputedStyle(settings).display).not.toBe('none');
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
      errors: true,
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
    mobileStyle.remove();
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
