import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { CreatorAudit } from '../../apps/frontend/src/components/creator-audit/creator-audit';

let mockEnabled = false;
let mockBackend = '';
const mockFetch = jest.fn(async () => ({ ok: true, json: async () => ({ enabled: mockEnabled }) }));
jest.mock('@gitroom/helpers/utils/custom.fetch', () => ({ useFetch: () => mockFetch }));
jest.mock('@gitroom/react/helpers/variable.context', () => ({ useVariables: () => ({ backendUrl: mockBackend }) }));
jest.mock('@gitroom/frontend/components/layout/user.context', () => ({ useUser: () => ({ orgId: 'fixture' }) }));
beforeEach(() => { mockEnabled = false; mockBackend = ''; mockFetch.mockClear(); });

it('shows unavailable state without mounting the audit when configuration is disabled', async () => {
  render(<CreatorAudit />);
  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('unavailable'));
  expect(screen.queryByTitle('Creator Audit')).toBeNull();
});

it('mounts the audit through the configured same-origin authenticated backend', async () => {
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
