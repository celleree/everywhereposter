import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { Request } from 'express';
import { User } from '@prisma/client';
import { GetUserFromRequest } from '@gitroom/nestjs-libraries/user/user.from.request';
import { BusinessDiscoveryService } from '@gitroom/nestjs-libraries/analytics/business-discovery.service';
import { BusinessDiscoveryQuery, BusinessDiscoveryResult } from '@gitroom/nestjs-libraries/dtos/analytics/business-discovery.dto';
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
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
    private _postsService: PostsService,
    private readonly discovery: BusinessDiscoveryService
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

  @Get('/:integration/business-discovery')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async businessDiscovery(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @Param('integration') integration: string,
    @Query() query: BusinessDiscoveryQuery,
    @Req() request: Request
  ): Promise<BusinessDiscoveryResult> {
    const session = request.headers.auth || request.cookies?.auth;
    return this.discovery.search(org.id, user.id, typeof session === 'string' ? session : '', integration, query);
  }

  @Get('/:integration')
  async getIntegration(
    @GetOrgFromRequest() org: Organization,
    @Param('integration') integration: string,
    @Query('date') date: string,
    @Query('refresh') refresh?: string
  ) {
    return this._integrationService.checkAnalytics(org, integration, date, {
      enableInstagramBusinessSnapshots: true,
      forceAnalyticsRefresh: refresh === 'true',
    });
  }
}
