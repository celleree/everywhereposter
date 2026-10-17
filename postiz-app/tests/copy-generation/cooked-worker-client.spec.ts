import { createServer } from 'http';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { CookedWorkerClient } from '../../libraries/nestjs-libraries/src/media-editing/cooked-worker-client';

describe('bounded native long-timeline receipt transport', () => {
  it('keeps health working and admits a100block receipt while rejecting oversized output', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cooked-client-'));
    const source = join(root, 'source.mp4'), socket = join(root, 'worker.sock');
    await writeFile(source, 'fixture');
    const blocks = Array.from({ length: 100 }, (_, i) => [i + .123456789012345, i + .987654321098765]);
    let reply = JSON.stringify({ status: 'ready', editing: { blocks, removedBlocks: blocks } });
    expect(Buffer.byteLength(reply)).toBeGreaterThan(4096);
    const server = createServer((req, res) => {
      req.resume(); res.setHeader('content-type', 'application/json');
      res.end(req.url === '/health' ? '{"ready":true}' : reply);
    });
    await new Promise<void>(resolve => server.listen(socket, resolve));
    try {
      const client = new CookedWorkerClient(socket);
      await expect(client.health()).resolves.toEqual({ ready: true });
      await expect(client.create('org', 'media', 'request', source, {})).resolves.toMatchObject({ editing: { blocks } });
      reply = JSON.stringify({ unexpected: 'x'.repeat(17 * 1024) });
      await expect(client.create('org', 'media', 'request', source, {})).rejects.toThrow('WORKER_RESPONSE_LIMIT');
    } finally {
      server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
      await rm(root, { recursive: true });
    }
  });
});
