import {
  DeleteObjectCommand,
  S3Client,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import 'multer';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import mime from 'mime-types';
// @ts-ignore
import { getExtension } from 'mime';
import { IUploadProvider } from './upload.interface';
import axios from 'axios';
import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import { basename } from 'path';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { fromBuffer, fromFile } = require('file-type');

const ALLOWED_MIME_TYPES = new Set<string>([
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

class CloudflareStorage implements IUploadProvider {
  private _client: S3Client;

  constructor(
    accountID: string,
    accessKey: string,
    secretKey: string,
    private region: string,
    private _bucketName: string,
    private _uploadUrl: string
  ) {
    this._client = new S3Client({
      endpoint: `https://${accountID}.r2.cloudflarestorage.com`,
      region,
      credentials: {
        accessKeyId: accessKey,
        secretAccessKey: secretKey,
      },
      requestChecksumCalculation: 'WHEN_REQUIRED',
    });

    this._client.middlewareStack.add(
      (next) =>
        async (args): Promise<any> => {
          const request = args.request as RequestInit;

          // Remove checksum headers
          const headers = request.headers as Record<string, string>;
          delete headers['x-amz-checksum-crc32'];
          delete headers['x-amz-checksum-crc32c'];
          delete headers['x-amz-checksum-sha1'];
          delete headers['x-amz-checksum-sha256'];
          request.headers = headers;

          Object.entries(request.headers).forEach(
            // @ts-ignore
            ([key, value]: [string, string]): void => {
              if (!request.headers) {
                request.headers = {};
              }
              (request.headers as Record<string, string>)[key] = value;
            }
          );

          return next(args);
        },
      { step: 'build', name: 'customHeaders' }
    );
  }

  async uploadSimple(path: string) {
    const loadImage = await fetch(path);
    const body = Buffer.from(await loadImage.arrayBuffer());
    const detected = await fromBuffer(body);
    if (!detected || !ALLOWED_MIME_TYPES.has(detected.mime)) {
      throw new Error('Unsupported file type.');
    }
    const extension = detected.ext;
    const safeContentType = detected.mime;
    const id = makeId(10);

    const params = {
      Bucket: this._bucketName,
      Key: `${id}.${extension}`,
      Body: body,
      ContentType: safeContentType,
      ChecksumMode: 'DISABLED',
    };

    const command = new PutObjectCommand({ ...params });
    await this._client.send(command);

    return `${this._uploadUrl}/${id}.${extension}`;
  }

  async uploadFile(file: Express.Multer.File): Promise<any> {
    try {
      const detected = await fromBuffer(file.buffer);
      if (!detected || !ALLOWED_MIME_TYPES.has(detected.mime)) {
        throw new Error('Unsupported file type.');
      }
      const id = makeId(10);
      const extension = detected.ext;
      const safeContentType = detected.mime;

      // Create the PutObjectCommand to upload the file to Cloudflare R2
      const command = new PutObjectCommand({
        Bucket: this._bucketName,
        ACL: 'public-read',
        Key: `${id}.${extension}`,
        Body: file.buffer,
        ContentType: safeContentType,
      });

      await this._client.send(command);

      return {
        filename: `${id}.${extension}`,
        mimetype: file.mimetype,
        size: file.size,
        buffer: file.buffer,
        originalname: `${id}.${extension}`,
        fieldname: 'file',
        path: `${this._uploadUrl}/${id}.${extension}`,
        destination: `${this._uploadUrl}/${id}.${extension}`,
        encoding: '7bit',
        stream: file.buffer as any,
      };
    } catch (err) {
      console.error('Error uploading file to Cloudflare R2:', err);
      throw err;
    }
  }

  async uploadFromPath(filePath: string, originalName: string) {
    const detected = await fromFile(filePath);
    if (!detected || !ALLOWED_MIME_TYPES.has(detected.mime)) {
      throw new Error('Unsupported file type.');
    }

    const file = await stat(filePath);
    if (!file.isFile() || file.size <= 0) {
      throw new Error('Upload file is empty.');
    }

    const id = makeId(10);
    const filename = `${id}.${detected.ext}`;
    await this._client.send(
      new PutObjectCommand({
        Bucket: this._bucketName,
        Key: filename,
        Body: createReadStream(filePath),
        ContentLength: file.size,
        ContentType: detected.mime,
      })
    );

    const safeOriginalName =
      basename(originalName || `edited-video.${detected.ext}`)
        .replace(/[^a-zA-Z0-9._-]+/g, '_')
        .slice(0, 120) || `edited-video.${detected.ext}`;

    return {
      filename,
      path: `${this._uploadUrl.replace(/\/+$/, '')}/${filename}`,
      mimetype: detected.mime,
      originalname: safeOriginalName,
      size: file.size,
    };
  }

  async removeFile(filePath: string): Promise<void> {
    const uploadUrl = new URL(
      this._uploadUrl.endsWith('/') ? this._uploadUrl : `${this._uploadUrl}/`
    );
    const targetUrl = new URL(filePath);
    if (
      targetUrl.origin !== uploadUrl.origin ||
      !targetUrl.pathname.startsWith(uploadUrl.pathname)
    ) {
      throw new Error('Cloudflare upload path is invalid.');
    }

    const key = decodeURIComponent(
      targetUrl.pathname.slice(uploadUrl.pathname.length)
    );
    if (!key || key.includes('/') || key.includes('\0')) {
      throw new Error('Cloudflare upload path is invalid.');
    }

    await this._client.send(
      new DeleteObjectCommand({
        Bucket: this._bucketName,
        Key: key,
      })
    );
  }
}

export { CloudflareStorage };
export default CloudflareStorage;
