import { TextDecoder, TextEncoder } from 'util';
import {
  parseCopyGenerationStream,
  requestMediaCopyGeneration,
  requestMediaCopyGenerationForDestinations,
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
    ok: true,
    status: 200,
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

  it('forwards an abort signal through destination generation requests', async () => {
    const payload = {
      requestId: 'request-with-signal',
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
    const controller = new AbortController();

    await requestMediaCopyGenerationForDestinations(
      fetch,
      [{ id: '1', identifier: 'linkedin' }],
      { mediaId: 'media-1', goal: 'position' },
      undefined,
      controller.signal
    );

    expect(fetch).toHaveBeenCalledWith(
      '/posts/copy/generate',
      expect.objectContaining({ signal: controller.signal })
    );
  });

  it('preserves validation messages from non-streaming API errors', async () => {
    const fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () =>
        JSON.stringify({
          message: [
            'sourceCaption must contain non-whitespace text',
            'sourceCaption must be shorter than or equal to 63206 characters',
          ],
        }),
    } as Response);

    await expect(
      requestMediaCopyGeneration(fetch, {
        mediaId: 'media-1',
        platforms: ['linkedin'],
        goal: 'position',
        captionMode: 'adapt-by-platform',
        sourceCaption: '',
      })
    ).rejects.toThrow(
      'sourceCaption must contain non-whitespace text sourceCaption must be shorter than or equal to 63206 characters'
    );
  });

  it('ignores malformed stream lines but propagates stage-handler failures', async () => {
    const payload = {
      requestId: 'request-3',
      status: 'complete',
      sourceConfidence: null,
      warnings: [],
      results: [],
      imagePlans: [],
    };
    const completed = JSON.stringify({ name: 'completed', data: payload });

    await expect(
      parseCopyGenerationStream(
        streamResponse([`not-json\n${completed}\n`]),
        (name) => {
          if (name === 'completed') {
            throw new Error('Stage handler failed');
          }
        }
      )
    ).rejects.toThrow('Stage handler failed');
  });

  it('retains unsupported destinations alongside a completed generation response', async () => {
    const payload = {
      requestId: 'request-4',
      status: 'complete',
      sourceConfidence: 0.9,
      warnings: [],
      results: [],
      imagePlans: [],
    };
    const fetch = jest.fn().mockResolvedValue(
      streamResponse([
        `${JSON.stringify({ name: 'completed', data: payload })}\n`,
      ])
    );
    const unsupported = { id: '3', identifier: 'mastodon' };

    await expect(
      requestMediaCopyGenerationForDestinations(
        fetch,
        [
          { id: '1', identifier: 'linkedin' },
          { id: '2', identifier: 'linkedin-page' },
          unsupported,
        ],
        {
          mediaId: 'media-1',
          goal: 'position',
          captionMode: 'generate',
        }
      )
    ).resolves.toEqual({
      response: payload,
      platforms: ['linkedin'],
      unsupportedDestinations: [unsupported],
    });

    expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({
      platforms: ['linkedin'],
    });
  });

  it('returns unsupported-only destinations without making an invalid request', async () => {
    const fetch = jest.fn();
    const unsupported = { id: '3', identifier: 'mastodon' };

    await expect(
      requestMediaCopyGenerationForDestinations(fetch, [unsupported], {
        mediaId: 'media-1',
        goal: 'position',
      })
    ).resolves.toEqual({
      response: null,
      platforms: [],
      unsupportedDestinations: [unsupported],
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});
