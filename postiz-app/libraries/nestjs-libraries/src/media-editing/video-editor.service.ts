import { BadRequestException, HttpException, Injectable, InternalServerErrorException, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { basename, extname } from 'path';
import { MediaRepository } from '../database/prisma/media/media.repository';
import { MediaTranscriptionRepository } from '../database/prisma/media-transcription/media-transcription.repository';
import { UploadFactory } from '../upload/upload.factory';
import { UploadedFileReceipt } from '../upload/upload.interface';
import { CreateVideoEditDto } from '../dtos/media/create-video-edit.dto';
import { FfmpegVideoEditorService, VideoEditingError } from './ffmpeg-video-editor.service';
import { PACING_SETTINGS, VideoEditDecisionError } from './video-edit-decision';
import { prepareEditorSource } from './video-editor-source';

@Injectable()
export class VideoEditorService {
  private readonly storage = UploadFactory.createStorage();
  private readonly logger = new Logger(VideoEditorService.name);
  // Admission limit is per backend process, not a durable job/duplicate lock.
  private active = false;
  constructor(private readonly media: MediaRepository, private readonly transcripts: MediaTranscriptionRepository, private readonly editor: FfmpegVideoEditorService) {}

  async create(organizationId: string, mediaId: string, body: CreateVideoEditDto) {
    if (!body || body.schemaVersion !== 1 || Object.keys(body).some((key) => !['schemaVersion', 'pacingPreset'].includes(key)) ||
        (body.pacingPreset !== undefined && !Object.prototype.hasOwnProperty.call(PACING_SETTINGS, body.pacingPreset))) {
      throw new BadRequestException({ code: 'INVALID_EDIT_REQUEST', message: 'Use schemaVersion 1 and tight, balanced or relaxed pacing.' });
    }
    const source = await this.media.getMediaByOrganizationIdAndId(organizationId, mediaId);
    if (!source) throw new NotFoundException({ code: 'MEDIA_NOT_FOUND', message: 'Media not found.' });
    if (source.type !== 'video') throw new BadRequestException({ code: 'UNSUPPORTED_SOURCE', message: 'Select a video source.' });
    if (this.active) throw new HttpException({ code: 'RENDER_BUSY', message: 'Another render is running. Try again later.' }, 429);
    this.active = true;
    let prepared: Awaited<ReturnType<typeof prepareEditorSource>> | undefined;
    let rendered: Awaited<ReturnType<FfmpegVideoEditorService['render']>> | undefined;
    let uploaded: UploadedFileReceipt | undefined;
    try {
      const transcript = await this.transcripts.getCurrentForActiveMedia(organizationId, mediaId);
      try { prepared = await prepareEditorSource(source.path, source.originalName || source.name); }
      catch { throw new UnprocessableEntityException({ code: 'SOURCE_UNAVAILABLE', message: 'The source could not be prepared for editing.' }); }
      const editDecisionList = await this.editor.analyzeTalkingHeadVideo({
        inputPath: prepared.inputPath, mediaId, pacingPreset: body.pacingPreset || 'balanced',
        transcription: transcript?.status === 'READY' ? { id: transcript.id, generation: transcript.generation, alignment: 'none' } : null,
      });
      rendered = await this.editor.render(prepared.inputPath, editDecisionList);
      // Revalidate active ownership after expensive work, before storing an output.
      if (!await this.media.getMediaByOrganizationIdAndId(organizationId, mediaId)) throw new NotFoundException({ code: 'MEDIA_NOT_FOUND', message: 'Source was removed during editing.' });
      const name = basename(source.originalName || source.name);
      const originalName = `${name.slice(0, name.length - extname(name).length).slice(0, 180)}-edited.mp4`;
      uploaded = await this.storage.uploadFromPath(rendered.outputPath, originalName);
      const outputMedia = await this.media.saveFile(organizationId, uploaded.filename, uploaded.path, uploaded.originalname, uploaded.mimetype);
      uploaded = undefined;
      return { schemaVersion: 1 as const, outputMedia, editDecisionList,
        render: { status: 'completed' as const, durationMs: rendered.durationMs, container: 'mp4' as const, videoCodec: 'h264' as const, audioCodec: 'aac' as const } };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      if (error instanceof VideoEditingError || error instanceof VideoEditDecisionError) throw new UnprocessableEntityException({ code: error.code, message: error.message });
      throw new InternalServerErrorException({ code: 'EDIT_FAILED', message: 'The edited video could not be saved.' });
    } finally {
      // Cleanup must never replace a successful result or the original error.
      for (const cleanup of [uploaded?.rollback, rendered?.cleanup, prepared?.cleanup]) {
        if (cleanup) await cleanup().catch(() => this.logger.warn(`Video edit artifact cleanup failed; generated key: ${uploaded?.filename || 'temporary file'}`));
      }
      this.active = false;
    }
  }
}
