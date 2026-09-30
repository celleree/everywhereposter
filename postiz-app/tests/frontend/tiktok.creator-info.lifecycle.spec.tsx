import React, { createRef } from 'react';
import {
  act,
  render,
  waitFor,
  cleanup,
  fireEvent,
} from '@testing-library/react';

const mockSnapshots: any[] = [];
let mockMounts = 0;
let mockUnmounts = 0;

jest.mock('@gitroom/frontend/components/launches/helpers/use.values', () => {
  const actual = jest.requireActual(
    '@gitroom/frontend/components/launches/helpers/use.values'
  );
  const ReactModule = require('react');
  return {
    ...actual,
    useSettings: () => {
      const form = actual.useSettings();
      const instance = ReactModule.useRef(Symbol('settings')).current;
      mockSnapshots.push({
        instance,
        setValue: form.setValue,
        getValues: form.getValues,
      });
      ReactModule.useEffect(() => {
        mockMounts++;
        // Bound the broken lifecycle so the regression cannot hang the runner.
        if (mockMounts > 8) throw new Error('Repeated settings remounts');
        return () => {
          mockUnmounts++;
        };
      }, []);
      return form;
    },
  };
});

jest.mock(
  '@gitroom/frontend/components/launches/helpers/use.custom.provider.function',
  () => {
    const actual = jest.requireActual(
      '@gitroom/frontend/components/launches/helpers/use.custom.provider.function'
    );
    return {
      useCustomProviderFunction: () => {
        const result = actual.useCustomProviderFunction();
        const snapshot = mockSnapshots[mockSnapshots.length - 1];
        snapshot.get = result.get;
        snapshot.id =
          require('@gitroom/frontend/components/launches/helpers/use.integration').useIntegration().integration.id;
        snapshot.fetch = jest
          .requireActual('@gitroom/helpers/utils/custom.fetch')
          .useFetch();
        return result;
      },
    };
  }
);

jest.mock(
  '@gitroom/frontend/components/launches/general.preview.component',
  () => ({ GeneralPreviewComponent: () => null })
);

jest.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}));

jest.mock('swr', () => ({
  __esModule: true,
  default: () => ({ data: { internalPlugs: [] }, isLoading: false }),
}));

jest.mock('@gitroom/frontend/components/launches/internal.channels', () => ({
  InternalChannels: () => null,
}));

jest.mock('@gitroom/react/helpers/safe.image', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('@gitroom/frontend/components/layout/set.timezone', () => ({
  newDayjs: () => require('dayjs')('2035-01-01T12:00:00Z'),
}));

jest.mock('@gitroom/react/form/input', () => {
  const ReactModule = require('react');
  return {
    Input: ReactModule.forwardRef(
      ({ label, ...props }: any, ref: React.Ref<HTMLInputElement>) => (
        <label>
          {label}
          <input aria-label={label} ref={ref} {...props} />
        </label>
      )
    ),
  };
});

jest.mock('@gitroom/react/form/select', () => {
  const ReactModule = require('react');
  return {
    Select: ReactModule.forwardRef(
      (
        { label, children, ...props }: any,
        ref: React.Ref<HTMLSelectElement>
      ) => (
        <label>
          {label}
          <select aria-label={label} ref={ref} {...props}>
            {children}
          </select>
        </label>
      )
    ),
  };
});

jest.mock(
  '@gitroom/frontend/components/new-launch/providers/tiktok/tiktok.preview',
  () => ({ TiktokPreview: () => null })
);

import { useLaunchStore } from '../../apps/frontend/src/components/new-launch/store';
import TikTokProvider from '../../apps/frontend/src/components/new-launch/providers/tiktok/tiktok.provider';
import {
  withProvider,
  PostComment,
} from '../../apps/frontend/src/components/new-launch/providers/high.order.provider';
import { FetchWrapperComponent } from '../../libraries/helpers/src/utils/custom.fetch';

const creatorData = {
  creator_nickname: 'Test creator',
  privacy_level_options: ['SELF_ONLY'],
  comment_disabled: false,
  duet_disabled: true,
  stitch_disabled: true,
  max_video_post_duration_sec: 60,
};
const integration = (id: string) =>
  ({
    id,
    identifier: 'tiktok',
    name: 'TikTok',
    picture: '',
    editor: 'normal',
    additionalSettings: '[]',
  } as any);

class LoopBoundary extends React.Component<
  { children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

const configure = (id: string, current = 'global') => {
  const account = integration(id);
  useLaunchStore.setState({
    integrations: [account],
    selectedIntegrations: [
      { integration: account, settings: {}, ref: createRef() },
    ],
    current,
    global: [{ id: 'post', content: 'Caption', delay: 0, media: [] }],
  });
};

const Composer = ({
  id,
  mediaOpen = false,
  Provider = TikTokProvider,
}: {
  id: string;
  mediaOpen?: boolean;
  Provider?: React.ComponentType<any>;
}) => {
  const current = useLaunchStore((state) => state.current);
  return (
    <FetchWrapperComponent baseUrl="/api">
      {current !== 'global' && <div id="social-settings" />}
      {mediaOpen && <div role="dialog">Media Library</div>}
      <LoopBoundary>
        <Provider
          id={id}
          ref={useLaunchStore.getState().selectedIntegrations[0].ref}
        />
      </LoopBoundary>
    </FetchWrapperComponent>
  );
};

const requests = () =>
  (global.fetch as jest.Mock).mock.calls.filter(
    ([url, options]) =>
      url === '/api/integrations/function' &&
      JSON.parse(options.body).name === 'creatorInfo'
  );

beforeEach(() => {
  mockSnapshots.length = 0;
  mockMounts = mockUnmounts = 0;
  useLaunchStore.getState().reset();
  global.fetch = jest.fn(async () => ({
    status: 200,
    json: async () => ({ data: creatorData }),
  })) as any;
});
afterEach(cleanup);

it.each(['global', 'tiktok-1'])(
  'loads once from %s through initialization, same-ID updates and settings-panel transitions; reloads on ID change',
  async (current) => {
    configure('tiktok-1', current);
    const view = render(<Composer id="tiktok-1" />);
    await act(async () => undefined);
    const first = mockSnapshots[0];
    // These assertions measure the real RHF methods across every recorded render.
    expect(
      mockSnapshots.every((entry) => entry.setValue === first.setValue)
    ).toBe(true);
    expect(
      mockSnapshots.every((entry) => entry.getValues === first.getValues)
    ).toBe(true);
    expect(mockSnapshots.every((entry) => entry.id === 'tiktok-1')).toBe(true);
    expect(mockSnapshots.every((entry) => entry.fetch === first.fetch)).toBe(
      true
    );
    expect(requests()).toHaveLength(1);
    expect(mockMounts).toBe(1);
    expect(mockUnmounts).toBe(0);
    expect(mockSnapshots.every((entry) => entry.get === first.get)).toBe(true);
    expect(mockSnapshots.length).toBeGreaterThan(1);
    expect(
      useLaunchStore.getState().selectedIntegrations[0].ref.current.getValues()
        .settings
    ).toMatchObject({
      __tiktok_creator_info_loaded: true,
      __tiktok_max_video_duration_sec: 60,
      __tiktok_privacy_level_options_json: '["SELF_ONLY"]',
      comment: false,
      duet: false,
      stitch: false,
    });

    view.rerender(<Composer id="tiktok-1" mediaOpen />);
    await act(async () => undefined);
    expect(requests()).toHaveLength(1);
    act(() => configure('tiktok-1', 'tiktok-1'));
    await waitFor(() => expect(view.getByText('Test creator')).toBeTruthy());
    fireEvent.change(view.getByLabelText('Who can see this video?'), {
      target: { value: 'SELF_ONLY' },
    });
    await act(async () => undefined);
    expect(requests()).toHaveLength(1);
    act(() => useLaunchStore.setState({ current: 'global' }));
    act(() => useLaunchStore.setState({ current: 'tiktok-1' }));
    await act(async () => undefined);
    expect(mockMounts).toBe(1);
    expect(requests()).toHaveLength(1);

    act(() => {
      configure('tiktok-2', 'tiktok-2');
      view.rerender(<Composer id="tiktok-2" mediaOpen />);
    });
    await waitFor(() => expect(requests()).toHaveLength(2));
    expect(JSON.parse(requests()[1][1].body).id).toBe('tiktok-2');
  }
);

// The shared portal also carries the hide-settings style for providers without settings.
it('keeps the no-settings provider style attached and removes its container on unmount', () => {
  const NoSettingsProvider = withProvider({
    postComment: PostComment.POST,
    minimumCharacters: [],
    maximumCharacters: 100,
    SettingsComponent: null,
  });
  configure('tiktok-1', 'tiktok-1');
  const view = render(<Composer id="tiktok-1" Provider={NoSettingsProvider} />);
  const host = view.container.querySelector('#social-settings > div')!;
  expect(host.querySelector('style')?.textContent).toContain(
    '#wrapper-settings {display: none'
  );
  view.unmount();
  expect(host.parentNode).toBeNull();
});
