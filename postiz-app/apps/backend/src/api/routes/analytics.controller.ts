import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { Organization } from '@prisma/client';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { ApiTags } from '@nestjs/swagger';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';

@ApiTags('Analytics')
@Controller('/analytics')
export class AnalyticsController {
  constructor(
    private _integrationService: IntegrationService,
    private _postsService: PostsService
  ) {}

  @Get('/post/:postId')
  async getPostAnalytics(
    @GetOrgFromRequest() org: Organization,
    @Param('postId') postId: string,
    @Query('date') date: string
  ) {
    return this._postsService.checkPostAnalytics(org.id, postId, +date);
  }

  @Get('/post/:postId/comments')
  async getPostComments(
    @GetOrgFromRequest() org: Organization,
    @Param('postId') postId: string
  ) {
    return this._postsService.getPublishedComments(org.id, postId);
  }

  @Post('/post/:postId/comments')
  async addComment(
    @GetOrgFromRequest() org: Organization,
    @Param('postId') postId: string,
    @Body('message') message: string
  ) {
    return this._postsService.addPublishedComment(org.id, postId, message);
  }

  @Post('/post/:postId/comments/:commentId/reply')
  async replyToComment(
    @GetOrgFromRequest() org: Organization,
    @Param('postId') postId: string,
    @Param('commentId') commentId: string,
    @Body('message') message: string
  ) {
    return this._postsService.replyToPublishedComment(
      org.id,
      postId,
      commentId,
      message
    );
  }

  @Post('/post/:postId/comments/:commentId/hide')
  async hideComment(
    @GetOrgFromRequest() org: Organization,
    @Param('postId') postId: string,
    @Param('commentId') commentId: string,
    @Body('hide') hide: boolean
  ) {
    return this._postsService.hidePublishedComment(
      org.id,
      postId,
      commentId,
      !!hide
    );
  }

  @Delete('/post/:postId/comments/:commentId')
  async deleteComment(
    @GetOrgFromRequest() org: Organization,
    @Param('postId') postId: string,
    @Param('commentId') commentId: string
  ) {
    return this._postsService.deletePublishedComment(
      org.id,
      postId,
      commentId
    );
  }

  @Get('/:integration')
  async getIntegration(
    @GetOrgFromRequest() org: Organization,
    @Param('integration') integration: string,
    @Query('date') date: string
  ) {
    return this._integrationService.checkAnalytics(org, integration, date);
  }
}
