import { TextDecoder, TextEncoder } from 'util';
import {
  parseCopyGenerationStream,
  requestMediaCopyGeneration,
  resolveCopyGenerationDestinations,
} from '../../apps/frontend/src/components/new-launch/copy-generation.client';

Object.assign(global, {
  TextEncoder,
  TextDecoder,
});

const streamResponse = (chunks: string[]) => {
  const encoded = chunks.map((chunk) => new TextEncoder().encode(chunk));
  let index = 0;

  return {
    body: {
      getReader: () => ({
        read: async () =>
          index < encoded.length
            ? { done: false, value: encoded[index++] }
            : { done: true, value: undefined },
      }),
    },
  } as Response;
};

describe('copy-generation client', () => {
  it('deduplicates accounts by platform and exposes unsupported destinations', () => {
    const linkedinA = { id: '1', identifier: 'linkedin', name: 'LinkedIn A' };
    const linkedinB = {
      id: '2',
      identifier: 'linkedin-page',
      name: 'LinkedIn B',
    };
    const unsupported = { id: '3', identifier: 'mastodon', name: 'Mastodon' };

    expect(
      resolveCopyGenerationDestinations([
        linkedinA,
        linkedinB,
        { id: '4', identifier: 'instagram', name: 'Instagram' },
        unsupported,
      ])
    ).toEqual({
      platforms: ['linkedin', 'instagram'],
      unsupportedDestinations: [unsupported],
    });
  });

  it('parses split NDJSON events and returns the completed payload', async () => {
    const payload = {
      requestId: 'request-1',
      status: 'complete',
      sourceConfidence: 1,
      warnings: [],
      results: [],
      imagePlans: [],
    };
    const completedLine = JSON.stringify({ name: 'completed', data: payload });
    const stages: string[] = [];

    const response = await parseCopyGenerationStream(
      streamResponse([
        `${JSON.stringify({
          name: 'copy-generation-started',
          data: {},
        })}\n${completedLine.slice(0, 20)}`,
        `${completedLine.slice(20)}\n`,
      ]),
      (name) => stages.push(name)
    );

    expect(response).toEqual(payload);
    expect(stages).toEqual(['copy-generation-started', 'completed']);
  });

  it('posts the reusable request contract through the same stream parser', async () => {
    const payload = {
      requestId: 'request-2',
      status: 'complete',
      sourceConfidence: 1,
      warnings: [],
      results: [],
      imagePlans: [],
    };
    const fetch = jest
      .fn()
      .mockResolvedValue(
        streamResponse([
          `${JSON.stringify({ name: 'completed', data: payload })}\n`,
        ])
      );

    await expect(
      requestMediaCopyGeneration(fetch, {
        mediaId: 'media-1',
        platforms: ['linkedin'],
        goal: 'position',
        captionMode: 'adapt-by-platform',
        sourceCaption: 'Authoritative caption',
        additionalContext: 'Keep the tone practical.',
      })
    ).resolves.toEqual(payload);

    expect(fetch).toHaveBeenCalledWith('/posts/copy/generate', {
      method: 'POST',
      body: JSON.stringify({
        mediaId: 'media-1',
        platforms: ['linkedin'],
        goal: 'position',
        captionMode: 'adapt-by-platform',
        sourceCaption: 'Authoritative caption',
        additionalContext: 'Keep the tone practical.',
      }),
    });
  });
});
