import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CreatorAudit } from '../../apps/frontend/src/components/creator-audit/creator-audit';

let mockEnabled = false;
let mockBackend = '';
let mockOrg = 'fixture';
let mockRole: string | undefined = 'ADMIN';
let mockIntegrations: any[] = [];
let mockFetch = jest.fn(async (path: string, options: RequestInit = {}) => {
  if (path === '/creator-audit/status') return { ok: true, json: async () => ({ enabled: mockEnabled }) } as Response;
  if (path === '/integrations/list') return { ok: true, json: async () => ({ integrations: mockIntegrations }) } as Response;
  if (path.endsWith('/tasks/current')) return { ok: true, json: async () => null } as Response;
  return { ok: true, json: async () => ({ id: 'task-1', kind: 'connected', status: 'running' }) } as Response;
});
jest.mock('@gitroom/helpers/utils/custom.fetch', () => ({ useFetch: () => mockFetch }));
jest.mock('@gitroom/react/helpers/variable.context', () => ({ useVariables: () => ({ backendUrl: mockBackend }) }));
jest.mock('@gitroom/frontend/components/layout/user.context', () => ({ useUser: () => ({ orgId: mockOrg, role: mockRole }) }));

const goodInstagram = { id: 'ig-1', identifier: 'instagram', name: 'Creator account' };
beforeEach(() => {
  mockEnabled = false;
  mockBackend = '';
  mockOrg = 'fixture';
  mockRole = 'ADMIN';
  mockIntegrations = [];
  mockFetch.mockReset();
  mockFetch.mockImplementation(async (path: string, options: RequestInit = {}) => {
    if (path === '/creator-audit/status') return { ok: true, json: async () => ({ enabled: mockEnabled }) } as Response;
    if (path === '/integrations/list') return { ok: true, json: async () => ({ integrations: mockIntegrations }) } as Response;
    if (path.endsWith('/tasks/current')) return { ok: true, json: async () => null } as Response;
    return { ok: true, json: async () => ({ id: 'task-1', kind: 'connected', status: 'running' }) } as Response;
  });
});

it('shows unavailable state without mounting the audit when configuration is disabled', async () => {
  render(<CreatorAudit />);
  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('unavailable'));
  expect(screen.queryByTitle('Creator Audit')).toBeNull();
});

it('mounts the existing audit through the configured same-origin authenticated backend', async () => {
  mockEnabled = true; mockBackend = '/backend-api';
  render(<CreatorAudit />);
  await waitFor(() => expect(screen.getByTitle('Creator Audit').getAttribute('src')).toBe(window.location.origin + '/backend-api/creator-audit/audit'));
});

it('refuses a separate browser origin even when the backend feature is enabled', async () => {
  mockEnabled = true; mockBackend = 'https://remote.example.test';
  render(<CreatorAudit />);
  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('unavailable'));
  expect(screen.queryByTitle('Creator Audit')).toBeNull();
});

it('lists only Instagram connections and starts with the selected id and organization header', async () => {
  mockEnabled = true; mockBackend = '/backend-api';
  mockIntegrations = [goodInstagram, { ...goodInstagram, id: 'standalone', identifier: 'instagram-standalone', name: 'Standalone' }, { ...goodInstagram, id: 'fb', identifier: 'facebook' }];
  render(<CreatorAudit />);
  await screen.findByRole('option', { name: 'Creator account' });
  expect(screen.getByRole('option', { name: 'Standalone' })).toBeTruthy();
  expect(screen.queryByRole('option', { name: 'facebook' })).toBeNull();
  fireEvent.change(screen.getByLabelText('Instagram connection'), { target: { value: 'ig-1' } });
  fireEvent.click(screen.getByRole('button', { name: 'Start audit' }));
  await waitFor(() => expect(mockFetch).toHaveBeenCalledWith('/creator-audit/connected', expect.objectContaining({
    method: 'POST',
    body: JSON.stringify({ integration_id: 'ig-1' }),
    headers: { 'X-Audit-Organization': 'fixture' },
  })));
  await screen.findByRole('button', { name: 'Audit running…' });
});

it('offers add or reconnect navigation when the only Instagram connection needs attention', async () => {
  mockEnabled = true; mockBackend = '/backend-api';
  mockIntegrations = [{ ...goodInstagram, disabled: true }];
  render(<CreatorAudit />);
  const link = await screen.findByRole('link', { name: 'Add or reconnect a channel' });
  expect(link.getAttribute('href')).toBe('/launches');
  expect(screen.queryByRole('button', { name: 'Start audit' })).toBeNull();
});

it('keeps a late start response from the previous organization out of the new workspace', async () => {
  mockEnabled = true; mockBackend = '/backend-api'; mockIntegrations = [goodInstagram];
  let resolveStart!: (value: Response) => void;
  const pendingStart = new Promise<Response>((resolve) => { resolveStart = resolve; });
  mockFetch.mockImplementation(async (path: string, options: RequestInit = {}) => {
    if (path === '/creator-audit/status') return { ok: true, json: async () => ({ enabled: mockEnabled }) } as Response;
    if (path === '/integrations/list') return { ok: true, json: async () => ({ integrations: mockIntegrations }) } as Response;
    if (path.endsWith('/tasks/current')) return { ok: true, json: async () => null } as Response;
    if (path === '/creator-audit/connected') return pendingStart;
    return { ok: true, json: async () => ({ id: 'task-1', status: 'running' }) } as Response;
  });
  const view = render(<CreatorAudit />);
  await screen.findByRole('option', { name: 'Creator account' });
  fireEvent.change(screen.getByLabelText('Instagram connection'), { target: { value: 'ig-1' } });
  fireEvent.click(screen.getByRole('button', { name: 'Start audit' }));
  mockOrg = 'other-org';
  view.rerender(<CreatorAudit />);
  resolveStart({ ok: true, json: async () => ({ id: 'old-task', status: 'running' }) } as Response);
  await waitFor(() => expect(mockFetch).toHaveBeenCalledWith('/creator-audit/status', expect.objectContaining({ headers: { 'X-Audit-Organization': 'other-org' } })));
  expect(screen.queryByText('Audit running…')).toBeNull();
});

it('resumes an errored restored task with the same integration and task id', async () => {
  mockEnabled = true; mockBackend = '/backend-api'; mockIntegrations = [goodInstagram];
  mockFetch.mockImplementation(async (path: string, options: RequestInit = {}) => {
    if (path === '/creator-audit/status') return { ok: true, json: async () => ({ enabled: mockEnabled }) } as Response;
    if (path === '/integrations/list') return { ok: true, json: async () => ({ integrations: mockIntegrations }) } as Response;
    if (path.endsWith('/tasks/current')) return { ok: true, json: async () => ({ id: 'saved-task', status: 'error' }) } as Response;
    if (path.endsWith('/saved-task')) return { ok: true, json: async () => ({ id: 'saved-task', status: 'error' }) } as Response;
    return { ok: true, json: async () => ({ id: 'saved-task', status: 'running' }) } as Response;
  });
  render(<CreatorAudit />);
  await screen.findByRole('alert');
  fireEvent.change(screen.getByLabelText('Instagram connection'), { target: { value: 'ig-1' } });
  await screen.findByRole('button', { name: 'Resume audit' });
  fireEvent.click(screen.getByRole('button', { name: 'Resume audit' }));
  await waitFor(() => expect(mockFetch).toHaveBeenCalledWith('/creator-audit/connected', expect.objectContaining({
    method: 'POST', body: JSON.stringify({ integration_id: 'ig-1', resume_task_id: 'saved-task' }),
  })));
});

it('restores a paused task only to its matching loaded Instagram connection', async () => {
  mockEnabled = true; mockBackend = '/backend-api';
  mockIntegrations = [goodInstagram, { ...goodInstagram, id: 'ig-2', name: 'Other creator' }];
  mockFetch.mockImplementation(async (path: string, options: RequestInit = {}) => {
    if (path === '/creator-audit/status') return { ok: true, json: async () => ({ enabled: mockEnabled }) } as Response;
    if (path === '/integrations/list') return { ok: true, json: async () => ({ integrations: mockIntegrations }) } as Response;
    if (path.endsWith('/tasks/current')) return { ok: true, json: async () => ({ id: 'paused-task' }) } as Response;
    if (path.endsWith('/paused-task')) return { ok: true, json: async () => ({ id: 'paused-task', status: 'paused', integration_id: 'ig-1', analysis_cap: 24 }) } as Response;
    if (path === '/creator-audit/connected') return { ok: true, json: async () => ({ id: 'paused-task', status: 'running' }) } as Response;
    return { ok: true, json: async () => ({}) } as Response;
  });
  render(<CreatorAudit />);
  await screen.findByRole('button', { name: 'Resume audit' });
  expect((screen.getByLabelText('Instagram connection') as HTMLSelectElement).value).toBe('ig-1');
  fireEvent.click(screen.getByRole('button', { name: 'Resume audit' }));
  await waitFor(() => expect(mockFetch).toHaveBeenCalledWith('/creator-audit/connected', expect.objectContaining({
    method: 'POST',
    body: JSON.stringify({ integration_id: 'ig-1', resume_task_id: 'paused-task', analysis_cap: 24 }),
    headers: { 'X-Audit-Organization': 'fixture' },
  })));
});

it('reloads the iframe after a connected audit completes', async () => {
  mockEnabled = true; mockBackend = '/backend-api'; mockIntegrations = [goodInstagram];
  let polls = 0;
  mockFetch.mockImplementation(async (path: string, options: RequestInit = {}) => {
    if (path === '/creator-audit/status') return { ok: true, json: async () => ({ enabled: mockEnabled }) } as Response;
    if (path === '/integrations/list') return { ok: true, json: async () => ({ integrations: mockIntegrations }) } as Response;
    if (path.endsWith('/tasks/current')) return { ok: true, json: async () => null } as Response;
    if (path === '/creator-audit/connected') return { ok: true, json: async () => ({ id: 'task-1', status: 'running' }) } as Response;
    if (path.endsWith('/task-1')) return { ok: true, json: async () => ({ id: 'task-1', status: ++polls > 0 ? 'done' : 'running' }) } as Response;
    return { ok: true, json: async () => ({}) } as Response;
  });
  render(<CreatorAudit />);
  await screen.findByRole('option', { name: 'Creator account' });
  const before = screen.getByTitle('Creator Audit');
  fireEvent.change(screen.getByLabelText('Instagram connection'), { target: { value: 'ig-1' } });
  fireEvent.click(screen.getByRole('button', { name: 'Start audit' }));
  await waitFor(() => expect(screen.getByTitle('Creator Audit')).not.toBe(before), { timeout: 5000 });
  expect(mockFetch).toHaveBeenCalledWith('/creator-audit/api/audit/tasks/task-1', expect.objectContaining({ headers: { 'X-Audit-Organization': 'fixture' } }));
});

it('does not offer start authority when the loaded membership role is unknown', async () => {
  mockEnabled = true; mockIntegrations = [goodInstagram]; mockRole = undefined;
  render(<CreatorAudit />);
  await screen.findByRole('option', { name: 'Creator account' });
  fireEvent.change(screen.getByLabelText('Instagram connection'), { target: { value: 'ig-1' } });
  expect((screen.getByRole('button', { name: 'Start audit' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Start audit' }));
  expect(mockFetch.mock.calls.some(([path]) => path === '/creator-audit/connected')).toBe(false);
});
