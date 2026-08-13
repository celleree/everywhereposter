import { mkdtemp, rm, stat, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { CloudflareStorage } from '@gitroom/nestjs-libraries/upload/cloudflare.storage';
import { LocalStorage } from '@gitroom/nestjs-libraries/upload/local.storage';

const minimalMp4Header = Buffer.from(
  '0000001c6674797069736f6d0000020069736f6d69736f3261766331',
  'hex'
);

describe('trusted upload-from-path storage', () => {
  it('copies and removes a local MP4 without accepting path traversal', async () => {
    const workingDirectory = await mkdtemp(
      join(tmpdir(), 'postiz-upload-path-')
    );
    const uploadDirectory = join(workingDirectory, 'uploads');
    const sourcePath = join(workingDirectory, 'source.mp4');
    const previousFrontendUrl = process.env.FRONTEND_URL;

    try {
      process.env.FRONTEND_URL = 'https://app.example.com';
      await writeFile(sourcePath, minimalMp4Header);
      const storage = new LocalStorage(uploadDirectory);
      const uploaded = await storage.uploadFromPath(
        sourcePath,
        'talking-head-edited.mp4'
      );
      const storedPath = join(
        uploadDirectory,
        new URL(uploaded.path).pathname.replace(/^\/uploads\//, '')
      );

      await expect(stat(storedPath)).resolves.toMatchObject({
        size: minimalMp4Header.length,
      });
      await storage.removeFile(uploaded.path);
      await expect(stat(storedPath)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(
        storage.removeFile(
          'https://app.example.com/uploads/%2e%2e/private-file.mp4'
        )
      ).rejects.toThrow('Local upload path is invalid.');
    } finally {
      if (previousFrontendUrl === undefined) {
        delete process.env.FRONTEND_URL;
      } else {
        process.env.FRONTEND_URL = previousFrontendUrl;
      }
      await rm(workingDirectory, { recursive: true, force: true });
    }
  });

  it('streams an MP4 to R2 and deletes only the returned bucket URL', async () => {
    const workingDirectory = await mkdtemp(join(tmpdir(), 'postiz-r2-path-'));
    const sourcePath = join(workingDirectory, 'source.mp4');

    try {
      await writeFile(sourcePath, minimalMp4Header);
      const storage = new CloudflareStorage(
        'test-account',
        'test-access-key',
        'test-secret-key',
        'auto',
        'test-bucket',
        'https://media.example.com/assets/'
      );
      const send = jest.fn().mockImplementation(async (command) => {
        command.input?.Body?.destroy?.();
        return {};
      });
      (storage as any)._client = { send };

      const uploaded = await storage.uploadFromPath(
        sourcePath,
        'talking-head-edited.mp4'
      );
      await storage.removeFile(uploaded.path);

      expect(uploaded).toMatchObject({
        path: expect.stringMatching(
          /^https:\/\/media\.example\.com\/assets\/[a-zA-Z0-9]+\.mp4$/
        ),
        mimetype: 'video/mp4',
        originalname: 'talking-head-edited.mp4',
        size: minimalMp4Header.length,
      });
      expect(send.mock.calls[0][0].constructor.name).toBe('PutObjectCommand');
      expect(send.mock.calls[1][0].constructor.name).toBe(
        'DeleteObjectCommand'
      );
      expect(send.mock.calls[1][0].input).toMatchObject({
        Bucket: 'test-bucket',
        Key: uploaded.filename,
      });

      await expect(
        storage.removeFile('https://attacker.example/private.mp4')
      ).rejects.toThrow('Cloudflare upload path is invalid.');
      expect(send).toHaveBeenCalledTimes(2);
    } finally {
      await rm(workingDirectory, { recursive: true, force: true });
    }
  });
});
