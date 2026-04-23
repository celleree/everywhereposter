import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
  UsePipes,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { Organization, User, KnowledgeInputMethod } from '@prisma/client';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { GetUserFromRequest } from '@gitroom/nestjs-libraries/user/user.from.request';
import { CheckPolicies } from '@gitroom/backend/services/auth/permissions/permissions.ability';
import {
  AuthorizationActions,
  Sections,
} from '@gitroom/backend/services/auth/permissions/permission.exception.class';
import { KnowledgeBaseService } from '@gitroom/nestjs-libraries/database/prisma/knowledge-base/knowledge-base.service';
import { CreateKnowledgeTranscriptDto } from '@gitroom/nestjs-libraries/dtos/settings/knowledge-base/create.knowledge.transcript.dto';
import { UploadKnowledgeTranscriptDto } from '@gitroom/nestjs-libraries/dtos/settings/knowledge-base/upload.knowledge.transcript.dto';
import { KnowledgeBaseUploadValidationPipe } from '@gitroom/nestjs-libraries/upload/knowledge-base.upload.validation';

@ApiTags('Knowledge Base')
@Controller('/settings/knowledge-base')
export class KnowledgeBaseController {
  constructor(private readonly _knowledgeBaseService: KnowledgeBaseService) {}

  @Get('/')
  @CheckPolicies([AuthorizationActions.Read, Sections.AI])
  getSummary(@GetOrgFromRequest() org: Organization) {
    return this._knowledgeBaseService.getSummary(org.id);
  }

  @Post('/transcripts')
  @CheckPolicies(
    [AuthorizationActions.Create, Sections.AI],
    [AuthorizationActions.Create, Sections.ADMIN]
  )
  createTranscript(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @Body() body: CreateKnowledgeTranscriptDto
  ) {
    return this._knowledgeBaseService.ingestTranscript({
      orgId: org.id,
      userId: user.id,
      title: body.title,
      text: body.text,
      inputMethod: KnowledgeInputMethod.PASTE,
    });
  }

  @Post('/transcripts/upload')
  @CheckPolicies(
    [AuthorizationActions.Create, Sections.AI],
    [AuthorizationActions.Create, Sections.ADMIN]
  )
  @UseInterceptors(FileInterceptor('file'))
  @UsePipes(new KnowledgeBaseUploadValidationPipe())
  uploadTranscript(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: UploadKnowledgeTranscriptDto
  ) {
    if (!file?.buffer) {
      throw new BadRequestException('A transcript file is required.');
    }

    const text = file.buffer.toString('utf8').replace(/^\uFEFF/, '');
    if (!text.trim()) {
      throw new BadRequestException('The uploaded transcript file is empty.');
    }

    return this._knowledgeBaseService.ingestTranscript({
      orgId: org.id,
      userId: user.id,
      title: body.title || file.originalname,
      text,
      inputMethod: KnowledgeInputMethod.UPLOAD,
    });
  }

  @Delete('/documents/:id')
  @CheckPolicies(
    [AuthorizationActions.Delete, Sections.AI],
    [AuthorizationActions.Create, Sections.ADMIN]
  )
  deleteDocument(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string
  ) {
    return this._knowledgeBaseService.deleteDocument(org.id, id);
  }

  @Post('/documents/:id/reprocess')
  @CheckPolicies(
    [AuthorizationActions.Create, Sections.AI],
    [AuthorizationActions.Create, Sections.ADMIN]
  )
  reprocessDocument(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string
  ) {
    return this._knowledgeBaseService.reprocessDocument(org.id, id);
  }
}
