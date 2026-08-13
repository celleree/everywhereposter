import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const mockFetch = jest.fn();

jest.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () => mockFetch,
}));

import { GuidedComposerVideoEdit } from '../../apps/frontend/src/components/new-launch/guided.composer.video-edit';

const editResult = {
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
    warnings: ['music_unavailable'],
    plannerSource: 'openai-structured-output',
    plannerModel: 'gpt-5.6-luna',
    summary: 'Tight pacing with short pauses removed.',
    settings: {
      silenceThresholdDb: -35,
      minimumSilenceMs: 350,
      speechPaddingMs: 80,
    },
  },
  editDecisionList: {
    schemaVersion: 1,
    strategy: 'talking-head-dead-air-v1',
    style: {
      schemaVersion: 1,
      operation: 'remove_dead_air',
      pacingPreset: 'tight',
      promptCharacterCount: 24,
      warnings: ['music_unavailable'],
      plannerSource: 'openai-structured-output',
    },
    source: {
      mediaId: 'media-1',
      durationMs: 5_000,
      transcription: {
        id: 'transcription-1',
        generation: 1,
        alignment: 'none',
        characterCount: 30,
        wordCount: 5,
        semanticSelectionApplied: false,
      },
    },
    analysis: {
      detector: 'ffmpeg-silencedetect-v1',
      silenceThresholdDb: -35,
      minimumSilenceMs: 350,
      speechPaddingMs: 80,
    },
    decisions: [
      {
        id: 'decision-001',
        action: 'keep',
        sourceStartMs: 0,
        sourceEndMs: 3_000,
        reasons: ['audible_content'],
      },
      {
        id: 'decision-002',
        action: 'cut',
        sourceStartMs: 3_000,
        sourceEndMs: 5_000,
        reasons: ['silence', 'dead_air'],
      },
    ],
  },
  render: {
    durationMs: 3_000,
    container: 'mp4',
    videoCodec: 'h264',
    audioCodec: 'aac',
  },
};

describe('GuidedComposerVideoEdit', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('waits for transcription, renders the requested edit, and preserves the raw source', async () => {
    const onEditingChange = jest.fn();
    const { rerender } = render(
      <GuidedComposerVideoEdit
        sourceMediaId="media-1"
        transcriptionStatus="PROCESSING"
        onEditingChange={onEditingChange}
      />
    );

    fireEvent.change(screen.getByLabelText('Basic video edit'), {
      target: { value: 'Make it fast and punchy with music.' },
    });
    expect(
      (
        screen.getByRole('button', {
          name: 'Create edited video',
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);

    rerender(
      <GuidedComposerVideoEdit
        sourceMediaId="media-1"
        transcriptionStatus="READY"
        onEditingChange={onEditingChange}
      />
    );
    mockFetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue(editResult),
    });

    fireEvent.click(
      screen.getByRole('button', { name: 'Create edited video' })
    );

    expect(onEditingChange).toHaveBeenLastCalledWith(true);
    expect(
      (
        screen.getByRole('button', {
          name: 'Analyzing and rendering...',
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);

    expect(await screen.findByText('Edited video ready')).toBeTruthy();
    expect(
      screen.getByLabelText('Edited video preview').getAttribute('src')
    ).toBe(editResult.outputMedia.path);
    expect(screen.getByText('2s')).toBeTruthy();
    expect(screen.getByText(/raw upload is unchanged/i)).toBeTruthy();
    expect(
      screen.getByRole('link', { name: 'Open edited MP4' }).getAttribute('href')
    ).toBe(editResult.outputMedia.path);
    expect(onEditingChange).toHaveBeenLastCalledWith(false);
    expect(mockFetch).toHaveBeenCalledWith(
      '/media/media-1/talking-head-edit',
      expect.objectContaining({
        body: JSON.stringify({
          stylePrompt: 'Make it fast and punchy with music.',
        }),
      })
    );
  });

  it('shows a retryable API error', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      json: jest
        .fn()
        .mockResolvedValue({ message: 'Render capacity is busy.' }),
    });
    render(
      <GuidedComposerVideoEdit
        sourceMediaId="media-1"
        transcriptionStatus="READY"
      />
    );

    fireEvent.change(screen.getByLabelText('Basic video edit'), {
      target: { value: 'Natural pacing' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Create edited video' })
    );

    expect((await screen.findByRole('alert')).textContent).toContain(
      'Render capacity is busy.'
    );
    await waitFor(() =>
      expect(
        (
          screen.getByRole('button', {
            name: 'Create edited video',
          }) as HTMLButtonElement
        ).disabled
      ).toBe(false)
    );
  });
});
