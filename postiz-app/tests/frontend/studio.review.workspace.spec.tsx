import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StudioReviewWorkspace } from '../../apps/frontend/src/components/video-editor/studio-review.workspace';

const mockFetch = jest.fn();
let mockPicker: any;
let mockJobs: any[] = [];
let mockResult: any;
jest.mock('@gitroom/helpers/utils/custom.fetch', () => ({ useFetch: () => mockFetch }));
jest.mock('@gitroom/frontend/components/layout/new-modal', () => ({ useModals: () => ({
  openModal: (options: any) => { mockPicker = options.children(() => {} ).props.setMedia; },
}) }));
jest.mock('@gitroom/frontend/components/media/media.component', () => ({ MediaBox: () => null }));
jest.mock('@gitroom/react/helpers/use.media.directory', () => ({ useMediaDirectory: () => ({ set: (path: string) => path }) }));
jest.mock('swr', () => ({ __esModule: true, default: (key: any) => ({
  data: !key ? undefined : key[0] === 'studio-availability' ? { enabled: true } : key[0] === 'studio-jobs' ? mockJobs : mockResult,
  mutate: jest.fn(),
}) }));

beforeEach(() => {
  localStorage.clear(); mockJobs = []; mockResult = undefined;
  Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: () => 'request-id' });
  mockFetch.mockReset().mockImplementation(async (url: string, options?: any) => {
    if (options?.method === 'POST') return { ok: false };
    return { ok: true, json: async () => url.includes('/framing/') ? {} : { id: 'source', type: 'video', path: '/source.mp4' } };
  });
});

async function chooseSource() {
  fireEvent.click(screen.getByRole('button', { name: 'Upload or choose source' }));
  await act(async () => { await mockPicker([{ id: 'source' }]); });
}

test('submits zero supporting visuals only after framing confirmation and recovers the same request', async () => {
  render(<StudioReviewWorkspace scope="test" />);
  await chooseSource();
  const create = screen.getByRole('button', { name: /Create Studio edit/ });
  expect(create).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox', { name: /one stationary speaker/ }));
  expect(create).not.toBeDisabled();
  fireEvent.click(create);
  await screen.findByRole('alert');
  const first = mockFetch.mock.calls.find(([url, options]) => url === '/media/studio/jobs' && options?.method === 'POST')![1].body;
  expect(JSON.parse(first)).toMatchObject({ sourceMediaId: 'source', brollMediaIds: [], profile: 'easy-graphics-v1', creative: { framing: { confirmed: true, stationary: true, singleSpeaker: true } } });
  expect(create).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Recover last edit request' }));
  await waitFor(() => expect(mockFetch.mock.calls.filter(([url, options]) => url === '/media/studio/jobs' && options?.method === 'POST')).toHaveLength(2));
  expect(mockFetch.mock.calls.filter(([url, options]) => url === '/media/studio/jobs' && options?.method === 'POST')[1][1].body).toBe(first);
});

test('selected supporting visuals can be cleared and changing source clears them', async () => {
  render(<StudioReviewWorkspace scope="test" />);
  await chooseSource();
  fireEvent.click(screen.getByRole('button', { name: /Choose optional supporting visuals/ }));
  await act(async () => { await mockPicker([{ id: 'visual' }]); });
  expect(screen.getByRole('button', { name: /visuals \(1\/8\)/ })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Clear supporting visuals' }));
  expect(screen.getByRole('button', { name: /visuals \(0\/8\)/ })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /Choose optional supporting visuals/ }));
  await act(async () => { await mockPicker([{ id: 'visual' }]); });
  await chooseSource();
  expect(screen.getByRole('button', { name: /visuals \(0\/8\)/ })).toBeTruthy();
});

test('saving requires explicit review of the current verified result', () => {
  mockJobs = [{ id: 'job', state: 'DONE' }];
  mockResult = { id: 'job', generation: 1, sha256: 'hash', technicalStatus: 'PASS', preview: '/preview' };
  render(<StudioReviewWorkspace scope="test" />);
  const save = screen.getByRole('button', { name: 'Save reviewed copy' });
  expect(save).toBeDisabled();
  expect(screen.queryByRole('button', { name: 'Use in composer' })).toBeNull();
  fireEvent.click(screen.getByRole('checkbox', { name: /watched and listened/ }));
  expect(save).not.toBeDisabled();
});
