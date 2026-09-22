import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { MediaTranscriptionStatus } from '@prisma/client';
import { lookup } from 'mime-types';
import { TemporalService } from 'nestjs-temporal-core';
import { CopyGenerationModelService } from '@gitroom/nestjs-libraries/copy-generation/copy-generation.model.service';
import { prepareVideoMediaFile } from '@gitroom/nestjs-libraries/copy-generation/video-media-file';
import { MediaTranscriptionRepository } from '@gitroom/nestjs-libraries/database/prisma/media-transcription/media-transcription.repository';

export type TranscriptionLifecycleCode =
  | 'TRANSCRIPTION_PENDING'
  | 'TRANSCRIPTION_FAILED'
  | 'TRANSCRIPTION_SOURCE_UNAVAILABLE';

export class TranscriptionLifecycleError extends Error {
  constructor(
    public readonly code: TranscriptionLifecycleCode,
    message: string
  ) {
    super(message);
    this.name = 'TranscriptionLifecycleError';
  }
}

export const getMediaTranscriptionWorkflowId = (
  transcriptionId: string,
  generation: number
) => `media-transcription-${transcriptionId}-${generation}`;

@Injectable()
export class MediaTranscriptionService {
  private readonly logger = new Logger(MediaTranscriptionService.name);

  constructor(
    private readonly _repository: MediaTranscriptionRepository,
    private readonly _temporalService: TemporalService,
    private readonly _copyGenerationModelService: CopyGenerationModelService
  ) {}

  async ensureTranscriptionStarted(organizationId: string, mediaId: string) {
    const transcription =
      await this._repository.ensurePendingForActiveMedia(
        organizationId,
        mediaId
      );

    if (!transcription) {
      throw new NotFoundException('Media not found');
    }

    if (transcription.status === MediaTranscriptionStatus.PENDING) {
      await this.startPendingWorkflow(transcription);
    }

    return this.toPublicStatus(transcription);
  }

  getStatus(organizationId: string, mediaId: string) {
    return this.ensureTranscriptionStarted(organizationId, mediaId);
  }

  async retry(organizationId: string, mediaId: string) {
    const transcription =
      await this._repository.retryFailedForActiveMedia(organizationId, mediaId);

    if (!transcription) {
      throw new NotFoundException('Media not found');
    }

    if (transcription.status === MediaTranscriptionStatus.PENDING) {
      await this.startPendingWorkflow(transcription);
    }

    return this.toPublicStatus(transcription);
  }

  async resolveForGeneration(organizationId: string, mediaId: string) {
    let transcription: Awaited<
      ReturnType<MediaTranscriptionService['ensureTranscriptionStarted']>
    >;
    try {
      transcription = await this.ensureTranscriptionStarted(
        organizationId,
        mediaId
      );
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw new TranscriptionLifecycleError(
          'TRANSCRIPTION_SOURCE_UNAVAILABLE',
          'The source video is no longer available. Select or upload it again before generating captions.'
        );
      }
      throw error;
    }

    if (
      transcription.status === MediaTranscriptionStatus.PENDING ||
      transcription.status === MediaTranscriptionStatus.PROCESSING
    ) {
      throw new TranscriptionLifecycleError(
        'TRANSCRIPTION_PENDING',
        'The video is still being transcribed. You can keep choosing destinations and retry generation shortly.'
      );
    }

    if (transcription.status === MediaTranscriptionStatus.FAILED) {
      throw new TranscriptionLifecycleError(
        'TRANSCRIPTION_FAILED',
        transcription.error?.message ||
          'The video could not be transcribed. Retry transcription before generating captions.'
      );
    }

    return transcription.text?.trim() || undefined;
  }

  async deleteMedia(organizationId: string, mediaId: string) {
    const result = await this._repository.deleteMediaLifecycle(
      organizationId,
      mediaId
    );

    if (!result) {
      throw new NotFoundException('Media not found');
    }

    if (result.transcription) {
      const workflowId = getMediaTranscriptionWorkflowId(
        result.transcription.id,
        result.transcription.generation
      );
      try {
        await this._temporalService.cancelWorkflow(workflowId);
      } catch {
        this.logger.debug(
          `Transcription workflow ${workflowId} was not running when media was deleted.`
        );
      }
    }

    return { id: mediaId, deleted: true };
  }

  async processTranscription(transcriptionId: string, generation: number) {
    await this._repository.claimForProcessing(transcriptionId, generation);

    const active = await this._repository.getActiveWorkerInput(
      transcriptionId,
      generation
    );
    if (!active) {
      return { discarded: true };
    }

    let preparedVideo:
      | Awaited<ReturnType<typeof prepareVideoMediaFile>>
      | undefined;
    let text = '';

    try {
      preparedVideo = await prepareVideoMediaFile(
        active.media.path,
        active.media.originalName || active.media.name
      );
      const mimeType = `${
        lookup(active.media.originalName || '') ||
        lookup(active.media.name || '') ||
        lookup(active.media.path || '') ||
        'video/mp4'
      }`;
      const result = await this._copyGenerationModelService.transcribeVideo({
        inputPath: preparedVideo.inputPath,
        mimeType,
        originalName: active.media.originalName || active.media.name,
      });
      text = result.text?.trim() || '';
    } finally {
      await preparedVideo?.cleanup();
    }

    if (!text) {
      const stored = await this._repository.completeIfActive(
        transcriptionId,
        generation,
        null
      );
      return { discarded: !stored, status: 'READY' as const };
    }

    const stored = await this._repository.completeIfActive(
      transcriptionId,
      generation,
      text
    );
    return { discarded: !stored, status: 'READY' as const };
  }

  async failTranscription(transcriptionId: string, generation: number) {
    const stored = await this._repository.failIfPendingOrProcessing(
      transcriptionId,
      generation,
      'TRANSCRIPTION_FAILED',
      'The video could not be transcribed. Please retry.'
    );
    return { discarded: !stored, status: 'FAILED' as const };
  }

  private async startPendingWorkflow(transcription: {
    id: string;
    generation: number;
  }) {
    const workflowId = getMediaTranscriptionWorkflowId(
      transcription.id,
      transcription.generation
    );

    try {
      await this._temporalService.client
        .getRawClient()
        ?.workflow.start('mediaTranscriptionWorkflow', {
          workflowId,
          workflowIdReusePolicy: 'ALLOW_DUPLICATE_FAILED_ONLY',
          taskQueue: 'main',
          args: [
            {
              transcriptionId: transcription.id,
              generation: transcription.generation,
            },
          ],
        });
    } catch (error) {
      const message = error instanceof Error ? error.message : `${error}`;
      if (!/already started|already exists|duplicate/i.test(message)) {
        this.logger.warn(
          `Could not start transcription workflow ${workflowId}; a later ensure call will retry.`
        );
      }
    }
  }

  private toPublicStatus(transcription: {
    id: string;
    mediaId: string;
    generation: number;
    status: MediaTranscriptionStatus;
    text: string | null;
    errorCode: string | null;
    errorMessage: string | null;
    requestedAt: Date;
    startedAt: Date | null;
    completedAt: Date | null;
  }) {
    return {
      id: transcription.id,
      mediaId: transcription.mediaId,
      generation: transcription.generation,
      status: transcription.status,
      text:
        transcription.status === MediaTranscriptionStatus.READY
          ? transcription.text
          : null,
      error:
        transcription.status === MediaTranscriptionStatus.FAILED
          ? {
              code: transcription.errorCode || 'TRANSCRIPTION_FAILED',
              message:
                transcription.errorMessage ||
                'The video could not be transcribed. Please retry.',
            }
          : null,
      requestedAt: transcription.requestedAt,
      startedAt: transcription.startedAt,
      completedAt: transcription.completedAt,
    };
  }
}
