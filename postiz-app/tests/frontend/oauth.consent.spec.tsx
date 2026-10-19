import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import OAuthAuthorizePage from '../../apps/frontend/src/app/(app)/oauth/authorize/page';

let mockParams: URLSearchParams;
const mockFetch = jest.fn();
jest.mock('next/navigation', () => ({ useSearchParams: () => mockParams }));
jest.mock('@gitroom/helpers/utils/custom.fetch', () => ({ useFetch: () => mockFetch }));
jest.mock('@gitroom/frontend/components/new-layout/logo', () => ({ Logo: () => null }));

const labels = {
  'accounts:read': 'Read your connected social accounts',
  'posts:write': 'Upload media and publish or schedule posts to your connected accounts after confirmation',
  'analytics:read': 'Read social account and published-post analytics, including account identity and a limited list of published posts in the selected organization.',
};
it.each(['accounts:read', 'posts:write', 'analytics:read', 'accounts:read posts:write',
  'analytics:read accounts:read', 'posts:write analytics:read', 'posts:write analytics:read accounts:read'])(
  'shows and submits only the requested consent permissions: %s', async (scope) => {
    mockParams = new URLSearchParams({ client_id: 'existing-client', response_type: 'code', scope, resource: 'https://server.test/api/mcp-oauth' });
    mockFetch.mockResolvedValue({ json: async () => ({ app: { name: 'Existing OAuth app' } }) });
    render(<OAuthAuthorizePage />);
    await screen.findByText('Existing OAuth app');
    for (const [permission, label] of Object.entries(labels)) expect(screen.queryByText(label) !== null).toBe(scope.split(' ').includes(permission));
    fireEvent.click(screen.getByRole('button', { name: 'Authorize' }));
    await waitFor(() => expect(mockFetch).toHaveBeenCalledWith('/oauth/authorize', expect.objectContaining({ method: 'POST' })));
    const post = mockFetch.mock.calls.find(([, options]) => options?.method === 'POST');
    expect(JSON.parse(post[1].body)).toMatchObject({ scope, client_id: 'existing-client', action: 'approve' });
  }
);
