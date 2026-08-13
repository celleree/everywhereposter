import { IUploadProvider } from './upload.interface';
import { mkdirSync, writeFileSync } from 'fs';
import { copyFile, mkdir, rm, stat } from 'fs/promises';
// @ts-ignore
import mime from 'mime';
import { basename, resolve, sep } from 'path';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { fromBuffer, fromFile } = require('file-type');

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

  async uploadFromPath(filePath: string, originalName: string) {
    const detected = await fromFile(filePath);
    if (!detected || !LOCAL_STORAGE_ALLOWED_MIME.has(detected.mime)) {
      throw new Error('Unsupported file type.');
    }

    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const innerPath = `/${year}/${month}/${day}`;
    const directory = `${this.uploadDirectory}${innerPath}`;
    await mkdir(directory, { recursive: true });

    const randomName = Array(32)
      .fill(null)
      .map(() => Math.round(Math.random() * 16).toString(16))
      .join('');
    const filename = `${randomName}.${detected.ext}`;
    const destinationPath = `${directory}/${filename}`;

    try {
      await copyFile(filePath, destinationPath);
      const file = await stat(destinationPath);
      const safeOriginalName =
        basename(originalName || `edited-video.${detected.ext}`)
          .replace(/[^a-zA-Z0-9._-]+/g, '_')
          .slice(0, 120) || `edited-video.${detected.ext}`;

      return {
        filename,
        path:
          process.env.FRONTEND_URL + '/uploads' + `${innerPath}/${filename}`,
        mimetype: detected.mime,
        originalname: safeOriginalName,
        size: file.size,
      };
    } catch (error) {
      await rm(destinationPath, { force: true });
      throw error;
    }
  }

  async removeFile(filePath: string): Promise<void> {
    let pathname = filePath;
    try {
      pathname = new URL(filePath).pathname;
    } catch {}

    const uploadMarker = '/uploads/';
    const markerIndex = pathname.indexOf(uploadMarker);
    if (markerIndex < 0) {
      throw new Error('Local upload path is invalid.');
    }

    const relativePath = decodeURIComponent(
      pathname.slice(markerIndex + uploadMarker.length)
    );
    const uploadRoot = resolve(this.uploadDirectory);
    const targetPath = resolve(uploadRoot, relativePath);
    if (
      !relativePath ||
      relativePath.includes('\0') ||
      targetPath === uploadRoot ||
      !targetPath.startsWith(`${uploadRoot}${sep}`)
    ) {
      throw new Error('Local upload path is invalid.');
    }

    await rm(targetPath, { force: true });
  }
}
