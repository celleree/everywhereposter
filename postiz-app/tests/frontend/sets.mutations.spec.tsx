import React, { useState } from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { SWRConfig, unstable_serialize } from 'swr';
import { Sets } from '@gitroom/frontend/components/sets/sets';
const mockFetch = jest.fn(),
  mockShow = jest.fn(),
  mockConfirm = jest.fn();
let mockUser: any, mockPath: string;
let mockSetModals: React.Dispatch<React.SetStateAction<any[]>>;
const mockModals = {
  openModal: jest.fn((modal: any) =>
    mockSetModals((items) => [...items, modal])
  ),
  closeAll: jest.fn(() => mockSetModals([])),
};
jest.mock('next/navigation', () => ({ usePathname: () => mockPath }));
jest.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () => mockFetch,
}));
jest.mock('@gitroom/frontend/components/layout/user.context', () => ({
  useUser: () => mockUser,
}));
jest.mock('@gitroom/react/toaster/toaster', () => ({
  useToaster: () => ({ show: mockShow }),
}));
jest.mock('@gitroom/react/helpers/delete.dialog', () => ({
  deleteDialog: (...args: any[]) => mockConfirm(...args),
}));
jest.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}));
jest.mock('@gitroom/frontend/components/layout/new-modal', () => ({
  useModals: () => mockModals,
}));
jest.mock('@gitroom/frontend/components/layout/set.timezone', () => ({
  newDayjs: () => null,
}));
jest.mock('@gitroom/react/form/input', () => ({
  Input: ({ disableForm, translationKey, label, ...props }: any) => (
    <label>
      {label}
      <input {...props} />
    </label>
  ),
}));
jest.mock('@gitroom/frontend/components/new-launch/add.edit.modal', () => ({
  AddEditModal: ({ addEditSets }: any) => (
    <button onClick={() => addEditSets({ posts: ['content'] })}>
      Save content
    </button>
  ),
}));
const row = {
  id: 'set-a',
  organizationId: 'org-a',
  name: 'Original set',
  content: '{}',
};
const response = (body: unknown, ok = true, status = ok ? 200 : 500) => ({
  ok,
  status,
  json: async () => body,
});
function deferred<T = any>() {
  let resolve!: (value: T) => void, reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const settle = async (fn: () => void) =>
  act(async () => {
    fn();
    await Promise.resolve();
  });
const writes = () =>
  mockFetch.mock.calls.filter(([, options]) => options?.method);
function mount(cache = new Map()) {
  function Harness() {
    const [modals, setModals] = useState<any[]>([]);
    mockSetModals = setModals;
    return (
      <>
        <Sets />
        {modals.map((modal, i) => (
          <div key={i}>{modal.children}</div>
        ))}
      </>
    );
  }
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <SWRConfig
      value={{
        provider: () => cache,
        dedupingInterval: 0,
        shouldRetryOnError: false,
      }}
    >
      {children}
    </SWRConfig>
  );
  return { ...render(<Harness />, { wrapper }), cache, Harness };
}
async function openSave(edit = false) {
  await screen.findByText('Original set');
  fireEvent.click(
    screen.getByRole('button', {
      name: edit ? 'Edit' : 'Add a set',
      exact: true,
    })
  );
  fireEvent.click(screen.getByRole('button', { name: 'Save content' }));
  fireEvent.change(screen.getByRole('textbox'), {
    target: { value: 'Keep this name' },
  });
  return screen
    .getByRole('button', { name: 'Save', exact: true })
    .closest('form')!;
}
beforeEach(() => {
  jest.clearAllMocks();
  mockUser = { id: 'user-a', orgId: 'org-a' };
  mockPath = '/sets';
  mockConfirm.mockResolvedValue(true);
  mockFetch.mockImplementation(async (path: string, options: any) => {
    if (options?.method === 'POST') return response({ id: 'set-a' });
    if (options?.method === 'DELETE') return response(row);
    return response(path === '/sets' ? [row] : { integrations: [] });
  });
});
it.each([400, 500, 'network'])(
  'preserves save input after delayed %s failure and blocks same-tick resubmits',
  async (failure) => {
    const request = deferred();
    mockFetch.mockImplementation(async (path: string, options: any) =>
      options?.method
        ? request.promise
        : response(path === '/sets' ? [row] : { integrations: [] })
    );
    mount();
    const form = await openSave();
    act(() => {
      fireEvent.submit(form);
      fireEvent.submit(form);
    });
    expect(writes()).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(screen.getByRole('textbox')).toBeDisabled();
    await settle(() =>
      failure === 'network'
        ? request.reject(new Error('offline'))
        : request.resolve(response({}, false, Number(failure)))
    );
    expect(mockShow).toHaveBeenCalledWith(
      failure === 'network'
        ? 'Could not confirm the save. Refresh the list before retrying.'
        : 'Failed to save set',
      'warning'
    );
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe(
      'Keep this name'
    );
    expect(mockModals.closeAll).not.toHaveBeenCalled();
    expect(
      screen.getByRole('button', { name: 'Save', exact: true })
    ).not.toBeDisabled();
  }
);
it.each([400, 500, 'network'])(
  'keeps row on delayed delete %s failure and guards confirmation',
  async (failure) => {
    const confirmation = deferred<boolean>(),
      request = deferred();
    mockConfirm.mockReturnValue(confirmation.promise);
    mockFetch.mockImplementation(async (path: string, options: any) =>
      options?.method
        ? request.promise
        : response(path === '/sets' ? [row] : { integrations: [] })
    );
    mount();
    await screen.findByText('Original set');
    const button = screen.getByRole('button', { name: 'Delete', exact: true });
    act(() => {
      fireEvent.click(button);
      fireEvent.click(button);
    });
    expect(mockConfirm).toHaveBeenCalledTimes(1);
    expect(writes()).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Deleting…' })).toBeDisabled();
    await settle(() => confirmation.resolve(true));
    expect(writes()).toHaveLength(1);
    await settle(() =>
      failure === 'network'
        ? request.reject(new Error('offline'))
        : request.resolve(response({}, false, Number(failure)))
    );
    expect(screen.getByText('Original set')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Delete', exact: true })
    ).not.toBeDisabled();
    expect(mockShow).toHaveBeenCalledWith(
      failure === 'network'
        ? 'Could not confirm the deletion. Refresh the list before retrying.'
        : 'Failed to delete set',
      'warning'
    );
  }
);
it('releases the delete guard after cancelled confirmation', async () => {
  mockConfirm.mockResolvedValue(false);
  mount();
  await screen.findByText('Original set');
  fireEvent.click(screen.getByRole('button', { name: 'Delete', exact: true }));
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Delete', exact: true })
    ).not.toBeDisabled()
  );
  expect(writes()).toHaveLength(0);
});
it.each(['save', 'delete'])(
  'reports confirmed %s separately when authoritative refresh fails',
  async (operation) => {
    let gets = 0;
    mockFetch.mockImplementation(async (path: string, options: any) => {
      if (options?.method)
        return response(operation === 'save' ? { id: 'set-a' } : row);
      if (path === '/sets' && ++gets > 1) return response({}, false);
      return response(path === '/sets' ? [row] : { integrations: [] });
    });
    mount();
    if (operation === 'save') fireEvent.submit(await openSave(true));
    else {
      await screen.findByText('Original set');
      fireEvent.click(
        screen.getByRole('button', { name: 'Delete', exact: true })
      );
    }
    await screen.findByRole('alert');
    expect(mockShow).toHaveBeenCalledTimes(1);
    expect(mockShow).toHaveBeenCalledWith(
      `Set ${operation === 'save' ? 'saved' : 'deleted'} successfully`,
      'success'
    );
    if (operation === 'save')
      expect(mockModals.closeAll).toHaveBeenCalledTimes(1);
    else expect(screen.queryByText('Original set')).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Refresh sets' }));
    });
    expect(writes()).toHaveLength(1);
  }
);
it.each(['save', 'delete'])(
  'does not accept malformed successful %s response',
  async (operation) => {
    mockFetch.mockImplementation(async (path: string, options: any) =>
      options?.method
        ? response(
            operation === 'save' ? {} : { ...row, organizationId: 'other-org' }
          )
        : response(path === '/sets' ? [row] : { integrations: [] })
    );
    mount();
    if (operation === 'save') fireEvent.submit(await openSave());
    else {
      await screen.findByText('Original set');
      fireEvent.click(
        screen.getByRole('button', { name: 'Delete', exact: true })
      );
    }
    await waitFor(() =>
      expect(mockShow).toHaveBeenCalledWith(
        expect.stringContaining('Could not confirm'),
        'warning'
      )
    );
    expect(mockShow.mock.calls.some(([, type]) => type === 'success')).toBe(
      false
    );
    expect(screen.getByText('Original set')).toBeTruthy();
  }
);
it.each(['save', 'delete'])(
  'waits for %s confirmation body before success',
  async (operation) => {
    const body = deferred();
    mockFetch.mockImplementation(async (path: string, options: any) =>
      options?.method
        ? { ok: true, json: () => body.promise }
        : response(path === '/sets' ? [row] : { integrations: [] })
    );
    mount();
    if (operation === 'save') fireEvent.submit(await openSave());
    else {
      await screen.findByText('Original set');
      fireEvent.click(
        screen.getByRole('button', { name: 'Delete', exact: true })
      );
    }
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(mockShow).not.toHaveBeenCalled();
    await settle(() =>
      body.resolve(operation === 'save' ? { id: 'set-a' } : row)
    );
    expect(mockShow).toHaveBeenCalledWith(
      expect.stringContaining('successfully'),
      'success'
    );
  }
);
it.each(['save', 'delete'])(
  'ignores old %s after unmount, navigation, organization or user switch',
  async (operation) => {
    for (const change of ['unmount', 'navigation', 'organization', 'user']) {
      jest.clearAllMocks();
      mockUser = { id: 'user-a', orgId: 'org-a' };
      mockPath = '/sets';
      const request = deferred();
      mockFetch.mockImplementation(async (path: string, options: any) =>
        options?.method
          ? request.promise
          : response(
              path === '/sets'
                ? [{ ...row, organizationId: mockUser.orgId }]
                : { integrations: [] }
            )
      );
      const view = mount();
      if (operation === 'save') fireEvent.submit(await openSave());
      else {
        await screen.findByText('Original set');
        fireEvent.click(
          screen.getByRole('button', { name: 'Delete', exact: true })
        );
      }
      await waitFor(() => expect(writes()).toHaveLength(1));
      if (change === 'unmount') view.unmount();
      else {
        if (change === 'navigation') mockPath = '/launches';
        if (change === 'organization')
          mockUser = { ...mockUser, orgId: 'org-b' };
        if (change === 'user') mockUser = { ...mockUser, id: 'user-b' };
        view.rerender(<view.Harness />);
      }
      const gets = mockFetch.mock.calls.filter(
        ([, options]) => !options?.method
      ).length;
      await settle(() =>
        request.resolve(response(operation === 'save' ? { id: 'set-a' } : row))
      );
      expect(mockShow).not.toHaveBeenCalled();
      expect(mockModals.closeAll).not.toHaveBeenCalled();
      expect(
        mockFetch.mock.calls.filter(([, options]) => !options?.method)
      ).toHaveLength(gets);
      view.unmount();
    }
  }
);
it('does not close a newer modal when a dismissed save finishes', async () => {
  const request = deferred();
  mockFetch.mockImplementation(async (path: string, options: any) =>
    options?.method
      ? request.promise
      : response(path === '/sets' ? [row] : { integrations: [] })
  );
  mount();
  fireEvent.submit(await openSave());
  act(() => mockSetModals([]));
  await settle(() => request.resolve(response({ id: 'set-a' })));
  expect(mockShow).not.toHaveBeenCalled();
  expect(mockModals.closeAll).not.toHaveBeenCalled();
});
it('rejects a foreign organization list without exposing rows', async () => {
  mockFetch.mockResolvedValue(
    response([{ ...row, organizationId: 'org-b', name: 'Foreign set' }])
  );
  mount();
  await screen.findByRole('alert');
  expect(screen.queryByText('Foreign set')).toBeNull();
});
it('keeps later authoritative refresh results when an earlier list finishes last', async () => {
  const first = deferred(),
    second = deferred();
  let gets = 0;
  mockFetch.mockImplementation(async (path: string, options: any) => {
    if (options?.method) return response({ id: 'set-a' });
    if (path === '/sets') return ++gets === 1 ? first.promise : second.promise;
    return response({ integrations: [] });
  });
  const key = unstable_serialize(['sets', 'user-a', 'org-a']),
    cache = new Map([[key, { data: [row] }]]);
  mount(cache);
  await waitFor(() => expect(gets).toBe(1));
  fireEvent.submit(await openSave(true));
  await waitFor(() => expect(gets).toBe(2));
  await settle(() =>
    second.resolve(response([{ ...row, name: 'New result' }]))
  );
  await screen.findByText('New result');
  await settle(() => first.resolve(response([row])));
  expect(screen.getByText('New result')).toBeTruthy();
  expect(cache.get(key)?.data).toEqual([{ ...row, name: 'New result' }]);
});
it('isolates an old list response after an organization switch', async () => {
  const old = deferred();
  let gets = 0;
  mockFetch.mockImplementation(async (path: string) =>
    path === '/sets'
      ? ++gets === 1
        ? old.promise
        : response([
            {
              ...row,
              id: 'set-b',
              organizationId: 'org-b',
              name: 'New organization',
            },
          ])
      : response({ integrations: [] })
  );
  const view = mount();
  await waitFor(() => expect(gets).toBe(1));
  mockUser = { ...mockUser, orgId: 'org-b' };
  view.rerender(<view.Harness />);
  await screen.findByText('New organization');
  await settle(() => old.resolve(response([row])));
  expect(screen.queryByText('Original set')).toBeNull();
  expect(
    view.cache.get(unstable_serialize(['sets', 'user-a', 'org-a']))?.data
  ).toBeUndefined();
});

it('does not delete when an old confirmation resolves after an organization switch', async () => {
  const confirmation = deferred<boolean>();
  mockConfirm.mockReturnValue(confirmation.promise);
  const view = mount();
  await screen.findByText('Original set');
  fireEvent.click(screen.getByRole('button', { name: 'Delete', exact: true }));
  mockUser = { ...mockUser, orgId: 'org-b' };
  view.rerender(<view.Harness />);
  await settle(() => confirmation.resolve(true));
  expect(writes()).toHaveLength(0);
});
