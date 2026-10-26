import { IUploadProvider, StudioOutputIntent, studioOutputKey, verifyStudioFile } from './upload.interface';
import { mkdirSync, unlink, writeFileSync } from 'fs';
// @ts-ignore
import mime from 'mime';
import { extname } from 'path';
import { randomUUID } from 'crypto';
import { copyFile, mkdir, rm, link, lstat, realpath } from 'fs/promises';
import { constants } from 'fs';
import { join } from 'path';
import { assertRenderedVideoFile } from './rendered-video-file';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { fromBuffer } = require('file-type');

const LOCAL_STORAGE_ALLOWED_MIME = new Set<string>([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/bmp',
  'image/tiff',
  'video/mp4',
  'video/quicktime',
]);
export class LocalStorage implements IUploadProvider {
  constructor(private uploadDirectory: string) {}

  async storeStudioOutput(path: string, intent: StudioOutputIntent) {
    const key = studioOutputKey(intent);
    await verifyStudioFile(path, intent);
    const root = await realpath(this.uploadDirectory);
    const parts = key.split('/'); let directory = root;
    for (const part of parts.slice(0, -1)) {
      directory = join(directory, part);
      await mkdir(directory, { recursive: true });
      const info = await lstat(directory);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Unsafe Studio output directory');
    }
    const destination = join(directory, parts.at(-1)!);
    const temporary = join(directory, `.studio-${randomUUID()}.tmp`);
    try {
      await copyFile(path, temporary, constants.COPYFILE_EXCL);
      await verifyStudioFile(temporary, intent);
      try { await link(temporary, destination); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
      const info = await lstat(destination);
      if (!info.isFile() || info.isSymbolicLink()) throw new Error('Unsafe Studio output file');
      await verifyStudioFile(destination, intent);
      return { key, path: `${process.env.FRONTEND_URL}/uploads/${key}`, sha256: intent.sha256, bytes: intent.bytes };
    } finally { await rm(temporary, { force: true }); }
  }

  async uploadFromPath(path: string, originalName: string) {
    await assertRenderedVideoFile(path);
    const now = new Date();
    const innerPath = `/${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')}`;
    const filename = `${randomUUID()}.mp4`;
    const destination = join(this.uploadDirectory, innerPath, filename);
    await mkdir(join(this.uploadDirectory, innerPath), { recursive: true });
    const rollback = () => rm(destination, { force: true });
    try { await copyFile(path, destination, constants.COPYFILE_EXCL); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') await rollback();
      throw error;
    }
    return { filename, originalname: originalName, mimetype: 'video/mp4' as const,
      path: `${process.env.FRONTEND_URL}/uploads${innerPath}/${filename}`, rollback };
  }

  async uploadSimple(path: string) {
    const loadImage = await fetch(path);
    const contentType =
      loadImage?.headers?.get('content-type') ||
      loadImage?.headers?.get('Content-Type');
    const findExtension = mime.getExtension(contentType) ||
      path.split('?')[0].split('#')[0].split('.').pop() ||
      'bin';

    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');

    const innerPath = `/${year}/${month}/${day}`;
    const dir = `${this.uploadDirectory}${innerPath}`;
    mkdirSync(dir, { recursive: true });

    const randomName = Array(32)
      .fill(null)
      .map(() => Math.round(Math.random() * 16).toString(16))
      .join('');

    const filePath = `${dir}/${randomName}.${findExtension}`;
    const publicPath = `${innerPath}/${randomName}.${findExtension}`;
    // Logic to save the file to the filesystem goes here
    writeFileSync(filePath, Buffer.from(await loadImage.arrayBuffer()));

    return process.env.FRONTEND_URL + '/uploads' + publicPath;
  }

  async uploadFile(file: Express.Multer.File): Promise<any> {
    try {
      const detected = await fromBuffer(file.buffer);
      if (!detected || !LOCAL_STORAGE_ALLOWED_MIME.has(detected.mime)) {
        throw new Error('Unsupported file type.');
      }
      const safeExt = `.${detected.ext}`;
      const safeMime = detected.mime;

      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');

      const innerPath = `/${year}/${month}/${day}`;
      const dir = `${this.uploadDirectory}${innerPath}`;
      mkdirSync(dir, { recursive: true });

      const randomName = Array(32)
        .fill(null)
        .map(() => Math.round(Math.random() * 16).toString(16))
        .join('');

      const filePath = `${dir}/${randomName}${safeExt}`;
      const publicPath = `${innerPath}/${randomName}${safeExt}`;

      writeFileSync(filePath, file.buffer);

      return {
        filename: `${randomName}${safeExt}`,
        path: process.env.FRONTEND_URL + '/uploads' + publicPath,
        mimetype: safeMime,
        originalname: `${randomName}${safeExt}`,
      };
    } catch (err) {
      console.error('Error uploading file to Local Storage:', err);
      throw err;
    }
  }

  async removeFile(filePath: string): Promise<void> {
    // Logic to remove the file from the filesystem goes here
    return new Promise((resolve, reject) => {
      unlink(filePath, (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }
}
