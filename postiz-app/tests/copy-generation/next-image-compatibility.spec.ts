import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import {
  fetchInternalImage,
  ImageError,
} from 'next/dist/server/image-optimizer';

describe('Next internal image response cap with tiny offline chunks', () => {
  afterEach(() => jest.restoreAllMocks());

  it.each([2, 12])(
    'handles %i benign chunks with a 16-byte argument cap',
    async (chunkCount) => {
      const chunk = Buffer.from('fixture!');
      let produced = 0;
      let response: any;
      let producer: Readable;
      let transportError: any;
      jest.spyOn(console, 'error').mockImplementation(() => undefined);
      const pending = fetchInternalImage(
        '/offline.png',
        { method: 'GET', headers: {}, socket: null } as any,
        {} as any,
        16,
        async (_request, res) => {
          response = res;
          res.setHeader('Content-Type', 'image/png');
          // The handler consumes transport failure; fetchInternalImage owns the
          // corresponding response failure and translates it to ImageError 413.
          response.hasStreamed.catch(() => undefined);
          producer = Readable.from(
            (async function* () {
              for (let i = 0; i < chunkCount; i++) {
                // Like a file stream, let destruction propagate between reads.
                await new Promise<void>((resolve) => setImmediate(resolve));
                produced++;
                yield chunk;
              }
            })(),
            { highWaterMark: 1 }
          );
          await pipeline(producer, res).catch((error) => {
            transportError = error;
          });
        }
      );
      if (chunkCount === 2) {
        const result = await pending;
        expect(result.buffer).toEqual(Buffer.concat([chunk, chunk]));
        expect(result.contentType).toBe('image/png');
        expect(transportError).toBeUndefined();
      } else {
        await expect(pending).rejects.toBeInstanceOf(ImageError);
        await expect(pending).rejects.toMatchObject({ statusCode: 413 });
        expect(transportError).toMatchObject({
          code: 'ERR_MAX_BODY_SIZE_EXCEEDED',
        });
        expect(response.destroyed).toBe(true);
        expect(producer!.destroyed).toBe(true);
        expect(produced).toBeLessThan(chunkCount);
      }
      expect(
        response.buffers.reduce(
          (size: number, bytes: Buffer) => size + bytes.length,
          0
        )
      ).toBeLessThanOrEqual(16);
    }
  );
});
