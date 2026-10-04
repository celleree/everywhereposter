import React, { createRef } from 'react';
import { ReactSortable } from 'react-sortablejs';
import { act, render, waitFor } from '@testing-library/react';

jest.mock(
  '@gitroom/frontend/components/launches/general.preview.component',
  () => ({
    GeneralPreviewComponent: () => null,
  })
);

jest.mock(
  '@gitroom/frontend/components/launches/helpers/use.integration',
  () => {
    const ReactModule = require('react');

    return {
      IntegrationContext: ReactModule.createContext({}),
    };
  }
);

jest.mock(
  '@gitroom/react/translation/get.transation.service.client',
  () => ({
    useT: () => (_key: string, fallback: string) => fallback,
  })
);

jest.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () =>
    jest.fn(async () => ({
      json: async () => ({ internalPlugs: [] }),
    })),
}));

jest.mock('swr', () => ({
  __esModule: true,
  default: () => ({
    data: { internalPlugs: [] },
    isLoading: false,
  }),
}));

jest.mock('@gitroom/frontend/components/launches/internal.channels', () => ({
  InternalChannels: () => null,
}));

jest.mock('@gitroom/react/helpers/safe.image', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('react-dom', () => {
  const actual = jest.requireActual('react-dom');

  return {
    ...actual,
    createPortal: (node: React.ReactNode) => node,
  };
});

jest.mock('@gitroom/frontend/components/layout/set.timezone', () => ({
  newDayjs: () => require('dayjs')('2026-08-04T12:00:00Z'),
}));

import { getInternalPostValues, useLaunchStore } from '../../apps/frontend/src/components/new-launch/store';
import {
  PostComment,
  withProvider,
} from '../../apps/frontend/src/components/new-launch/providers/high.order.provider';

const initialIntegration = {
  id: 'instagram-account',
  name: 'Founder Instagram',
  identifier: 'instagram',
  display: '@founder',
  picture: '',
  disabled: false,
  inBetweenSteps: false,
  editor: 'normal',
  type: 'social',
  changeProfilePicture: false,
  additionalSettings: JSON.stringify([
    { maximumCharacters: 100, configuration: 'old' },
  ]),
  changeNickName: false,
  time: [],
} as any;

const refreshedIntegration = {
  ...initialIntegration,
  name: 'Reconnected Instagram',
  identifier: 'instagram-standalone',
  editor: 'html',
  additionalSettings: JSON.stringify([
    { maximumCharacters: 280, configuration: 'new' },
  ]),
} as any;

const checkValidity = jest.fn(async () => true);
const maximumCharacters = (settings: any[]) =>
  settings[0]?.maximumCharacters || 0;

const TestProvider = withProvider({
  postComment: PostComment.POST,
  minimumCharacters: [],
  SettingsComponent: null,
  maximumCharacters,
  checkValidity,
});

describe('provider metadata refresh', () => {
  beforeEach(() => {
    checkValidity.mockClear();
    useLaunchStore.getState().reset();
  });

  it('refreshes the mounted provider handle when same-ID account metadata changes', async () => {
    const providerRef = createRef<any>();
    const settings = { post_type: 'reel' };

    act(() => {
      useLaunchStore.setState({
        integrations: [initialIntegration],
        selectedIntegrations: [
          {
            integration: initialIntegration,
            settings,
            ref: providerRef,
          },
        ],
        global: [
          {
            id: 'post-1',
            content: 'A caption',
            delay: 0,
            media: [],
          },
        ],
        current: initialIntegration.id,
      });
    });

    render(<TestProvider id={initialIntegration.id} ref={providerRef} />);

    await waitFor(() => {
      expect(providerRef.current).toBeTruthy();
      expect(useLaunchStore.getState().chars[initialIntegration.id]).toBe(100);
    });

    const initialResult = await providerRef.current.isValid();
    expect(initialResult.identifier).toBe('instagram');
    expect(initialResult.integration).toBe(initialIntegration);
    expect(initialResult.maximumCharacters).toBe(100);

    act(() => {
      useLaunchStore.setState((state) => ({
        integrations: [refreshedIntegration],
        selectedIntegrations: state.selectedIntegrations.map((selected) =>
          selected.integration.id === refreshedIntegration.id
            ? { ...selected, integration: refreshedIntegration }
            : selected
        ),
      }));
    });

    await waitFor(() => {
      expect(useLaunchStore.getState().editor).toBe('html');
      expect(useLaunchStore.getState().chars[refreshedIntegration.id]).toBe(280);
    });

    const refreshedResult = await providerRef.current.isValid();
    expect(refreshedResult.identifier).toBe('instagram-standalone');
    expect(refreshedResult.integration).toBe(refreshedIntegration);
    expect(refreshedResult.maximumCharacters).toBe(280);
    expect(providerRef.current.getValues().identifier).toBe(
      'instagram-standalone'
    );

    expect(checkValidity).toHaveBeenLastCalledWith(
      [[]],
      settings,
      [{ maximumCharacters: 280, configuration: 'new' }]
    );
    expect(useLaunchStore.getState().selectedIntegrations[0].settings).toBe(
      settings
    );
    expect(useLaunchStore.getState().selectedIntegrations[0].ref).toBe(
      providerRef
    );
  });

  it.each(['append', 'add', 'remove', 'reorder'])('materializes inherited shared media for intentional root %s while comment media stays independent', async (action) => {
    const a = { id: 'a', path: '/a.png' };
    const b = { id: 'b', path: '/b.png' };
    const custom = { id: 'custom', path: '/custom.png' };
    const commentMedia = { id: 'comment-media', path: '/comment.png' };
    const ref = createRef<any>();
    act(() => {
      useLaunchStore.getState().setAllIntegrations([initialIntegration]);
      useLaunchStore.getState().setSelectedIntegrations([{ selectedIntegrations: initialIntegration, settings: {} }]);
      useLaunchStore.getState().addGlobalValue(0, [{ id: 'root', content: 'Root', delay: 0, media: [a, b] }]);
      useLaunchStore.getState().addRemoveInternal(initialIntegration.id, true);
      useLaunchStore.getState().addInternalValue(0, initialIntegration.id, [{ id: 'comment', content: 'Comment', delay: 0, media: [] }]);
      useLaunchStore.getState().setInternalValueMedia(initialIntegration.id, 1, [commentMedia]);
    });
    render(<TestProvider id={initialIntegration.id} ref={ref} />);
    expect(useLaunchStore.getState().internal[0].inheritRootMedia).toBe(true);
    expect(ref.current.getValues().values[0].media).toEqual([a, b]);
    act(() => {
      if (action === 'append') useLaunchStore.getState().appendInternalValueMedia(initialIntegration.id, 0, [custom]);
      if (action === 'add') useLaunchStore.getState().addInternalValueMedia(initialIntegration.id, 0, [custom]);
      if (action === 'remove') useLaunchStore.getState().removeInternalValueMedia(initialIntegration.id, 0, 0);
      if (action === 'reorder') useLaunchStore.getState().setInternalValueMedia(initialIntegration.id, 0, [b, a]);
      useLaunchStore.getState().setGlobalValueMedia(0, []);
    });
    expect(useLaunchStore.getState().internal[0].inheritRootMedia).toBe(false);
    expect(ref.current.getValues().values[0].media).toEqual(action === 'remove' ? [b] : action === 'reorder' ? [b, a] : [a, b, custom]);
    expect(ref.current.getValues().values[1].media).toEqual([commentMedia]);
  });

  it.each([false, true])('keeps media inherited through the actual sorter mount with empty source %s, then follows shared replacement', (empty) => {
    const a = { id: 'a', path: '/a.png', alt: 'Source' };
    const b = { id: 'b', path: '/b.png' };
    const ref = createRef<any>();
    act(() => {
      useLaunchStore.getState().setAllIntegrations([initialIntegration]);
      useLaunchStore.getState().setSelectedIntegrations([{ selectedIntegrations: initialIntegration, settings: {} }]);
      useLaunchStore.getState().addGlobalValue(0, [{ id: 'root', content: 'Root', delay: 0, media: empty ? [] : [a] }]);
      useLaunchStore.getState().addRemoveInternal(initialIntegration.id, true);
      useLaunchStore.getState().addInternalValue(0, initialIntegration.id, [{ id: 'comment', content: 'Keep comment', delay: 0, media: [] }]);
    });
    const inherited = useLaunchStore.getState().internal[0];
    const normalize = jest.fn((media) => useLaunchStore.getState().setInternalValueMedia(initialIntegration.id, 0, media));
    render(<><ReactSortable list={empty ? [] : [a]} setList={normalize}><div data-id="a">A</div></ReactSortable><TestProvider id={initialIntegration.id} ref={ref} /></>);
    expect(normalize.mock.calls[0][0]).toEqual(empty ? [] : [expect.objectContaining({ id: 'a', chosen: false, selected: false })]);
    expect(useLaunchStore.getState().internal[0]).toBe(inherited);
    act(() => useLaunchStore.getState().setGlobalValueMedia(0, [b]));
    expect(ref.current.getValues().values[0].media).toEqual([b]);
    expect(ref.current.getValues().values[1].content).toBe('Keep comment');
    act(() => useLaunchStore.getState().setInternalValueMedia(initialIntegration.id, 0, [{ ...b, alt: 'Intentional platform alt' }] as any));
    expect(useLaunchStore.getState().internal[0].inheritRootMedia).toBe(false);
    act(() => useLaunchStore.getState().setGlobalValueMedia(0, []));
    expect(ref.current.getValues().values[0].media).toEqual([{ ...b, alt: 'Intentional platform alt' }]);
  });

  it.each([true, false])('handles full replacement with explicit root-media intent %s', (replaceRootMedia) => {
    const shared = { id: 'shared', path: '/shared.png' };
    const replacement = { id: 'generated', path: '/generated.png' };
    const newerShared = { id: 'newer-shared', path: '/newer-shared.png' };
    const ref = createRef<any>();
    act(() => {
      useLaunchStore.getState().setAllIntegrations([initialIntegration]);
      useLaunchStore.getState().setSelectedIntegrations([{ selectedIntegrations: initialIntegration, settings: {} }]);
      useLaunchStore.getState().addGlobalValue(0, [{ id: 'root', content: 'Root', delay: 0, media: [shared] }]);
      useLaunchStore.getState().addRemoveInternal(initialIntegration.id, true);
      useLaunchStore.getState().addInternalValue(0, initialIntegration.id, [{ id: 'comment', content: 'Keep comment', delay: 0, media: [] }]);
    });
    render(<TestProvider id={initialIntegration.id} ref={ref} />);
    act(() => {
      const values = useLaunchStore.getState().internal[0].integrationValue;
      useLaunchStore.getState().setInternalValue(initialIntegration.id, values.map((value, index) => index === 0 ? { ...value, content: 'Generated caption', media: replaceRootMedia ? [replacement] : value.media } : value), replaceRootMedia);
      useLaunchStore.getState().setGlobalValueMedia(0, [newerShared]);
    });
    expect(useLaunchStore.getState().internal[0].inheritRootMedia).toBe(!replaceRootMedia);
    expect(ref.current.getValues().values[0].media).toEqual(replaceRootMedia ? [replacement] : [newerShared]);
    expect(ref.current.getValues().values[1].content).toBe('Keep comment');
  });

  it('preserves legacy internal media when no inheritance marker exists', () => {
    const legacy = { id: 'legacy', path: '/legacy.png' };
    const ref = createRef<any>();
    act(() => useLaunchStore.setState({
      integrations: [initialIntegration], selectedIntegrations: [{ integration: initialIntegration, settings: {} }],
      global: [{ id: 'root', content: 'Current shared', delay: 0, media: [] }],
      internal: [{ integration: initialIntegration, integrationValue: [{ id: 'saved', content: 'Saved platform', delay: 0, media: [legacy] }] }],
    }));
    render(<TestProvider id={initialIntegration.id} ref={ref} />);
    expect(ref.current.getValues().values[0].media).toEqual([legacy]);
    act(() => useLaunchStore.getState().setGlobalValueMedia(0, [{ id: 'new', path: '/new.png' }]));
    expect(ref.current.getValues().values[0].media).toEqual([legacy]);
  });

  it('materializes inherited root media before a legacy row reorder', () => {
    const shared = { id: 'shared', path: '/shared.png' };
    const commentMedia = { id: 'comment', path: '/comment.png' };
    const ref = createRef<any>();
    act(() => {
      useLaunchStore.getState().setAllIntegrations([initialIntegration]);
      useLaunchStore.getState().setSelectedIntegrations([{ selectedIntegrations: initialIntegration, settings: {} }]);
      useLaunchStore.getState().addGlobalValue(0, [{ id: 'root', content: 'Root', delay: 0, media: [shared] }]);
      useLaunchStore.getState().addRemoveInternal(initialIntegration.id, true);
      useLaunchStore.getState().addInternalValue(0, initialIntegration.id, [{ id: 'followup', content: 'Comment', delay: 0, media: [commentMedia] }]);
    });
    render(<TestProvider id={initialIntegration.id} ref={ref} />);
    act(() => {
      useLaunchStore.getState().changeOrderInternal(initialIntegration.id, 0, 'down');
      useLaunchStore.getState().setGlobalValueMedia(0, []);
    });
    expect(ref.current.getValues().values.map((value: any) => value.media)).toEqual([[commentMedia], [shared]]);
  });

});
