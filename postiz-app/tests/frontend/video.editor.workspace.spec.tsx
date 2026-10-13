import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { VideoEditorWorkspace } from '../../apps/frontend/src/components/video-editor/video-editor.workspace';

const mockFetch = jest.fn();
const mockOpenModal = jest.fn();
jest.mock('@gitroom/helpers/utils/custom.fetch', () => ({ useFetch: () => mockFetch }));
jest.mock('@gitroom/frontend/components/layout/user.context', () => ({ useUser: () => ({ orgId: 'org-1' }) }));
jest.mock('@gitroom/frontend/components/layout/new-modal', () => ({ useModals: () => ({ openModal: mockOpenModal }) }));
jest.mock('@gitroom/frontend/components/media/media.component', () => ({ MediaBox: () => null }));
jest.mock('../../apps/frontend/src/components/video-editor/video-editor.module.css', () => ({}));

const video = { id: 'video-1', path: '/fixture.mp4', originalName: 'Original.mp4', type: 'video' };
function mount() {
  return render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}><VideoEditorWorkspace /></SWRConfig>);
}
function select(items = [{ id: 'video-1', path: '/fixture.mp4' }]) {
  fireEvent.click(screen.getByRole('button', { name: 'Choose video' }));
  const modal = mockOpenModal.mock.calls.at(-1)![0];
  const picker = modal.children(jest.fn());
  expect(picker.props).toMatchObject({ type: 'video', hideSourceTabs: true, compactPicker: true });
  expect(picker.props.guidedTranscription).toBeUndefined();
  act(() => picker.props.setMedia(items));
}
beforeEach(() => {
  mockFetch.mockReset(); mockOpenModal.mockReset();
  mockFetch.mockResolvedValue({ ok: true, json: async () => video });
});

it('starts empty, keeps direction local and all unsupported actions disabled', () => {
  mount();
  expect(screen.getByText('Start with one video')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Pacing'), { target: { value: 'tight' } });
  fireEvent.change(screen.getByLabelText('Style notes'), { target: { value: 'Simple captions' } });
  for (const name of ['Create edit', 'Export MP4', 'Clip timeline', 'Transcript cuts', 'Caption styles', 'B-roll / image overlays', 'Inspect edit']) {
    expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true);
  }
  expect(mockFetch).not.toHaveBeenCalled();
});

it('loads one existing media record and exposes manual playback and observed metadata', async () => {
  mount(); select();
  const preview = await screen.findByLabelText('Original video preview') as HTMLVideoElement;
  expect(mockFetch).toHaveBeenCalledWith('/media/video-1');
  expect(preview.controls && preview.playsInline && !preview.autoplay).toBe(true);
  expect(screen.getAllByText('Unknown')).toHaveLength(2);
  Object.defineProperties(preview, { duration: { value: 8.25 }, videoWidth: { value: 720 }, videoHeight: { value: 1280 } });
  fireEvent.loadedMetadata(preview);
  expect(screen.getByText('8.3 seconds')).toBeTruthy();
  expect(screen.getByText('720 × 1280')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Remove source' }));
  expect(screen.getByText('Start with one video')).toBeTruthy();
  expect(screen.queryByLabelText('Original video preview')).toBeNull();
});

it('shows source loading and retries a failed GET without a mutation', async () => {
  let resolve!: (value: unknown) => void;
  mockFetch.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
  mount(); select();
  expect(screen.getByRole('status').textContent).toContain('Loading source details');
  await act(async () => resolve({ ok: false }));
  expect(await screen.findByRole('alert')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Retry source' }));
  expect(await screen.findByLabelText('Original video preview')).toBeTruthy();
  expect(mockFetch.mock.calls.every((call) => call.length === 1)).toBe(true);
});

it.each([null, { ...video, type: 'image' }, { ...video, id: 'different' }, { ...video, path: '' }, { ...video, originalName: {} }])('rejects invalid source details: %j', async (body) => {
  mockFetch.mockResolvedValue({ ok: true, json: async () => body });
  mount(); select();
  expect((await screen.findByRole('alert')).textContent).toContain('not a valid video');
  expect(screen.queryByLabelText('Original video preview')).toBeNull();
});

it('requires a single selection and does not replace a valid source with a multiple selection', async () => {
  mount(); select();
  await screen.findByLabelText('Original video preview');
  select([{ id: 'a', path: '/a.mp4' }, { id: 'b', path: '/b.mp4' }]);
  expect(screen.getByRole('alert').textContent).toContain('exactly one');
  expect(screen.getByLabelText('Original video preview').getAttribute('src')).toBe('/fixture.mp4');
  expect(mockFetch).toHaveBeenCalledTimes(1);
});

it('handles preview failures and retries without claiming a render or metadata', async () => {
  mount(); select();
  const preview = await screen.findByLabelText('Original video preview');
  fireEvent.error(preview);
  expect(screen.getByRole('alert').textContent).toContain('could not be played');
  fireEvent.click(screen.getByRole('button', { name: 'Retry preview' }));
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getAllByText('Unknown')).toHaveLength(2);
  expect(screen.getByLabelText('Original video preview')).not.toBe(preview);
});

it('does not show stale media when an older selection finishes after a new one', async () => {
  let resolve!: (value: unknown) => void;
  mockFetch.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
  mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ ...video, id: 'video-2', originalName: 'Second.mp4' }) });
  mount(); select(); select([{ id: 'video-2', path: '/fixture.mp4' }]);
  await screen.findByText('Second.mp4');
  await act(async () => resolve({ ok: true, json: async () => video }));
  await waitFor(() => expect(screen.queryByText('Original.mp4')).toBeNull());
  expect(screen.getByText('Second.mp4')).toBeTruthy();
});
