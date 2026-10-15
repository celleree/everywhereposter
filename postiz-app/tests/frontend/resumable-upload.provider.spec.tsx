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
