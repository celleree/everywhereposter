import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { MediaRepository } from '@gitroom/nestjs-libraries/database/prisma/media/media.repository';
import { OpenaiService } from '@gitroom/nestjs-libraries/openai/openai.service';
import { SubscriptionService } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service';
import { MediaTranscriptionStatus, Organization } from '@prisma/client';
import { basename } from 'path';
import { SaveMediaInformationDto } from '@gitroom/nestjs-libraries/dtos/media/save.media.information.dto';
import { VideoManager } from '@gitroom/nestjs-libraries/videos/video.manager';
import { VideoDto } from '@gitroom/nestjs-libraries/dtos/videos/video.dto';
import { UploadFactory } from '@gitroom/nestjs-libraries/upload/upload.factory';
import {
  AuthorizationActions,
  Sections,
  SubscriptionException,
} from '@gitroom/backend/services/auth/permissions/permission.exception.class';
import { MediaTranscriptionService } from '@gitroom/nestjs-libraries/database/prisma/media-transcription/media-transcription.service';
import {
  FfmpegVideoEditorService,
  VideoEditingError,
} from '@gitroom/nestjs-libraries/media-editing/ffmpeg-video-editor.service';
import { VideoEditDecisionError } from '@gitroom/nestjs-libraries/media-editing/video-edit-decision';
import {
  prepareVideoMediaFile,
  PreparedVideoMediaFile,
} from '@gitroom/nestjs-libraries/copy-generation/video-media-file';
import { VideoEditStylePlannerService } from '@gitroom/nestjs-libraries/media-editing/video-edit-style-planner.service';
import { toTalkingHeadStyleMetadata } from '@gitroom/nestjs-libraries/media-editing/talking-head-style';

@Injectable()
export class MediaService {
  private storage = UploadFactory.createStorage();
  private readonly logger = new Logger(MediaService.name);
  private activeTalkingHeadRenders = 0;

  constructor(
    private _mediaRepository: MediaRepository,
    private _openAi: OpenaiService,
    private _subscriptionService: SubscriptionService,
    private _videoManager: VideoManager,
    @Optional()
    private _mediaTranscriptionService?: MediaTranscriptionService,
    @Optional()
    private _ffmpegVideoEditor?: FfmpegVideoEditorService,
    @Optional()
    private _videoEditStylePlanner?: VideoEditStylePlannerService
  ) {}

  async deleteMedia(org: string, id: string) {
    if (this._mediaTranscriptionService) {
      return this._mediaTranscriptionService.deleteMedia(org, id);
    }
    return this._mediaRepository.deleteMedia(org, id);
  }

  getMediaById(id: string) {
    return this._mediaRepository.getMediaById(id);
  }

  getMediaByOrganizationIdAndId(org: string, id: string) {
    return this._mediaRepository.getMediaByOrganizationIdAndId(org, id);
  }

  async generateImage(
    prompt: string,
    org: Organization,
    generatePromptFirst?: boolean,
    isVertical = false,
    isHorizontal = false
  ) {
    const generate = async () => {
      if (generatePromptFirst) {
        prompt = await this._openAi.generatePromptForPicture(prompt);
        console.log('Prompt:', prompt);
      }
      return this._openAi.generateImage(
        prompt,
        !!generatePromptFirst,
        isVertical,
        isHorizontal
      );
    };

    if (!process.env.STRIPE_PUBLISHABLE_KEY) {
      return this._subscriptionService.useCredit(org, 'ai_images', generate);
    }

    const reservation = await this._subscriptionService.useCreditWithinLimit(
      org,
      'ai_images',
      generate
    );

    if (!reservation.allowed) {
      throw new SubscriptionException({
        action: AuthorizationActions.Create,
        section: Sections.AI,
      });
    }

    return reservation.value;
  }

  async saveFile(
    org: string,
    fileName: string,
    filePath: string,
    originalName?: string,
    mimeType?: string,
    guidedTranscription = false
  ) {
    const media = await this._mediaRepository.saveFile(
      org,
      fileName,
      filePath,
      originalName,
      mimeType
    );

    if (
      guidedTranscription &&
      media.type === 'video' &&
      this._mediaTranscriptionService
    ) {
      await this._mediaTranscriptionService.ensureTranscriptionStarted(
        org,
        media.id
      );
    }

    return media;
  }

  async createTalkingHeadEdit(
    org: string,
    mediaId: string,
    stylePrompt: string
  ) {
    const media = await this._mediaRepository.getMediaByOrganizationIdAndId(
      org,
      mediaId
    );
    if (!media) {
      throw new NotFoundException('Media not found');
    }
    if (media.type !== 'video') {
      throw new BadRequestException(
        'Talking-head editing requires a video source.'
      );
    }
    if (
      !this._mediaTranscriptionService ||
      !this._ffmpegVideoEditor ||
      !this._videoEditStylePlanner
    ) {
      throw new ServiceUnavailableException(
        'Talking-head editing is not available in this runtime.'
      );
    }

    const transcription = await this._mediaTranscriptionService.getStatus(
      org,
      mediaId
    );
    if (
      transcription.status === MediaTranscriptionStatus.PENDING ||
      transcription.status === MediaTranscriptionStatus.PROCESSING
    ) {
      throw new ConflictException(
        'The video is still being transcribed. Retry the edit when transcription is ready.'
      );
    }
    if (
      transcription.status === MediaTranscriptionStatus.FAILED ||
      !transcription.text?.trim()
    ) {
      throw new UnprocessableEntityException(
        transcription.error?.message ||
          'The video must have a usable transcript before it can be edited.'
      );
    }
    if (this.activeTalkingHeadRenders >= 1) {
      throw new HttpException(
        'Another Phase 1 talking-head render is already running. Retry shortly.',
        429
      );
    }

    this.activeTalkingHeadRenders += 1;
    let preparedVideo: PreparedVideoMediaFile | undefined;
    let renderedVideo:
      | Awaited<ReturnType<FfmpegVideoEditorService['render']>>
      | undefined;
    let uploadedPath: string | undefined;

    try {
      const stylePlan = await this._videoEditStylePlanner.plan({
        organizationId: org,
        stylePrompt,
      });

      try {
        preparedVideo = await prepareVideoMediaFile(
          media.path,
          media.originalName || media.name
        );
      } catch {
        throw new UnprocessableEntityException(
          'The source video could not be prepared for editing.'
        );
      }

      const editDecisionList =
        await this._ffmpegVideoEditor.analyzeTalkingHeadVideo({
          inputPath: preparedVideo.inputPath,
          mediaId,
          style: toTalkingHeadStyleMetadata(stylePlan),
          transcription: {
            id: transcription.id,
            generation: transcription.generation,
            text: transcription.text.trim(),
          },
        });
      renderedVideo = await this._ffmpegVideoEditor.render(
        preparedVideo.inputPath,
        editDecisionList
      );

      const uploaded = await this.storage.uploadFromPath(
        renderedVideo.outputPath,
        this.getEditedOriginalName(media.originalName || media.name)
      );
      uploadedPath = uploaded.path;
      const outputMedia = await this._mediaRepository.saveFile(
        org,
        uploaded.filename,
        uploaded.path,
        uploaded.originalname,
        uploaded.mimetype
      );
      uploadedPath = undefined;

      return {
        outputMedia,
        stylePlan,
        editDecisionList,
        render: {
          durationMs: renderedVideo.durationMs,
          container: 'mp4' as const,
          videoCodec: 'h264' as const,
          audioCodec: 'aac' as const,
        },
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      if (
        error instanceof VideoEditingError ||
        error instanceof VideoEditDecisionError
      ) {
        throw new UnprocessableEntityException({
          code: error.code,
          message: error.message,
        });
      }
      throw new InternalServerErrorException(
        'The edited video could not be saved.'
      );
    } finally {
      const cleanupTasks = [
        uploadedPath
          ? {
              name: 'uploaded derivative',
              action: this.storage.removeFile(uploadedPath),
            }
          : undefined,
        renderedVideo
          ? { name: 'render workspace', action: renderedVideo.cleanup() }
          : undefined,
        preparedVideo
          ? { name: 'prepared source', action: preparedVideo.cleanup() }
          : undefined,
      ].filter(
        (task): task is { name: string; action: Promise<void> } => !!task
      );
      const cleanupResults = await Promise.allSettled(
        cleanupTasks.map((task) => task.action)
      );
      const failedCleanup = cleanupResults.flatMap((result, index) =>
        result.status === 'rejected' ? [cleanupTasks[index].name] : []
      );
      if (failedCleanup.length) {
        this.logger.warn(
          `Talking-head cleanup failed for media ${mediaId}: ${failedCleanup.join(
            ', '
          )}`
        );
      }
      this.activeTalkingHeadRenders -= 1;
    }
  }

  private getEditedOriginalName(sourceName: string) {
    const name = basename(sourceName || 'talking-head-video')
      .replace(/\.[^.]+$/, '')
      .replace(/[^a-zA-Z0-9._-]+/g, '_')
      .slice(0, 90);
    return `${name || 'talking-head-video'}-edited.mp4`;
  }

  getMedia(org: string, page: number) {
    return this._mediaRepository.getMedia(org, page);
  }

  getPostAttachedMedia(org: string, page: number) {
    return this._mediaRepository.getPostAttachedMedia(org, page);
  }

  saveMediaInformation(org: string, data: SaveMediaInformationDto) {
    return this._mediaRepository.saveMediaInformation(org, data);
  }

  getVideoOptions() {
    return this._videoManager.getAllVideos();
  }

  async generateVideoAllowed(org: Organization, type: string) {
    const video = this._videoManager.getVideoByName(type);
    if (!video) {
      throw new Error(`Video type ${type} not found`);
    }

    if (!video.trial && org.isTrailing) {
      throw new HttpException('This video is not available in trial mode', 406);
    }

    return true;
  }

  async generateVideo(org: Organization, body: VideoDto) {
    const totalCredits = await this._subscriptionService.checkCredits(
      org,
      'ai_videos'
    );

    if (totalCredits.credits <= 0) {
      throw new SubscriptionException({
        action: AuthorizationActions.Create,
        section: Sections.VIDEOS_PER_MONTH,
      });
    }

    const video = this._videoManager.getVideoByName(body.type);
    if (!video) {
      throw new Error(`Video type ${body.type} not found`);
    }

    if (!video.trial && org.isTrailing) {
      throw new HttpException('This video is not available in trial mode', 406);
    }

    console.log(body.customParams);
    await video.instance.processAndValidate(body.customParams);
    console.log('no err');

    return await this._subscriptionService.useCredit(
      org,
      'ai_videos',
      async () => {
        const loadedData = await video.instance.process(
          body.output,
          body.customParams
        );

        const file = await this.storage.uploadSimple(loadedData);
        return this.saveFile(org.id, file.split('/').pop(), file);
      }
    );
  }

  async videoFunction(identifier: string, functionName: string, body: any) {
    const video = this._videoManager.getVideoByName(identifier);
    if (!video) {
      throw new Error(`Video with identifier ${identifier} not found`);
    }

    // @ts-ignore
    const functionToCall = video.instance[functionName];
    if (
      typeof functionToCall !== 'function' ||
      this._videoManager.checkAvailableVideoFunction(functionToCall)
    ) {
      throw new HttpException(
        `Function ${functionName} not found on video instance`,
        400
      );
    }

    return functionToCall(body);
  }
}
