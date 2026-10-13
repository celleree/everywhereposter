import React from 'react';
import { render, waitFor } from '@testing-library/react';
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
