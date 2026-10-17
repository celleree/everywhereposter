import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SWRConfig, unstable_serialize } from 'swr';
import { VideoEditorWorkspace } from '../../apps/frontend/src/components/video-editor/video-editor.workspace';

const mockFetch = jest.fn();
const mockOpenModal = jest.fn();
let mockUser: any = { id: 'user-1', orgId: 'org-1' };
jest.mock('@gitroom/helpers/utils/custom.fetch', () => ({ useFetch: () => mockFetch }));
jest.mock('@gitroom/frontend/components/layout/user.context', () => ({ useUser: () => mockUser }));
jest.mock('@gitroom/frontend/components/layout/new-modal', () => ({ useModals: () => ({ openModal: mockOpenModal }) }));
jest.mock('@gitroom/frontend/components/media/media.component', () => ({ MediaBox: () => null }));
jest.mock('../../apps/frontend/src/components/video-editor/video-editor.module.css', () => ({}));

jest.mock('@gitroom/frontend/components/new-launch/add.edit.modal', () => ({ AddEditModal: () => null }));
import { buildVideoEditDecisionList } from '../../libraries/nestjs-libraries/src/media-editing/video-edit-decision';

const output = { id: 'output-1', path: '/edited.mp4', originalName: 'Original-edited.mp4', type: 'video' };
const video = { id: 'video-1', path: '/fixture.mp4', originalName: 'Original.mp4', type: 'video' };
function legacyConfig() {
  return { provider: () => new Map(), dedupingInterval: 0, revalidateIfStale: false,
    fallback: Object.fromEntries(['org-1', 'org-2'].map(org => [unstable_serialize(['word-editor-availability', 'user-1:' + org]), { enabled: false }])) };
}
function mount() {
  return render(<SWRConfig value={legacyConfig()}><VideoEditorWorkspace /></SWRConfig>);
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
  localStorage.clear(); mockUser = { id: 'user-1', orgId: 'org-1' };
  Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: jest.fn(async (_key, _options, work) => work({})) } });
  mockFetch.mockImplementation(async (url: string, options?: RequestInit) => {
    if (options?.method === 'POST') return { ok: true, status: 201, json: async () => ({
      schemaVersion: 1, outputMedia: output,
      editDecisionList: buildVideoEditDecisionList({ mediaId: 'video-1', durationMs: 2500, pacingPreset: JSON.parse(String(options.body)).pacingPreset, detectedSilence: [] }),
      render: { status: 'completed', durationMs: 2500, container: 'mp4', videoCodec: 'h264', audioCodec: 'aac' },
    }) };
    return { ok: true, json: async () => url === '/integrations/list' ? { integrations: [] } : url.includes('output-1') ? output : video };
  });
});

it('starts empty with a conservative explicit pacing default and no mutation', () => {
  mount();
  expect(screen.getByText('Start with one video')).toBeTruthy();
  expect((screen.getByLabelText('Pacing') as HTMLSelectElement).value).toBe('relaxed');
  expect(screen.queryByLabelText('Style notes')).toBeNull();
  expect(screen.getByRole('button', { name: 'Create edit' })).toBeDisabled();
  expect(screen.queryByRole('button', { name: 'Download MP4' })).toBeNull();
  expect(mockFetch).not.toHaveBeenCalled();
});

it('loads one existing media record and exposes manual playback and observed metadata', async () => {
  mount(); select();
  const preview = await screen.findByLabelText('Original video preview') as HTMLVideoElement;
  expect(mockFetch).toHaveBeenCalledWith('/media/video-1');
  await screen.findByLabelText('Edited video preview');
  expect(preview.controls && preview.playsInline && !preview.autoplay).toBe(true);
  expect(screen.getAllByText('Unknown')).toHaveLength(4);
  Object.defineProperties(preview, { duration: { value: 8.25 }, videoWidth: { value: 720 }, videoHeight: { value: 1280 } });
  fireEvent.loadedMetadata(preview);
  expect(screen.getByText('8.3 seconds')).toBeTruthy();
  expect(screen.getByText('720 × 1280')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Remove source' }));
  expect(screen.getByText('Start with one video')).toBeTruthy();
  expect(screen.queryByLabelText('Original video preview')).toBeNull();
});

it('retries source loading before starting its first automatic edit', async () => {
  let resolve!: (value: unknown) => void;
  mockFetch.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
  mount(); select();
  expect(screen.getByRole('status').textContent).toContain('Loading source details');
  await act(async () => resolve({ ok: false }));
  expect(await screen.findByRole('alert')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Retry source' }));
  expect(await screen.findByLabelText('Original video preview')).toBeTruthy();
  await screen.findByLabelText('Edited video preview');
  expect(mockFetch.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1);
});

it.each([null, { ...video, type: 'image' }, { ...video, id: 'different' }, { ...video, path: '' }, { ...video, originalName: {} }])('rejects invalid source details: %j', async (body) => {
  mockFetch.mockResolvedValue({ ok: true, json: async () => body });
  mount(); select();
  expect((await screen.findByRole('alert')).textContent).toContain('not a valid video');
  expect(screen.queryByLabelText('Original video preview')).toBeNull();
});

it('requires a single selection and does not replace a valid source with a multiple selection', async () => {
  mount(); select();
  await screen.findByLabelText('Edited video preview');
  select([{ id: 'a', path: '/a.mp4' }, { id: 'b', path: '/b.mp4' }]);
  expect(screen.getByRole('alert').textContent).toContain('exactly one');
  expect(screen.getByLabelText('Original video preview').getAttribute('src')).toBe('/fixture.mp4');
  expect(mockFetch.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1);
});

it('handles preview failures and retries without claiming a render or metadata', async () => {
  mount(); select();
  const preview = await screen.findByLabelText('Original video preview');
  await screen.findByLabelText('Edited video preview');
  fireEvent.error(preview);
  expect(screen.getByRole('alert').textContent).toContain('could not be played');
  fireEvent.click(screen.getByRole('button', { name: 'Retry preview' }));
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getAllByText('Unknown')).toHaveLength(4);
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

it('automatically edits once and hands only the confirmed output to a separate composer without changing a saved draft', async () => {
  const draftKey = 'everywhereposter:create-draft:v1:user-1:org-1';
  localStorage.setItem(draftKey, 'existing draft');
  mount(); select(); await screen.findByLabelText('Edited video preview');
  expect(mockFetch.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Use in composer' }));
  await waitFor(() => expect(mockOpenModal.mock.calls.at(-1)[0].id).toBe('add-edit-modal'));
  expect(mockOpenModal.mock.calls.at(-1)[0].children.props.onlyValues).toEqual([{ content: '', image: [{ id: output.id, path: output.path }] }]);
  expect(localStorage.getItem(draftKey)).toBe('existing draft');
  expect(mockFetch.mock.calls.some(([url, options]) => url.startsWith('/posts') && options?.method === 'POST')).toBe(false);
});

it('recovers its confirmed output after remount without another render', async () => {
  const view = mount(); select(); await screen.findByLabelText('Edited video preview');
  view.unmount(); mount(); await screen.findByLabelText('Edited video preview');
  expect(mockFetch.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1);
});

it('drops an old organization response after the workspace identity changes', async () => {
  let finish!: (value: any) => void;
  mockFetch.mockImplementation(async (url, options) => {
    if (options?.method === 'POST') return new Promise(resolve => { finish = resolve; });
    return { ok: true, json: async () => video };
  });
  const view = mount(); select();
  await waitFor(() => expect(finish).toBeTruthy());
  mockUser = { id: 'user-1', orgId: 'org-2' };
  view.rerender(<SWRConfig value={legacyConfig()}><VideoEditorWorkspace /></SWRConfig>);
  await act(async () => finish({ ok: true, json: async () => ({ schemaVersion: 1, outputMedia: output,
    editDecisionList: buildVideoEditDecisionList({ mediaId: video.id, durationMs: 2500, pacingPreset: 'relaxed', detectedSilence: [] }),
    render: { status: 'completed', durationMs: 2500, container: 'mp4', videoCodec: 'h264', audioCodec: 'aac' } }) }));
  expect(screen.queryByLabelText('Edited video preview')).toBeNull();
  expect(screen.getByText('Start with one video')).toBeTruthy();
});

it('waits for mode availability without starting a remembered legacy render', async () => {
  localStorage.setItem('everywhereposter:video-editor-selection:v1:user-1:org-1', JSON.stringify({ version: 1, sourceId: video.id, pacing: 'relaxed' }));
  let resolve!: (value: unknown) => void;
  mockFetch.mockReturnValueOnce(new Promise(done => { resolve = done; }));
  render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}><VideoEditorWorkspace /></SWRConfig>);
  expect(screen.getByRole('status').textContent).toContain('Loading editor');
  expect(screen.queryByRole('button', { name: 'Choose video' })).toBeNull();
  await act(async () => resolve({ ok: true, json: async () => ({ enabled: true }) }));
  expect(await screen.findByText('Choose or upload one video to start automatic transcription.')).toBeTruthy();
  expect(mockFetch.mock.calls.map(([url]) => url)).toEqual(['/media/cooked/status']);
});
