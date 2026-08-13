import { requestGuidedVideoEdit } from '../../apps/frontend/src/components/new-launch/guided.video-editing.client';

const result = {
  outputMedia: {
    id: 'edited-1',
    name: 'edited.mp4',
    path: 'https://media.example.com/edited.mp4',
    type: 'video',
  },
  stylePlan: {
    schemaVersion: 1,
    operation: 'remove_dead_air',
    pacingPreset: 'tight',
    promptCharacterCount: 24,
    warnings: [],
    plannerSource: 'deterministic-fallback',
    plannerModel: null,
    summary: 'Tight pacing.',
    settings: {
      silenceThresholdDb: -35,
      minimumSilenceMs: 350,
      speechPaddingMs: 80,
    },
  },
  editDecisionList: {
    schemaVersion: 1,
    strategy: 'talking-head-dead-air-v1',
    source: { durationMs: 4_000 },
    decisions: [],
  },
  render: {
    durationMs: 2_500,
    container: 'mp4',
    videoCodec: 'h264',
    audioCodec: 'aac',
  },
};

describe('guided video editing client', () => {
  it('posts the bounded style prompt and returns the edited media result', async () => {
    const fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue(result),
    });

    await expect(
      requestGuidedVideoEdit(fetch, 'media-1', 'Make it fast and punchy.')
    ).resolves.toEqual(result);
    expect(fetch).toHaveBeenCalledWith('/media/media-1/talking-head-edit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stylePrompt: 'Make it fast and punchy.' }),
    });
  });

  it('surfaces nested API errors and rejects incomplete success payloads', async () => {
    const failedFetch = jest.fn().mockResolvedValue({
      ok: false,
      json: jest.fn().mockResolvedValue({
        error: { message: 'The transcript is still processing.' },
      }),
    });
    await expect(
      requestGuidedVideoEdit(failedFetch, 'media-1', 'Natural pacing')
    ).rejects.toThrow('The transcript is still processing.');

    const incompleteFetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ outputMedia: { id: 'edited-1' } }),
    });
    await expect(
      requestGuidedVideoEdit(incompleteFetch, 'media-1', 'Natural pacing')
    ).rejects.toThrow('The video editor returned an incomplete result.');
  });
});
