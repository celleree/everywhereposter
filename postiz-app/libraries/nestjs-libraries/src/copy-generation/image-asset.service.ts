import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { execFile } from 'child_process';
import { mkdtemp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { promisify } from 'util';
import sharp from 'sharp';
import { Organization } from '@prisma/client';
import { MediaRepository } from '@gitroom/nestjs-libraries/database/prisma/media/media.repository';
import { MediaService } from '@gitroom/nestjs-libraries/database/prisma/media/media.service';
import { prepareVideoMediaFile } from '@gitroom/nestjs-libraries/copy-generation/video-media-file';
import { UploadFactory } from '@gitroom/nestjs-libraries/upload/upload.factory';
import { RenderImagePlansDto } from '@gitroom/nestjs-libraries/dtos/copy-generation/render.image.plans.dto';
import {
  ImagePlanAspectRatio,
  ImagePlanItem,
} from '@gitroom/nestjs-libraries/dtos/copy-generation/generate.media.copy.response';
import {
  RenderedImagePlanResult,
  RenderImagePlansResponse,
} from '@gitroom/nestjs-libraries/dtos/copy-generation/render.image.plans.response';

const execFileAsync = promisify(execFile);
const FFMPEG_IMAGE_TIMEOUT_MS = 30_000;

type ImageDimensions = { width: number; height: number };
const IMAGE_DIMENSIONS: Record<ImagePlanAspectRatio, ImageDimensions> = {
  '1:1': { width: 1080, height: 1080 },
  '4:5': { width: 1080, height: 1350 },
  '16:9': { width: 1600, height: 900 },
  '9:16': { width: 1080, height: 1920 },
};

@Injectable()
export class ImageAssetService {
  protected storage = UploadFactory.createStorage();

  constructor(
    private readonly _mediaRepository: MediaRepository,
    private readonly _mediaService: MediaService
  ) {}

  async render(
    org: Organization,
    body: RenderImagePlansDto
  ): Promise<RenderImagePlansResponse> {
    const sourceMedia =
      await this._mediaRepository.getMediaByOrganizationIdAndId(
        org.id,
        body.mediaId
      );

    if (!sourceMedia) {
      throw new NotFoundException('Source media not found.');
    }
    if (sourceMedia.type !== 'video') {
      throw new BadRequestException(
        'Image-plan rendering currently requires an uploaded video source.'
      );
    }

    let prepared:
      | Awaited<ReturnType<typeof prepareVideoMediaFile>>
      | undefined;
    let preparationPromise:
      | ReturnType<typeof prepareVideoMediaFile>
      | undefined;
    let preparationError: unknown;

    const getVideoPath = async () => {
      if (preparationError) throw preparationError;
      try {
        preparationPromise ||= prepareVideoMediaFile(
          sourceMedia.path,
          sourceMedia.originalName || sourceMedia.name
        );
        prepared = await preparationPromise;
        return prepared.inputPath;
      } catch (error) {
        preparationError = error;
        throw error;
      }
    };

    const results: RenderedImagePlanResult[] = [];
    try {
      for (const plan of body.imagePlans) {
        const dimensions = IMAGE_DIMENSIONS[plan.aspectRatio];
        try {
          this.validatePlan(plan);
          const needsVideo =
            plan.type === 'video_frame' || plan.type === 'thumbnail';
          const buffer = await this.renderPlanBuffer(
            plan,
            org,
            dimensions,
            needsVideo ? await getVideoPath() : undefined
          );
          const media = await this.persistAsset(org, plan, buffer);
          results.push({
            planId: plan.id,
            platform: plan.platform,
            type: plan.type,
            aspectRatio: plan.aspectRatio,
            status: 'completed',
            width: dimensions.width,
            height: dimensions.height,
            mimeType: 'image/png',
            media,
          });
        } catch (error: any) {
          results.push({
            planId: plan.id,
            platform: plan.platform,
            type: plan.type,
            aspectRatio: plan.aspectRatio,
            status: 'failed',
            error: {
              code: 'IMAGE_ASSET_RENDER_FAILED',
              message: error?.message || 'Image asset rendering failed.',
            },
          });
        }
      }
    } finally {
      await prepared?.cleanup();
    }

    const completed = results.filter((item) => item.status === 'completed').length;
    return {
      mediaId: body.mediaId,
      status:
        completed === results.length
          ? 'complete'
          : completed > 0
          ? 'partial'
          : 'failed',
      results,
    };
  }

  protected async renderPlanBuffer(
    plan: ImagePlanItem,
    org: Organization,
    dimensions: ImageDimensions,
    videoPath?: string
  ): Promise<Buffer> {
    switch (plan.type) {
      case 'video_frame':
        return this.extractVideoFrame(
          videoPath!,
          plan.sourceTimestampSeconds!,
          dimensions
        );
      case 'quote_card':
        return this.renderQuoteCard(plan, dimensions);
      case 'ai_visual':
        return this.renderAiVisual(plan, org, dimensions);
      case 'thumbnail':
        return this.renderThumbnail(videoPath!, plan, dimensions);
    }
  }

  protected async renderAiVisual(
    plan: ImagePlanItem,
    org: Organization,
    dimensions: ImageDimensions
  ) {
    const prompt = `${plan.visualPrompt!.trim()}\n\nCreate a clean platform-ready image. Do not render captions, headlines, logos, watermarks, or unsupported text.`;
    const vertical = plan.aspectRatio === '4:5' || plan.aspectRatio === '9:16';
    const generated = await this._mediaService.generateImage(
      prompt,
      org,
      false,
      vertical
    );
    if (!generated) throw new Error('The image provider returned no image.');

    return sharp(Buffer.from(generated, 'base64'))
      .resize(dimensions.width, dimensions.height, { fit: 'cover' })
      .png({ compressionLevel: 9 })
      .toBuffer();
  }

  protected async renderQuoteCard(
    plan: ImagePlanItem,
    dimensions: ImageDimensions
  ) {
    const headline =
      plan.headline?.trim() ||
      plan.sourceQuote?.trim() ||
      plan.title?.trim() ||
      plan.visualSummary.trim();
    const lines = this.wrapText(
      headline,
      plan.aspectRatio === '16:9' ? 38 : 25,
      plan.aspectRatio === '9:16' ? 6 : 5
    );
    const padding = Math.round(dimensions.width * 0.08);
    const fontSize = Math.round(
      dimensions.width * (plan.aspectRatio === '16:9' ? 0.055 : 0.074)
    );
    const lineHeight = Math.round(fontSize * 1.14);
    const startY = Math.round(
      dimensions.height * 0.44 - ((lines.length - 1) * lineHeight) / 2
    );
    const subheadline = plan.subheadline?.trim();
    const svg = `<svg width="${dimensions.width}" height="${dimensions.height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#090F1D"/><stop offset="55%" stop-color="#121A2D"/><stop offset="100%" stop-color="#241B45"/>
        </linearGradient>
        <radialGradient id="glow"><stop offset="0%" stop-color="#7C3AED" stop-opacity="0.48"/><stop offset="100%" stop-color="#7C3AED" stop-opacity="0"/></radialGradient>
      </defs>
      <rect width="100%" height="100%" fill="url(#bg)"/>
      <circle cx="${Math.round(dimensions.width * 0.82)}" cy="${Math.round(
      dimensions.height * 0.18
    )}" r="${Math.round(dimensions.width * 0.42)}" fill="url(#glow)"/>
      <rect x="${padding}" y="${Math.round(
      dimensions.height * 0.24
    )}" width="${Math.round(dimensions.width * 0.12)}" height="6" rx="3" fill="#8B5CF6"/>
      <text x="${padding}" y="${startY}" fill="#F8FAFC" font-family="Arial, Helvetica, sans-serif" font-size="${fontSize}" font-weight="700">${this.tspans(
      lines,
      padding,
      lineHeight
    )}</text>
      ${
        subheadline
          ? `<text x="${padding}" y="${Math.round(
              startY + lines.length * lineHeight + dimensions.height * 0.06
            )}" fill="#CBD5E1" font-family="Arial, Helvetica, sans-serif" font-size="${Math.round(
              dimensions.width * 0.032
            )}">${this.tspans(
              this.wrapText(subheadline, plan.aspectRatio === '16:9' ? 58 : 36, 3),
              padding,
              Math.round(dimensions.width * 0.044)
            )}</text>`
          : ''
      }
    </svg>`;
    return sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
  }

  protected async renderThumbnail(
    inputPath: string,
    plan: ImagePlanItem,
    dimensions: ImageDimensions
  ) {
    const frame = await this.extractVideoFrame(
      inputPath,
      plan.sourceTimestampSeconds!,
      dimensions
    );
    const headline =
      plan.headline?.trim() || plan.title?.trim() || plan.visualSummary.trim();
    const padding = Math.round(dimensions.width * 0.06);
    const fontSize = Math.round(
      dimensions.width * (plan.aspectRatio === '16:9' ? 0.055 : 0.075)
    );
    const lineHeight = Math.round(fontSize * 1.1);
    const lines = this.wrapText(
      headline,
      plan.aspectRatio === '16:9' ? 34 : 23,
      3
    );
    const startY = Math.round(
      dimensions.height - padding - (lines.length - 1) * lineHeight
    );
    const overlay = `<svg width="${dimensions.width}" height="${dimensions.height}" xmlns="http://www.w3.org/2000/svg">
      <defs><linearGradient id="shade" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#000" stop-opacity="0"/><stop offset="55%" stop-color="#000" stop-opacity="0.12"/><stop offset="100%" stop-color="#000" stop-opacity="0.88"/></linearGradient></defs>
      <rect width="100%" height="100%" fill="url(#shade)"/>
      <text x="${padding}" y="${startY}" fill="#FFF" stroke="#000" stroke-opacity="0.45" stroke-width="2" paint-order="stroke" font-family="Arial, Helvetica, sans-serif" font-size="${fontSize}" font-weight="700">${this.tspans(
      lines,
      padding,
      lineHeight
    )}</text>
    </svg>`;
    return sharp(frame)
      .composite([{ input: Buffer.from(overlay), top: 0, left: 0 }])
      .png({ compressionLevel: 9 })
      .toBuffer();
  }

  protected async extractVideoFrame(
    inputPath: string,
    timestampSeconds: number,
    dimensions: ImageDimensions
  ) {
    const directory = await mkdtemp(join(tmpdir(), 'postiz-image-asset-'));
    const outputPath = join(directory, 'frame.jpg');
    try {
      await this.runMediaCommand(
        'ffmpeg',
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-ss',
          timestampSeconds.toFixed(3),
          '-i',
          inputPath,
          '-frames:v',
          '1',
          '-an',
          '-vf',
          `scale=${dimensions.width}:${dimensions.height}:force_original_aspect_ratio=increase,crop=${dimensions.width}:${dimensions.height},format=yuvj420p`,
          '-q:v',
          '3',
          '-y',
          outputPath,
        ],
        { maxBuffer: 2 * 1024 * 1024, timeout: FFMPEG_IMAGE_TIMEOUT_MS }
      );
      const buffer = await readFile(outputPath);
      if (!buffer.byteLength) {
        throw new Error('Video frame extraction returned an empty image.');
      }
      return buffer;
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  protected runMediaCommand(
    command: string,
    args: string[],
    options: { maxBuffer: number; timeout: number }
  ) {
    return execFileAsync(command, args, options);
  }

  private validatePlan(plan: ImagePlanItem) {
    if (
      (plan.type === 'video_frame' || plan.type === 'thumbnail') &&
      (typeof plan.sourceTimestampSeconds !== 'number' ||
        !Number.isFinite(plan.sourceTimestampSeconds) ||
        plan.sourceTimestampSeconds < 0)
    ) {
      throw new Error(`${plan.type} requires a grounded source timestamp.`);
    }
    if (plan.type === 'ai_visual' && !plan.visualPrompt?.trim()) {
      throw new Error('ai_visual requires a visual prompt.');
    }
  }

  private async persistAsset(
    org: Organization,
    plan: ImagePlanItem,
    buffer: Buffer
  ) {
    const path = await this.storage.uploadSimple(
      `data:image/png;base64,${buffer.toString('base64')}`
    );
    const fileName = path.split('/').pop() || `${plan.id}.png`;
    const originalName = `${plan.platform}-${plan.type}-${plan.id}.png`
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-');
    const saved = await this._mediaService.saveFile(
      org.id,
      fileName,
      path,
      originalName,
      'image/png'
    );
    return this._mediaService.saveMediaInformation(
      org.id,
      {
        id: saved.id,
        alt: plan.altText?.trim() || plan.visualSummary.trim(),
      } as any
    );
  }

  private wrapText(value: string, maxCharacters: number, maxLines: number) {
    if (maxCharacters < 1 || maxLines < 1) return [''];

    const words = value.trim().replace(/\s+/g, ' ').split(' ').filter(Boolean);
    const tokens = words.flatMap((word) => {
      if (word.length <= maxCharacters) return [word];

      const chunks: string[] = [];
      for (let index = 0; index < word.length; index += maxCharacters) {
        chunks.push(word.slice(index, index + maxCharacters));
      }
      return chunks;
    });
    const lines: string[] = [];
    let current = '';
    let consumed = 0;

    for (const token of tokens) {
      const candidate = current ? `${current} ${token}` : token;
      if (candidate.length <= maxCharacters) {
        current = candidate;
        consumed += 1;
        continue;
      }

      if (current) {
        lines.push(current);
        if (lines.length >= maxLines) {
          current = '';
          break;
        }
      }

      current = token;
      consumed += 1;
      if (lines.length === maxLines - 1) break;
    }

    if (current && lines.length < maxLines) lines.push(current);
    if (consumed < tokens.length && lines.length) {
      const lastIndex = lines.length - 1;
      const lastLine = lines[lastIndex].replace(/[.\s]+$/, '');
      lines[lastIndex] = `${lastLine.slice(0, Math.max(0, maxCharacters - 1))}…`;
    }
    return lines.length ? lines : [''];
  }

  private tspans(lines: string[], x: number, lineHeight: number) {
    return lines
      .map(
        (line, index) =>
          `<tspan x="${x}" dy="${index ? lineHeight : 0}">${this.escapeXml(
            line
          )}</tspan>`
      )
      .join('');
  }

  private escapeXml(value: string) {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
}
