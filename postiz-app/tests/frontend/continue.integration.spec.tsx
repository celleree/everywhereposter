import React from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { ContinueIntegration } from '../../apps/frontend/src/components/launches/continue.integration';

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockFetch = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
}));
jest.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () => mockFetch,
}));
jest.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}));
jest.mock('@gitroom/react/helpers/variable.context', () => ({
  useVariables: () => ({}),
}));
jest.mock('@gitroom/frontend/components/layout/set.timezone', () => ({
  newDayjs: () => ({}),
}));
jest.mock('dayjs', () => ({
  __esModule: true,
  default: { tz: () => ({ utcOffset: () => 0 }) },
}));
jest.mock('@gitroom/frontend/components/layout/redirect', () => ({
  Redirect: () => null,
}));
jest.mock(
  '@gitroom/frontend/components/launches/helpers/use.integration',
  () => ({ IntegrationContext: require('react').createContext({}) })
);
jest.mock(
  '@gitroom/frontend/components/launches/helpers/use.custom.provider.function',
  () => ({ useCustomProviderFunction: () => ({ get: jest.fn() }) })
);
jest.mock(
  '@gitroom/frontend/components/new-launch/providers/continue-provider/list',
  () => ({
    continueProviderList: {
      facebook:
        require('../../apps/frontend/src/components/new-launch/providers/continue-provider/facebook/facebook.continue')
          .FacebookContinue,
      instagram:
        require('../../apps/frontend/src/components/new-launch/providers/continue-provider/instagram/instagram.continue')
          .InstagramContinue,
    },
  })
);

const params = { code: 'one-use-code', state: 'one-use-state' };
const key = 'integration-return-route';
const response = (body: unknown, status = 200) => ({
  status,
  json: async () => body,
});
const pages = [
  {
    id: 'page-one',
    pageId: 'linked-one',
    name: 'Page One',
    picture: { data: { url: '/one.png' } },
  },
  {
    id: 'page-two',
    pageId: 'linked-two',
    name: 'Page Two',
    picture: { data: { url: '/two.png' } },
  },
];
const twoStep = (items = pages, extras = {}) =>
  response({
    id: 'pending-channel',
    inBetweenSteps: true,
    pages: items,
    ...extras,
  });
function pending<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
function show(provider = 'facebook', logged = true, searchParams = params) {
  return render(
    <ContinueIntegration
      provider={provider}
      searchParams={searchParams}
      logged={logged}
    />
  );
}
beforeEach(() => {
  jest.clearAllMocks();
  sessionStorage.clear();
  mockFetch.mockReset();
  mockFetch.mockResolvedValue(twoStep([]));
});
afterEach(() => jest.restoreAllMocks());

it.each(['facebook', 'instagram'])(
  '%s empty accounts have honest guidance and a deterministic exit',
  async (provider) => {
    sessionStorage.setItem(key, '/create?draft=kept#accounts');
    show(provider);
    await screen.findByRole('heading', { name: 'Configure Your Channel' });
    expect(screen.getByText(/No eligible/)).toBeTruthy();
    expect(screen.queryByText(/connect all the pages/)).toBeNull();
    expect(
      screen
        .getByRole('link', { name: 'How to switch Facebook accounts' })
        .getAttribute('href')
    ).toBe('https://www.facebook.com/help/804757836392387');
    fireEvent.click(screen.getByRole('button', { name: 'Back to app' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back to app' }));
    expect(mockReplace.mock.calls).toEqual([['/create?draft=kept#accounts']]);
    expect(sessionStorage.getItem(key)).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  }
);

it.each([
  '//elsewhere.test',
  '/integrations/social/facebook?code=old',
  '/\\elsewhere.test',
])(
  'unsafe saved destination %s falls back without replaying OAuth',
  async (route) => {
    sessionStorage.setItem(key, route);
    show();
    await screen.findByRole('heading', { name: 'Configure Your Channel' });
    fireEvent.click(screen.getByRole('button', { name: 'Back to app' }));
    expect(mockReplace).toHaveBeenCalledWith('/launches');
  }
);

it('onboarding fallback and unavailable session storage still allow exit', async () => {
  jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('Storage blocked');
  });
  jest.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
    throw new Error('Storage blocked');
  });
  show('instagram', true, { ...params, onboarding: 'true' } as typeof params);
  await screen.findByRole('heading', { name: 'Configure Your Channel' });
  fireEvent.click(screen.getByRole('button', { name: 'Back to app' }));
  expect(mockReplace).toHaveBeenCalledWith('/launches?onboarding=true');
});

it.each(['network', 'json'])(
  'initial %s failure has an escape and never replays the callback',
  async (kind) => {
    sessionStorage.setItem(key, '/create?draft=kept');
    if (kind === 'network')
      mockFetch.mockRejectedValueOnce(new Error('offline'));
    else
      mockFetch.mockResolvedValueOnce({
        status: 200,
        json: async () => {
          throw new Error('invalid json');
        },
      });
    show('instagram');
    await screen.findByText(
      'Could not finish loading this connection. Return to the app and start a new connection.'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Back to app' }));
    expect(mockReplace).toHaveBeenCalledWith('/create?draft=kept');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  }
);

it('loading can be left before a late callback result without overwriting newer return state', async () => {
  const request = pending<ReturnType<typeof response>>();
  mockFetch.mockReturnValueOnce(request.promise);
  show();
  fireEvent.click(screen.getByRole('button', { name: 'Back to app' }));
  sessionStorage.setItem(key, '/settings?new-flow=true');
  await act(async () => request.resolve(response({ inBetweenSteps: false })));
  expect(mockPush).not.toHaveBeenCalled();
  expect(sessionStorage.getItem(key)).toBe('/settings?new-flow=true');
});

it('unmount prevents a late callback failure from changing a newer flow', async () => {
  const request = pending<ReturnType<typeof response>>();
  mockFetch.mockReturnValueOnce(request.promise);
  const view = show();
  view.unmount();
  sessionStorage.setItem(key, '/settings?new-flow=true');
  await act(async () => request.reject(new Error('late failure')));
  expect(sessionStorage.getItem(key)).toBe('/settings?new-flow=true');
  expect(mockPush).not.toHaveBeenCalled();
});

it.each(['facebook', 'instagram'])(
  '%s save failure stays visible and preserves another-page recovery',
  async (provider) => {
    mockFetch
      .mockResolvedValueOnce(twoStep())
      .mockResolvedValueOnce(
        response({ message: 'Page access unavailable' }, 400)
      )
      .mockResolvedValueOnce(response({}));
    show(provider);
    fireEvent.click(
      await screen.findByText(
        provider === 'instagram' ? '@Page One' : 'Page One'
      )
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Page access unavailable'
    );
    expect(
      screen.getByRole('heading', { name: 'Configure Your Channel' })
    ).toBeTruthy();
    fireEvent.click(
      screen.getByText(provider === 'instagram' ? '@Page Two' : 'Page Two')
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith(
        expect.stringContaining('Channel Added')
      )
    );
    expect(JSON.parse(mockFetch.mock.calls[2][1].body)).toEqual({
      ...params,
      ...(provider === 'instagram'
        ? { id: 'page-two', pageId: 'linked-two' }
        : { page: 'page-two' }),
    });
  }
);

it('uncertain save failure is announced without claiming rollback or replaying', async () => {
  mockFetch
    .mockResolvedValueOnce(twoStep())
    .mockRejectedValueOnce(new Error('connection lost'));
  show();
  fireEvent.click(await screen.findByText('Page One'));
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect((await screen.findByRole('alert')).textContent).toContain(
    'check your channels before trying again'
  );
  expect(mockPush).not.toHaveBeenCalled();
  expect(mockFetch).toHaveBeenCalledTimes(2);
});

it('pending save cannot double-submit or navigate after leaving', async () => {
  const save = pending<ReturnType<typeof response>>();
  mockFetch.mockResolvedValueOnce(twoStep()).mockReturnValueOnce(save.promise);
  show();
  fireEvent.click(await screen.findByText('Page One'));
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(mockFetch).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole('button', { name: 'Back to app' }));
  sessionStorage.setItem(key, '/create?new-flow=true');
  await act(async () => save.resolve(response({})));
  expect(mockPush).not.toHaveBeenCalled();
  expect(sessionStorage.getItem(key)).toBe('/create?new-flow=true');
});

it('public connection preserves its public save endpoint and successful return URL', async () => {
  mockFetch
    .mockResolvedValueOnce(
      twoStep(pages, { returnURL: 'https://customer.example.test/complete' })
    )
    .mockResolvedValueOnce(response({}));
  show('instagram', false);
  fireEvent.click(await screen.findByText('@Page One'));
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() =>
    expect(mockPush).toHaveBeenCalledWith(
      'https://customer.example.test/complete?added=instagram&msg=Channel Added'
    )
  );
  expect(mockFetch.mock.calls[1][0]).toBe(
    '/integrations/public/provider/pending-channel/connect'
  );
});

it('guest recovery explains how to exit without app login and makes no privileged restart request', async () => {
  show('facebook', false);
  await screen.findByRole('heading', { name: 'Configure Your Channel' });
  expect(
    screen.getByText(/You can close this tab without signing in/)
  ).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Back to app' }));
  expect(
    mockFetch.mock.calls.every(([, options]) => options.method === 'POST')
  ).toBe(true);
  expect(mockFetch).toHaveBeenCalledTimes(1);
});
