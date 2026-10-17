import React from 'react';
import { render, waitFor, fireEvent, act } from '@testing-library/react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { ResumableUploadProvider } from '../../apps/frontend/src/components/media/resumable-upload.provider';

jest.mock('@gitroom/helpers/utils/custom.fetch', () => ({ useFetch: jest.fn() }));
jest.mock('../../apps/frontend/src/components/layout/user.context', () => ({ useUser: () => ({ orgId: 'org' }) }));
jest.mock('@gitroom/react/helpers/variable.context', () => ({ useVariables: () => ({ storageProvider: 'local', transloadit: [] }) }));
jest.mock('../../apps/frontend/src/components/new-launch/store', () => ({ useLaunchStore: { getState: () => ({ selectedIntegrations: [] }) } }));

it('uses the authenticated fetch without adding headers rejected by cross-origin CORS', async () => {
  const fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ sessions: [] }) });
  (useFetch as jest.Mock).mockReturnValue(fetch);
  const view = render(<ResumableUploadProvider><div>App</div></ResumableUploadProvider>);
  await waitFor(() => expect(fetch).toHaveBeenCalledWith('/media/uploads', undefined));
  view.unmount();
});

it('renders restored recovery inline only where the upload surface mounts it', async () => {
  const fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ sessions: [{
    id: 'saved', originalName: 'original.mp4', byteSize: 10, status: 'UPLOADING', parts: [{ byteSize: 4 }], manifest: [],
  }] }) });
  (useFetch as jest.Mock).mockReturnValue(fetch);
  const { UploadTransfers } = require('../../apps/frontend/src/components/media/resumable-upload.provider');
  const view = render(<ResumableUploadProvider><UploadTransfers /></ResumableUploadProvider>);
  await waitFor(() => expect(view.getByRole('button', { name: 'Retry upload' })).toBeTruthy());
  expect(view.getByRole('progressbar').getAttribute('value')).toBe('4');
  expect(view.getByText('Select the original video to resume saved progress.')).toBeTruthy();
  expect(view.queryByRole('complementary')).toBeNull();
  expect(view.queryByText(/%/)).toBeNull();
  view.rerender(<ResumableUploadProvider><div>Another route</div></ResumableUploadProvider>);
  expect(view.queryByRole('region', { name: 'Video transfers' })).toBeNull();
  view.rerender(<ResumableUploadProvider><UploadTransfers /></ResumableUploadProvider>);
  expect(view.getByText('original.mp4')).toBeTruthy();
  view.unmount();
});

it('scopes cancellation errors to their row and clears them after a successful cancellation', async () => {
  let sessions: any[] = ['first', 'second'].map(id => ({ id, originalName: id + '.mp4', byteSize: 10, status: 'UPLOADING', parts: [], manifest: [] }));
  let conflict = true, deletes = 0;
  const fetch = jest.fn(async (url, options) => {
    const id = url.split('/').pop();
    if (options?.method === 'DELETE') {
      deletes++;
      if (conflict) return { ok: false, status: 409, json: async () => ({ message: 'Wait for the current request to finish before cancellation.' }) };
      sessions = sessions.filter(item => item.id !== id);
      return { ok: true, json: async () => ({ cancelled: true }) };
    }
    return { ok: true, json: async () => url === '/media/uploads' ? { sessions } : sessions.find(item => item.id === id) };
  });
  (useFetch as jest.Mock).mockReturnValue(fetch);
  const { UploadTransfers, useResumableTransfers } = require('../../apps/frontend/src/components/media/resumable-upload.provider');
  let controller: any;
  function Probe() { controller = useResumableTransfers(); return null; }
  const view = render(<ResumableUploadProvider><Probe /><UploadTransfers /></ResumableUploadProvider>);
  await waitFor(() => expect(view.getAllByRole('button', { name: 'Cancel upload' })).toHaveLength(2));
  fireEvent.click(view.getAllByRole('button', { name: 'Cancel upload' })[0]);
  await view.findByRole('alert');
  expect(view.getByText('first.mp4')).toBeTruthy();
  conflict = false;
  fireEvent.click(view.getAllByRole('button', { name: 'Cancel upload' })[0]);
  await waitFor(() => expect(view.queryByText('first.mp4')).toBeNull());
  expect(view.getByText('second.mp4')).toBeTruthy();
  expect(view.queryByRole('alert')).toBeNull();
  expect(deletes).toBe(2);
  conflict = true;
  fireEvent.click(view.getByRole('button', { name: 'Cancel upload' }));
  await view.findByRole('alert');
  sessions[0] = { ...sessions[0], status: 'COMPLETE', media: { id: 'saved-media' } };
  await act(async () => { await controller.refresh(); });
  expect(view.queryByRole('alert')).toBeNull();
  expect(view.getByRole('button', { name: 'Dismiss transfer' })).toBeTruthy();
  expect(deletes).toBe(3);
  view.unmount();
});

it('keeps saved transfers until composer attachment and retains publishing results afterwards', async () => {
  localStorage.clear();
  const sessions = ['attached', 'publishing'].map(id => ({ id, originalName: id + '.mp4', byteSize: 10,
    status: 'COMPLETE', parts: [], manifest: [], media: { id },
    ...(id === 'publishing' ? { quickIntent: { id: 'intent', status: 'COMPLETE', results: [{ integrationId: 'channel', name: 'Channel', state: 'Published' }] } } : {}),
  }));
  const fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ sessions }) });
  (useFetch as jest.Mock).mockReturnValue(fetch);
  const { UploadTransfers, useDismissAttachedTransfers } = require('../../apps/frontend/src/components/media/resumable-upload.provider');
  function Composer({ media }: { media: { id: string }[] }) {
    useDismissAttachedTransfers(media);
    return <><UploadTransfers />{media.map(item => <span key={item.id}>Attached {item.id}</span>)}</>;
  }
  const view = render(<ResumableUploadProvider><Composer media={[]} /></ResumableUploadProvider>);
  await view.findByText('attached.mp4');
  view.rerender(<ResumableUploadProvider><Composer media={[{ id: 'attached' }, { id: 'publishing' }]} /></ResumableUploadProvider>);
  await waitFor(() => expect(view.queryByText('attached.mp4')).toBeNull());
  expect(view.getByText('Attached attached')).toBeTruthy();
  expect(view.getByText('publishing.mp4')).toBeTruthy();
  expect(view.getByText('Channel: Published')).toBeTruthy();
  expect(fetch.mock.calls.every(([, options]) => !options?.method)).toBe(true);
  view.unmount();
});

it.each([true, false])('protects an attached transfer while Quick Upload lookup is pending and after errors (success=%s)', async success => {
  localStorage.clear();
  let release!: (value: any) => void;
  const lookup = new Promise(resolve => { release = resolve; });
  const session: any = { id: 'lookup-session', originalName: 'lookup.mp4', byteSize: 10, status: 'COMPLETE', parts: [], manifest: [], media: { id: 'lookup-media' } };
  const fetch = jest.fn(async (url, options) => {
    if (url === '/integrations/list') return lookup;
    if (url.endsWith('/quick-upload')) {
      session.quickIntent = { id: 'intent', status: 'PROCESSING', results: [] };
      return { ok: true, json: async () => session.quickIntent };
    }
    return { ok: true, json: async () => ({ durableQuickUploadEnabled: true, sessions: [session] }) };
  });
  (useFetch as jest.Mock).mockReturnValue(fetch);
  const { UploadTransfers, useDismissAttachedTransfers } = require('../../apps/frontend/src/components/media/resumable-upload.provider');
  function Composer({ attached }: { attached: boolean }) {
    useDismissAttachedTransfers(attached ? [{ id: 'lookup-media' }] : []);
    return <UploadTransfers />;
  }
  const view = render(<ResumableUploadProvider><Composer attached={false} /></ResumableUploadProvider>);
  fireEvent.click(await view.findByRole('button', { name: 'Quick Upload without individual review' }));
  view.rerender(<ResumableUploadProvider><Composer attached /></ResumableUploadProvider>);
  expect(view.getByText('lookup.mp4')).toBeTruthy();
  expect((view.getByRole('button', { name: 'Dismiss transfer' }) as HTMLButtonElement).disabled).toBe(true);
  await act(async () => { release(success ? { ok: true, json: async () => ({ integrations: [{ id: 'account', identifier: 'x' }] }) } : { ok: false }); });
  await waitFor(() => expect(view.getByText('lookup.mp4')).toBeTruthy());
  if (success) {
    await view.findByText('Quick Upload: Processing');
    expect(fetch.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1);
  } else {
    await view.findByText('Connected accounts could not be checked safely.');
    expect(fetch.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false);
  }
  view.unmount();
});
