import {
  Body,
  Controller,
  Delete,
  Get,
  InternalServerErrorException,
  Logger,
  Param,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
  UsePipes,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { existsSync, statSync } from 'fs';
import { resolve, sep } from 'path';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { Organization } from '@prisma/client';
import { MediaService } from '@gitroom/nestjs-libraries/database/prisma/media/media.service';
import { ApiTags } from '@nestjs/swagger';
import handleR2Upload from '@gitroom/nestjs-libraries/upload/r2.uploader';
import { FileInterceptor } from '@nestjs/platform-express';
import { CustomFileValidationPipe } from '@gitroom/nestjs-libraries/upload/custom.upload.validation';
import { SubscriptionService } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service';
import { UploadFactory } from '@gitroom/nestjs-libraries/upload/upload.factory';
import { SaveMediaInformationDto } from '@gitroom/nestjs-libraries/dtos/media/save.media.information.dto';
import { VideoDto } from '@gitroom/nestjs-libraries/dtos/videos/video.dto';
import { VideoFunctionDto } from '@gitroom/nestjs-libraries/dtos/videos/video.function.dto';
import { MediaTranscriptionService } from '@gitroom/nestjs-libraries/database/prisma/media-transcription/media-transcription.service';
import { CreateTalkingHeadEditDto } from '@gitroom/nestjs-libraries/dtos/media/create-talking-head-edit.dto';
import { CheckPolicies } from '@gitroom/backend/services/auth/permissions/permissions.ability';
import {
  AuthorizationActions,
  Sections,
} from '@gitroom/backend/services/auth/permissions/permission.exception.class';

@ApiTags('Media')
@Controller('/media')
export class MediaController {
  private storage = UploadFactory.createStorage();
  private readonly logger = new Logger(MediaController.name);

  constructor(
    private _mediaService: MediaService,
    private _subscriptionService: SubscriptionService,
    private _mediaTranscriptionService: MediaTranscriptionService
  ) {}

  @Delete('/:id')
  deleteMedia(@GetOrgFromRequest() org: Organization, @Param('id') id: string) {
    return this._mediaService.deleteMedia(org.id, id);
  }

  @Post('/generate-video')
  generateVideo(
    @GetOrgFromRequest() org: Organization,
    @Body() body: VideoDto
  ) {
    console.log('hello');
    return this._mediaService.generateVideo(org, body);
  }

  @Post('/generate-image')
  async generateImage(
    @GetOrgFromRequest() org: Organization,
    @Req() req: Request,
    @Body('prompt') prompt: string,
    isPicturePrompt = false
  ) {
    const total = await this._subscriptionService.checkCredits(org);
    if (process.env.STRIPE_PUBLISHABLE_KEY && total.credits <= 0) {
      return false;
    }

    return {
      output:
        (isPicturePrompt ? '' : 'data:image/png;base64,') +
        (await this._mediaService.generateImage(prompt, org, isPicturePrompt)),
    };
  }

  @Post('/generate-image-with-prompt')
  async generateImageFromText(
    @GetOrgFromRequest() org: Organization,
    @Req() req: Request,
    @Body('prompt') prompt: string
  ) {
    const image = await this.generateImage(org, req, prompt, true);
    if (!image) {
      return false;
    }

    const file = await this.storage.uploadSimple(image.output);

    return this._mediaService.saveFile(org.id, file.split('/').pop(), file);
  }

  @Post('/upload-server')
  @UseInterceptors(FileInterceptor('file'))
  @UsePipes(new CustomFileValidationPipe())
  async uploadServer(
    @GetOrgFromRequest() org: Organization,
    @UploadedFile() file: Express.Multer.File,
    @Body('guidedTranscription') guidedTranscription?: string
  ) {
    const originalName = file?.originalname || '';
    const uploadedFile = await this.storage.uploadFile(file);
    const diskPath = this.assertLocalUploadExists(uploadedFile.path);
    const savedMedia = await this._mediaService.saveFile(
      org.id,
      uploadedFile.originalname,
      uploadedFile.path,
      originalName,
      uploadedFile.mimetype,
      this.isGuidedTranscription(guidedTranscription)
    );

    if (!savedMedia?.id || savedMedia.path !== uploadedFile.path) {
      throw new InternalServerErrorException('Upload media record was not saved.');
    }

    this.logger.log(
      [
        'upload-server saved',
        `originalName="${originalName}"`,
        `detectedType="${uploadedFile.mimetype || file?.mimetype || 'unknown'}"`,
        `diskPath="${diskPath || 'n/a'}"`,
        `publicUrl="${uploadedFile.path}"`,
        `mediaId="${savedMedia.id}"`,
      ].join(' ')
    );

    return savedMedia;
  }

  @Post('/save-media')
  async saveMedia(
    @GetOrgFromRequest() org: Organization,
    @Req() req: Request,
    @Body('name') name: string,
    @Body('originalName') originalName: string,
    @Body('guidedTranscription') guidedTranscription?: boolean | string
  ) {
    if (!name) {
      return false;
    }
    return this._mediaService.saveFile(
      org.id,
      name,
      process.env.CLOUDFLARE_BUCKET_URL + '/' + name,
      originalName || undefined,
      undefined,
      this.isGuidedTranscription(guidedTranscription)
    );
  }

  @Post('/information')
  saveMediaInformation(
    @GetOrgFromRequest() org: Organization,
    @Body() body: SaveMediaInformationDto
  ) {
    return this._mediaService.saveMediaInformation(org.id, body);
  }

  @Post('/upload-simple')
  @UseInterceptors(FileInterceptor('file'))
  @UsePipes(new CustomFileValidationPipe())
  async uploadSimple(
    @GetOrgFromRequest() org: Organization,
    @UploadedFile('file') file: Express.Multer.File,
    @Body('preventSave') preventSave: string = 'false'
  ) {
    const originalName = file.originalname;
    const getFile = await this.storage.uploadFile(file);

    if (preventSave === 'true') {
      const { path } = getFile;
      return { path };
    }

    return this._mediaService.saveFile(
      org.id,
      getFile.originalname,
      getFile.path,
      originalName,
      getFile.mimetype
    );
  }

  @Post('/:endpoint')
  async uploadFile(
    @GetOrgFromRequest() org: Organization,
    @Req() req: Request,
    @Res() res: Response,
    @Param('endpoint') endpoint: string
  ) {
    const upload = await handleR2Upload(endpoint, req, res);
    if (endpoint !== 'complete-multipart-upload') {
      return upload;
    }

    // @ts-ignore
    const name = upload.Location.split('/').pop();
    const originalName = req.body?.file?.name;
    const guidedTranscription =
      req.body?.file?.meta?.guidedTranscription ??
      req.body?.file?.guidedTranscription;

    const saveFile = await this._mediaService.saveFile(
      org.id,
      name,
      // @ts-ignore
      upload.Location,
      originalName || undefined,
      undefined,
      this.isGuidedTranscription(guidedTranscription)
    );

    res.status(200).json({ ...upload, saved: saveFile });
  }

  @Get('/post-attached')
  getPostAttachedMedia(
    @GetOrgFromRequest() org: Organization,
    @Query('page') page: number
  ) {
    return this._mediaService.getPostAttachedMedia(org.id, page);
  }

  @Get('/')
  getMedia(
    @GetOrgFromRequest() org: Organization,
    @Query('page') page: number
  ) {
    return this._mediaService.getMedia(org.id, page);
  }

  @Get('/video-options')
  getVideos() {
    return this._mediaService.getVideoOptions();
  }

  @Post('/video/function')
  videoFunction(
    @Body() body: VideoFunctionDto
  ) {
    return this._mediaService.videoFunction(body.identifier, body.functionName, body.params);
  }

  @Get('/generate-video/:type/allowed')
  generateVideoAllowed(
    @GetOrgFromRequest() org: Organization,
    @Param('type') type: string
  ) {
    return this._mediaService.generateVideoAllowed(org, type);
  }

  @Post('/:id/transcription/ensure')
  ensureTranscription(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string
  ) {
    return this._mediaTranscriptionService.ensureTranscriptionStarted(
      org.id,
      id
    );
  }

  @Post('/:id/talking-head-edit')
  @CheckPolicies([AuthorizationActions.Create, Sections.AI])
  createTalkingHeadEdit(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body() body: CreateTalkingHeadEditDto
  ) {
    return this._mediaService.createTalkingHeadEdit(
      org.id,
      id,
      body.stylePrompt
    );
  }

  @Post('/:id/transcription/retry')
  retryTranscription(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string
  ) {
    return this._mediaTranscriptionService.retry(org.id, id);
  }

  @Get('/:id/transcription')
  getTranscription(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string
  ) {
    return this._mediaTranscriptionService.getStatus(org.id, id);
  }

  @Get('/:id')
  getMediaById(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string
  ) {
    return this._mediaService.getMediaByOrganizationIdAndId(org.id, id);
  }

  private assertLocalUploadExists(publicPath: string) {
    if (process.env.STORAGE_PROVIDER !== 'local') {
      return undefined;
    }

    const diskPath = this.getLocalUploadDiskPath(publicPath);
    if (!diskPath) {
      throw new InternalServerErrorException('Local upload path is invalid.');
    }

    if (!existsSync(diskPath) || !statSync(diskPath).isFile()) {
      throw new InternalServerErrorException('Local upload was not written to disk.');
    }

    return diskPath;
  }

  private isGuidedTranscription(value: unknown) {
    return value === true || value === 'true';
  }

  private getLocalUploadDiskPath(publicPath: string) {
    const uploadDirectory = process.env.UPLOAD_DIRECTORY;
    if (!uploadDirectory || !publicPath) {
      return undefined;
    }

    let pathname = publicPath;
    try {
      pathname = new URL(publicPath).pathname;
    } catch {}

    const uploadPrefix = this.getUploadStaticDirectory();
    if (pathname.startsWith(`${uploadPrefix}/`)) {
      pathname = pathname.slice(uploadPrefix.length);
    }

    const relativePath = pathname.replace(/^\/+/, '');
    if (!relativePath || relativePath.includes('\0')) {
      return undefined;
    }

    const uploadRoot = resolve(uploadDirectory);
    const diskPath = resolve(uploadRoot, relativePath);
    if (diskPath !== uploadRoot && !diskPath.startsWith(`${uploadRoot}${sep}`)) {
      return undefined;
    }

    return diskPath;
  }

  private getUploadStaticDirectory() {
    const directory =
      process.env.NEXT_PUBLIC_UPLOAD_STATIC_DIRECTORY ||
      process.env.NEXT_PUBLIC_UPLOAD_DIRECTORY ||
      '/uploads';
    return `/${directory.replace(/^\/+|\/+$/g, '')}`;
  }
}
