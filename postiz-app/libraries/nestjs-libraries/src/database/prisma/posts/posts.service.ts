import {
  BadRequestException,
  Injectable,
  ValidationPipe,
} from '@nestjs/common';
import { PostsRepository } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.repository';
import { CreatePostDto } from '@gitroom/nestjs-libraries/dtos/posts/create.post.dto';
import dayjs from 'dayjs';
import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';
import { Integration, Post, Media, From, State } from '@prisma/client';
import { GetPostsDto } from '@gitroom/nestjs-libraries/dtos/posts/get.posts.dto';
import { GetPostsListDto } from '@gitroom/nestjs-libraries/dtos/posts/get.posts.list.dto';
import { shuffle } from 'lodash';
import { CreateGeneratedPostsDto } from '@gitroom/nestjs-libraries/dtos/generator/create.generated.posts.dto';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import utc from 'dayjs/plugin/utc';
import { MediaService } from '@gitroom/nestjs-libraries/database/prisma/media/media.service';
import { ShortLinkService } from '@gitroom/nestjs-libraries/short-linking/short.link.service';
import { CreateTagDto } from '@gitroom/nestjs-libraries/dtos/posts/create.tag.dto';
import { minifyPostsList, minifyPosts } from '@gitroom/helpers/utils/posts.list.minify';
import axios from 'axios';
import sharp from 'sharp';
import { UploadFactory } from '@gitroom/nestjs-libraries/upload/upload.factory';
import { Readable } from 'stream';
import { OpenaiService } from '@gitroom/nestjs-libraries/openai/openai.service';
import { existsSync, statSync } from 'fs';
import { resolve, sep } from 'path';
dayjs.extend(utc);
import * as Sentry from '@sentry/nestjs';
import { TemporalService } from 'nestjs-temporal-core';
import { TypedSearchAttributes } from '@temporalio/common';
import {
  organizationId,
  postId as postIdSearchParam,
} from '@gitroom/nestjs-libraries/temporal/temporal.search.attribute';
import {
  AnalyticsData,
  PublishedComment,
  PublishedDeleteResponse,
  PostDetails,
  SocialProvider,
} from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import { timer } from '@gitroom/helpers/utils/timer';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import {
  BadBody,
  RefreshToken,
} from '@gitroom/nestjs-libraries/integrations/social.abstract';
import { RefreshIntegrationService } from '@gitroom/nestjs-libraries/integrations/refresh.integration.service';
import { stripHtmlValidation } from '@gitroom/helpers/utils/strip.html.validation';

type PostWithConditionals = Post & {
  integration?: Integration;
  childrenPost: Post[];
};

type PublishedCommentsResult =
  | {
      supported: false;
      comments: [];
    }
  | {
      supported: true;
      comments: PublishedComment[];
      missing?: boolean;
      reconnectRequired?: boolean;
      message?: string;
    };

const FACEBOOK_COMMENT_RECONNECT_MESSAGE =
  'Reconnect this Facebook Page to grant pages_read_user_content and load Page comments.';
const INSTAGRAM_COMMENT_RECONNECT_MESSAGE =
  'Reconnect Instagram and grant instagram_manage_comments.';
const MISSING_LOCAL_UPLOAD_MESSAGE =
  'Upload file is missing on server. Please re-upload the media.';

@Injectable()
export class PostsService {
  private storage = UploadFactory.createStorage();
  constructor(
    private _postRepository: PostsRepository,
    private _integrationManager: IntegrationManager,
    private _integrationService: IntegrationService,
    private _mediaService: MediaService,
    private _shortLinkService: ShortLinkService,
    private _openaiService: OpenaiService,
    private _temporalService: TemporalService,
    private _refreshIntegrationService: RefreshIntegrationService
  ) {}

  searchForMissingThreeHoursPosts() {
    return this._postRepository.searchForMissingThreeHoursPosts();
  }

  updatePost(id: string, postId: string, releaseURL: string) {
    return this._postRepository.updatePost(id, postId, releaseURL);
  }

  getPostsByIntegrationRelease(
    orgId: string,
    integrationId: string,
    media: { id?: string; url?: string }[]
  ) {
    return this._postRepository.getPostsByIntegrationRelease(
      orgId,
      integrationId,
      media
    );
  }

  async getMissingContent(
    orgId: string,
    postId: string,
    forceRefresh = false
  ): Promise<{ id: string; url: string }[]> {
    const post = await this._postRepository.getPostById(postId, orgId);
    if (!post || post.releaseId !== 'missing') {
      return [];
    }

    const integrationProvider = this._integrationManager.getSocialIntegration(
      post.integration.providerIdentifier
    );

    if (!integrationProvider.missing) {
      return [];
    }

    const getIntegration = post.integration!;

    if (
      dayjs(getIntegration?.tokenExpiration).isBefore(dayjs()) ||
      forceRefresh
    ) {
      const data = await this._refreshIntegrationService.refresh(
        getIntegration
      );
      if (!data) {
        return [];
      }

      const { accessToken } = data;

      if (accessToken) {
        getIntegration.token = accessToken;

        if (integrationProvider.refreshWait) {
          await timer(10000);
        }
      } else {
        await this._integrationService.disconnectChannel(orgId, getIntegration);
        return [];
      }
    }

    try {
      return await integrationProvider.missing(
        getIntegration.internalId,
        getIntegration.token
      );
    } catch (e) {
      console.log(e);
      if (e instanceof RefreshToken) {
        return this.getMissingContent(orgId, postId, true);
      }
    }

    return [];
  }

  async updateReleaseId(orgId: string, postId: string, releaseId: string) {
    return this._postRepository.updateReleaseId(postId, orgId, releaseId);
  }

  async checkPostAnalytics(
    orgId: string,
    postId: string,
    date: number,
    forceRefresh = false
  ): Promise<AnalyticsData[] | { missing: true }> {
    const post = await this._postRepository.getPostById(postId, orgId);
    if (!post || !post.releaseId) {
      return [];
    }

    if (post.releaseId === 'missing') {
      return { missing: true };
    }

    const integrationProvider = this._integrationManager.getSocialIntegration(
      post.integration.providerIdentifier
    );

    if (!integrationProvider.postAnalytics) {
      return [];
    }

    const getIntegration = post.integration!;

    if (
      dayjs(getIntegration?.tokenExpiration).isBefore(dayjs()) ||
      forceRefresh
    ) {
      const data = await this._refreshIntegrationService.refresh(
        getIntegration
      );
      if (!data) {
        return [];
      }

      const { accessToken } = data;

      if (accessToken) {
        getIntegration.token = accessToken;

        if (integrationProvider.refreshWait) {
          await timer(10000);
        }
      } else {
        await this._integrationService.disconnectChannel(orgId, getIntegration);
        return [];
      }
    }

    // const getIntegrationData = await ioRedis.get(
    //   `integration:${orgId}:${post.id}:${date}`
    // );
    // if (getIntegrationData) {
    //   return JSON.parse(getIntegrationData);
    // }

    try {
      const loadAnalytics = await integrationProvider.postAnalytics(
        getIntegration.internalId,
        getIntegration.token,
        post.releaseId,
        date
      );
      await ioRedis.set(
        `integration:${orgId}:${post.id}:${date}`,
        JSON.stringify(loadAnalytics),
        'EX',
        !process.env.NODE_ENV || process.env.NODE_ENV === 'development'
          ? 1
          : 3600
      );
      return loadAnalytics;
    } catch (e) {
      console.log(e);
      if (e instanceof RefreshToken) {
        return this.checkPostAnalytics(orgId, postId, date, true);
      }
    }

    return [];
  }

  async getPublishedComments(
    orgId: string,
    postId: string,
    forceRefresh = false
  ): Promise<PublishedCommentsResult> {
    const post = await this._postRepository.getPostById(postId, orgId);
    if (!post?.integration) {
      return {
        supported: false,
        comments: [],
      };
    }

    if (!post.releaseId || post.releaseId === 'missing') {
      return {
        supported: true,
        missing: true,
        comments: [],
      };
    }

    const integrationProvider = this._integrationManager.getSocialIntegration(
      post.integration.providerIdentifier
    );

    if (!integrationProvider.readComments) {
      return {
        supported: false,
        comments: [],
      };
    }

    const getIntegration = post.integration;

    try {
      await this.ensurePublishedIntegrationAccess(
        orgId,
        getIntegration,
        integrationProvider,
        undefined,
        forceRefresh
      );

      return {
        supported: true,
        comments: await integrationProvider.readComments(
          getIntegration.internalId,
          getIntegration.token,
          post.releaseId,
          getIntegration
        ),
      };
    } catch (error) {
      this.logPublishedCommentFailure(
        'loading',
        integrationProvider,
        post,
        undefined,
        error
      );

      if (
        integrationProvider.identifier === 'facebook' &&
        (error instanceof RefreshToken || error instanceof BadRequestException)
      ) {
        await this._integrationService.refreshNeeded(orgId, getIntegration.id);
        return this.getFacebookCommentReconnectResponse(
          error.message || FACEBOOK_COMMENT_RECONNECT_MESSAGE
        );
      }

      if (integrationProvider.identifier === 'instagram') {
        if (error instanceof RefreshToken && !forceRefresh) {
          return this.getPublishedComments(orgId, postId, true);
        }

        if (
          error instanceof RefreshToken ||
          error instanceof BadRequestException
        ) {
          await this._integrationService.refreshNeeded(orgId, getIntegration.id);
          return this.getInstagramCommentReconnectResponse(
            error.message || INSTAGRAM_COMMENT_RECONNECT_MESSAGE
          );
        }
      }

      if (error instanceof BadBody) {
        const message =
          error.message ||
          (integrationProvider.identifier === 'instagram'
            ? 'Could not load Instagram comments right now.'
            : 'Could not load Facebook Page comments right now.');

        if (
          integrationProvider.identifier === 'instagram' &&
          this.isInstagramCommentReconnectMessage(message)
        ) {
          await this._integrationService.refreshNeeded(orgId, getIntegration.id);
          return this.getInstagramCommentReconnectResponse(message);
        }

        return {
          supported: true,
          comments: [],
          message,
        };
      }

      throw error;
    }
  }

  async replyToPublishedComment(
    orgId: string,
    postId: string,
    commentId: string,
    message: string,
    forceRefresh = false
  ) {
    const trimmedMessage = (message || '').trim();
    if (!trimmedMessage) {
      throw new BadRequestException('Reply message is required.');
    }

    const { post, integration, integrationProvider } =
      await this.getPublishedCommentActionTarget(
        orgId,
        postId,
        'replyToComment',
        'replying to',
        forceRefresh
      );

    try {
      const result = await integrationProvider.replyToComment!(
        integration.internalId,
        integration.token,
        post.releaseId!,
        commentId,
        trimmedMessage,
        integration
      );

      return {
        ...result,
        success: true,
      };
    } catch (error) {
      this.logPublishedCommentFailure(
        'replying',
        integrationProvider,
        post,
        commentId,
        error
      );

      if (error instanceof RefreshToken && !forceRefresh) {
        return this.replyToPublishedComment(
          orgId,
          postId,
          commentId,
          trimmedMessage,
          true
        );
      }

      if (error instanceof RefreshToken) {
        await this._integrationService.refreshNeeded(orgId, integration.id);
        throw new BadRequestException(
          error.message || this.getCommentReconnectMessage(integrationProvider)
        );
      }

      if (error instanceof BadBody) {
        throw new BadRequestException(
          error.message || 'Failed to reply to the published comment.'
        );
      }

      throw error;
    }
  }

  async hidePublishedComment(
    orgId: string,
    postId: string,
    commentId: string,
    hide: boolean,
    forceRefresh = false
  ) {
    const { post, integration, integrationProvider } =
      await this.getPublishedCommentActionTarget(
        orgId,
        postId,
        'hideComment',
        hide ? 'hiding' : 'unhiding',
        forceRefresh
      );

    try {
      const result = await integrationProvider.hideComment!(
        integration.internalId,
        integration.token,
        post.releaseId!,
        commentId,
        hide,
        integration
      );

      return {
        ...result,
        success: true,
      };
    } catch (error) {
      this.logPublishedCommentFailure(
        hide ? 'hiding' : 'unhiding',
        integrationProvider,
        post,
        commentId,
        error
      );

      if (error instanceof RefreshToken && !forceRefresh) {
        return this.hidePublishedComment(
          orgId,
          postId,
          commentId,
          hide,
          true
        );
      }

      if (error instanceof RefreshToken) {
        await this._integrationService.refreshNeeded(orgId, integration.id);
        throw new BadRequestException(
          error.message || this.getCommentReconnectMessage(integrationProvider)
        );
      }

      if (error instanceof BadBody) {
        throw new BadRequestException(
          error.message || 'Failed to update the published comment.'
        );
      }

      throw error;
    }
  }

  async deletePublishedComment(
    orgId: string,
    postId: string,
    commentId: string,
    forceRefresh = false
  ) {
    const { post, integration, integrationProvider } =
      await this.getPublishedCommentActionTarget(
        orgId,
        postId,
        'deleteComment',
        'deleting',
        forceRefresh
      );

    try {
      const result = await integrationProvider.deleteComment!(
        integration.internalId,
        integration.token,
        post.releaseId!,
        commentId,
        integration
      );

      return {
        ...result,
        success: true,
      };
    } catch (error) {
      this.logPublishedCommentFailure(
        'deleting',
        integrationProvider,
        post,
        commentId,
        error
      );

      if (error instanceof RefreshToken && !forceRefresh) {
        return this.deletePublishedComment(orgId, postId, commentId, true);
      }

      if (error instanceof RefreshToken) {
        await this._integrationService.refreshNeeded(orgId, integration.id);
        throw new BadRequestException(
          error.message || this.getCommentReconnectMessage(integrationProvider)
        );
      }

      if (error instanceof BadBody) {
        throw new BadRequestException(
          error.message || 'Failed to delete the published comment.'
        );
      }

      throw error;
    }
  }

  async getStatistics(orgId: string, id: string) {
    const getPost = await this.getPostsRecursively(id, true, orgId, true);
    const content = getPost.map((p) => p.content);
    const shortLinksTracking = await this._shortLinkService.getStatistics(
      content
    );

    return {
      clicks: shortLinksTracking,
    };
  }

  async mapTypeToPost(
    body: CreatePostDto,
    organization: string,
    replaceDraft: boolean = false
  ): Promise<CreatePostDto> {
    if (!body?.posts?.every((p) => p?.integration?.id)) {
      throw new BadRequestException('All posts must have an integration id');
    }

    const mappedValues = {
      ...body,
      type: replaceDraft ? 'schedule' : body.type,
      posts: await Promise.all(
        body.posts.map(async (post) => {
          const integration = await this._integrationService.getIntegrationById(
            organization,
            post.integration.id
          );

          if (!integration) {
            throw new BadRequestException(
              `Integration with id ${post.integration.id} not found`
            );
          }

          return {
            type: replaceDraft ? 'schedule' : body.type,
            ...post,
            settings: {
              ...(post.settings || ({} as any)),
              __type: integration.providerIdentifier,
            },
          };
        })
      ),
    };

    const validationPipe = new ValidationPipe({
      skipMissingProperties: false,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    });

    return await validationPipe.transform(mappedValues, {
      type: 'body',
      metatype: CreatePostDto,
    });
  }

  async getPostsRecursively(
    id: string,
    includeIntegration = false,
    orgId?: string,
    isFirst?: boolean
  ): Promise<PostWithConditionals[]> {
    const post = await this._postRepository.getPost(
      id,
      includeIntegration,
      orgId,
      isFirst
    );

    if (!post) {
      return [];
    }

    return [
      post!,
      ...(post?.childrenPost?.length
        ? await this.getPostsRecursively(
            post?.childrenPost?.[0]?.id,
            false,
            orgId,
            false
          )
        : []),
    ];
  }

  async getPosts(orgId: string, query: GetPostsDto) {
    return this._postRepository.getPosts(orgId, query);
  }

  async getPostsMinified(orgId: string, query: GetPostsDto) {
    return minifyPosts({
      posts: await this._postRepository.getPosts(orgId, query),
    });
  }

  async getPostsList(orgId: string, query: GetPostsListDto) {
    return minifyPostsList(
      await this._postRepository.getPostsList(orgId, query)
    );
  }

  async updateMedia(id: string, imagesList: any[], convertToJPEG = false) {
    try {
      let imageUpdateNeeded = false;
      const getImageList = await Promise.all(
        (
          await Promise.all(
            (imagesList || []).map(async (p: any) => {
              if ((!p.path || !p.type) && p.id) {
                imageUpdateNeeded = true;
                const media = await this._mediaService.getMediaById(p.id);

                if (!p.path) {
                  return media;
                }

                return {
                  ...(media || {}),
                  ...p,
                  type: p.type || media?.type,
                };
              }

              return p;
            })
          )
        )
          .map((m) => {
            const mediaType = this.getMediaType(m);
            const isRemotePath = /^https?:\/\//i.test(m.path || '');
            const localPublicPath = this.getLocalUploadPublicPath(m.path);
            const localDiskPath = this.getLocalUploadDiskPath(m.path);
            return {
              ...m,
              url:
                !isRemotePath && localPublicPath
                  ? this.joinPublicUrl(
                      process.env.FRONTEND_URL || '',
                      localPublicPath
                    )
                  : m.path,
              type: mediaType,
              path:
                !isRemotePath
                  ? localDiskPath || process.env.UPLOAD_DIRECTORY + m.path
                  : m.path,
            };
          })
          .map(async (m) => {
            if (convertToJPEG) {
              this.assertLocalUploadExists(m);
            }

            if (!convertToJPEG) {
              return m;
            }

            if (m.type === 'image') {
              const response = await axios.get(m.url, {
                responseType: 'arraybuffer',
              });

              const imageBuffer = Buffer.from(response.data);
              imageUpdateNeeded = true;
              const buffer = await sharp(imageBuffer, { failOn: 'error' })
                .rotate()
                .flatten({ background: '#ffffff' })
                .toColorspace('srgb')
                .withMetadata({ density: 72 })
                .jpeg({
                  quality: 90,
                  progressive: false,
                  mozjpeg: false,
                })
                .toBuffer();

              const { path, originalname } = await this.storage.uploadFile({
                buffer,
                mimetype: 'image/jpeg',
                size: buffer.length,
                path: '',
                fieldname: '',
                destination: '',
                stream: new Readable(),
                filename: '',
                originalname: '',
                encoding: '',
              });

              const isConvertedRemotePath = /^https?:\/\//i.test(path || '');
              const convertedPublicPath = this.getLocalUploadPublicPath(path);
              const convertedMedia = {
                ...m,
                name: originalname,
                url:
                  !isConvertedRemotePath && convertedPublicPath
                    ? this.joinPublicUrl(
                        process.env.FRONTEND_URL || '',
                        convertedPublicPath
                      )
                    : path,
                type: 'image',
                path:
                  !isConvertedRemotePath
                    ? this.getLocalUploadDiskPath(path) ||
                      process.env.UPLOAD_DIRECTORY + path
                    : path,
              };
              this.assertLocalUploadExists(convertedMedia);
              return convertedMedia;
            }

            return m;
          })
      );

      if (imageUpdateNeeded) {
        await this._postRepository.updateImages(
          id,
          JSON.stringify(getImageList)
        );
      }

      return getImageList;
    } catch (err: any) {
      if (err instanceof BadRequestException) {
        throw err;
      }

      return imagesList;
    }
  }

  private assertLocalUploadExists(media: any) {
    const diskPath = this.getLocalUploadDiskPath(media?.url || media?.path || '');
    if (!diskPath) {
      return;
    }

    if (!existsSync(diskPath) || !statSync(diskPath).isFile()) {
      throw new BadRequestException(MISSING_LOCAL_UPLOAD_MESSAGE);
    }
  }

  private getLocalUploadPublicPath(mediaPath: string) {
    if (!mediaPath || /^https?:\/\//i.test(mediaPath)) {
      return undefined;
    }

    const uploadPrefix = this.getUploadStaticDirectory();
    const pathWithSlash = mediaPath.startsWith('/') ? mediaPath : `/${mediaPath}`;

    if (pathWithSlash.startsWith(`${uploadPrefix}/`)) {
      return pathWithSlash;
    }

    return `${uploadPrefix}${pathWithSlash}`;
  }

  private getLocalUploadDiskPath(mediaPath: string) {
    const uploadDirectory = process.env.UPLOAD_DIRECTORY;
    if (!uploadDirectory || !mediaPath) {
      return undefined;
    }

    let pathname = mediaPath;
    try {
      pathname = new URL(mediaPath).pathname;
    } catch {}

    const uploadPrefix = this.getUploadStaticDirectory();
    if (pathname.startsWith(`${uploadPrefix}/`)) {
      pathname = pathname.slice(uploadPrefix.length);
    } else if (/^https?:\/\//i.test(mediaPath)) {
      return undefined;
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

  private joinPublicUrl(frontendUrl: string, mediaPath: string) {
    return `${frontendUrl.replace(/\/+$/g, '')}/${mediaPath.replace(/^\/+/, '')}`;
  }

  private getMediaType(media: any) {
    if (media?.type === 'video') {
      return 'video';
    }

    const mimeType = (media?.mimetype || media?.mimeType || '')
      .split(';')[0]
      .trim()
      .toLowerCase();

    if (mimeType.startsWith('video/')) {
      return 'video';
    }

    if (mimeType.startsWith('image/')) {
      return 'image';
    }

    const fileIdentity = [
      media?.path,
      media?.url,
      media?.name,
      media?.originalName,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    return /\.(mp4|mov|m4v)(?:$|[?#\s])/i.test(fileIdentity)
      ? 'video'
      : 'image';
  }

  async getPostGroupDebugExport(orgId: string, group: string) {
    const loadAll = await this._postRepository.getPostsByGroup(orgId, group);
    const errors = await this._postRepository.getErrorsByPostIds(
      loadAll.map((p) => p.id)
    );
    const posts = this.arrangePostsByGroup(loadAll, undefined);
    const rootPost = posts[0] as any;

    return {
      type: 'draft' as const,
      shortLink: false,
      date: rootPost.publishDate.toISOString(),
      tags:
        rootPost.tags?.map((t: any) => ({
          value: t.tag.id,
          label: t.tag.name,
        })) || [],
      posts: [
        {
          integration: { id: 'REPLACE_WITH_LOCAL_INTEGRATION_ID' },
          group: rootPost.group,
          settings: JSON.parse(rootPost.settings || '{}'),
          value: posts.map((post) => ({
            content: post.content,
            image: JSON.parse(post.image || '[]'),
            delay: post.delay || 0,
          })),
        },
      ],
      _debug: {
        providerIdentifier: rootPost.integration?.providerIdentifier,
        providerName: rootPost.integration?.name,
        state: rootPost.state,
        error: rootPost.error,
        errors: errors.map((e) => ({
          message: e.message,
          platform: e.platform,
          body: e.body,
          createdAt: e.createdAt,
        })),
        originalGroup: group,
        originalPublishDate: rootPost.publishDate,
        exportedAt: new Date().toISOString(),
      },
    };
  }

  async getPostsByGroup(orgId: string, group: string) {
    const convertToJPEG = false;
    const loadAll = await this._postRepository.getPostsByGroup(orgId, group);
    const posts = this.arrangePostsByGroup(loadAll, undefined);

    return {
      group: posts?.[0]?.group,
      posts: await Promise.all(
        (posts || []).map(async (post) => ({
          ...post,
          image: await this.updateMedia(
            post.id,
            JSON.parse(post.image || '[]'),
            convertToJPEG
          ),
        }))
      ),
      integrationPicture: posts[0]?.integration?.picture,
      integration: posts[0].integrationId,
      settings: JSON.parse(posts[0].settings || '{}'),
    };
  }

  arrangePostsByGroup(all: any, parent?: string): PostWithConditionals[] {
    const findAll = all
      .filter((p: any) =>
        !parent ? !p.parentPostId : p.parentPostId === parent
      )
      .map(({ integration, ...all }: any) => ({
        ...all,
        ...(!parent ? { integration } : {}),
      }));

    return [
      ...findAll,
      ...(findAll.length
        ? findAll.flatMap((p: any) => this.arrangePostsByGroup(all, p.id))
        : []),
    ];
  }

  async getPost(orgId: string, id: string, convertToJPEG = false) {
    const posts = await this.getPostsRecursively(id, true, orgId, true);
    const list = {
      group: posts?.[0]?.group,
      posts: await Promise.all(
        (posts || []).map(async (post) => ({
          ...post,
          image: await this.updateMedia(
            post.id,
            JSON.parse(post.image || '[]'),
            convertToJPEG
          ),
        }))
      ),
      integrationPicture: posts[0]?.integration?.picture,
      integration: posts[0].integrationId,
      settings: JSON.parse(posts[0].settings || '{}'),
    };

    return list;
  }

  async getOldPosts(orgId: string, date: string) {
    return this._postRepository.getOldPosts(orgId, date);
  }

  public async updateTags(orgId: string, post: Post[]): Promise<Post[]> {
    const plainText = JSON.stringify(post);
    const extract = Array.from(
      plainText.match(/\(post:[a-zA-Z0-9-_]+\)/g) || []
    );
    if (!extract.length) {
      return post;
    }

    const ids = (extract || []).map((e) =>
      e.replace('(post:', '').replace(')', '')
    );
    const urls = await this._postRepository.getPostUrls(orgId, ids);
    const newPlainText = ids.reduce((acc, value) => {
      const findUrl = urls?.find?.((u) => u.id === value)?.releaseURL || '';
      return acc.replace(
        new RegExp(`\\(post:${value}\\)`, 'g'),
        findUrl.split(',')[0]
      );
    }, plainText);

    return this.updateTags(orgId, JSON.parse(newPlainText) as Post[]);
  }

  public async checkInternalPlug(
    integration: Integration,
    orgId: string,
    id: string,
    settings: any
  ) {
    const plugs = Object.entries(settings).filter(([key]) => {
      return key.indexOf('plug-') > -1;
    });

    if (plugs.length === 0) {
      return [];
    }

    const parsePlugs = plugs.reduce((all, [key, value]) => {
      const [_, name, identifier] = key.split('--');
      all[name] = all[name] || { name };
      all[name][identifier] = value;
      return all;
    }, {} as any);

    const list: {
      name: string;
      integrations: { id: string }[];
      delay: string;
      active: boolean;
    }[] = Object.values(parsePlugs);

    return (list || []).flatMap((trigger) => {
      return (trigger?.integrations || []).flatMap((int) => ({
        type: 'internal-plug',
        post: id,
        originalIntegration: integration.id,
        integration: int.id,
        plugName: trigger.name,
        orgId: orgId,
        delay: +trigger.delay,
        information: trigger,
      }));
    });
  }

  public async checkPlugs(
    orgId: string,
    providerName: string,
    integrationId: string
  ) {
    const loadAllPlugs = this._integrationManager.getAllPlugs();
    const getPlugs = await this._integrationService.getPlugs(
      orgId,
      integrationId
    );

    const currentPlug = loadAllPlugs.find((p) => p.identifier === providerName);

    return getPlugs
      .filter((plug) => {
        return currentPlug?.plugs?.some(
          (p: any) => p.methodName === plug.plugFunction
        );
      })
      .map((plug) => {
        const runPlug = currentPlug?.plugs?.find(
          (p: any) => p.methodName === plug.plugFunction
        )!;
        return {
          type: 'global',
          plugId: plug.id,
          delay: runPlug.runEveryMilliseconds,
          totalRuns: runPlug.totalRuns,
        };
      });
  }

  async deletePost(orgId: string, group: string) {
    const post = await this._postRepository.deletePost(orgId, group);

    if (post?.id) {
      try {
        const workflows = this._temporalService.client
          .getRawClient()
          ?.workflow.list({
            query: `postId="${post.id}" AND ExecutionStatus="Running"`,
          });

        for await (const executionInfo of workflows) {
          try {
            const workflow =
              await this._temporalService.client.getWorkflowHandle(
                executionInfo.workflowId
              );
            if (
              workflow &&
              (await workflow.describe()).status.name !== 'TERMINATED'
            ) {
              await workflow.terminate();
            }
          } catch (err) {}
        }
      } catch (err) {}
    }

    return { success: true };
  }

  async deletePublishedPost(
    orgId: string,
    group: string,
    forceRefresh = false
  ) {
    const previousPost = await this.loadPublishedUpdateTarget(
      orgId,
      group,
      'deleted on the platform'
    );
    const integrationProvider = this.getDeleteProvider(previousPost);

    await this.ensurePublishedIntegrationAccess(
      orgId,
      previousPost.integration,
      integrationProvider,
      undefined,
      forceRefresh
    );

    try {
      const result = await integrationProvider.deletePublished!(
        previousPost.integration.internalId,
        previousPost.integration.token,
        previousPost.releaseId!,
        previousPost.integration
      );

      const finalResult: PublishedDeleteResponse = result || {
        status: 'deleted',
      };

      await this._postRepository.markPostsRemoteDeleted(orgId, group);

      return {
        success: true,
        status: finalResult.status,
      };
    } catch (error) {
      if (error instanceof RefreshToken && !forceRefresh) {
        return this.deletePublishedPost(orgId, group, true);
      }

      if (error instanceof RefreshToken) {
        await this._integrationService.refreshNeeded(
          orgId,
          previousPost.integration.id
        );
        throw new BadRequestException(
          error.message ||
            'Token expired or invalid, please reconnect this channel.'
        );
      }

      if (error instanceof BadBody) {
        throw new BadRequestException(
          error.message || 'Failed to delete the published post.'
        );
      }

      throw error;
    }
  }

  async countPostsFromDay(orgId: string, date: Date) {
    return this._postRepository.countPostsFromDay(orgId, date);
  }

  getPostByForWebhookId(id: string) {
    return this._postRepository.getPostByForWebhookId(id);
  }

  async startWorkflow(
    taskQueue: string,
    postId: string,
    orgId: string,
    state: State
  ) {
    try {
      const workflows = this._temporalService.client
        .getRawClient()
        ?.workflow.list({
          query: `postId="${postId}" AND ExecutionStatus="Running"`,
        });

      for await (const executionInfo of workflows) {
        try {
          const workflow = await this._temporalService.client.getWorkflowHandle(
            executionInfo.workflowId
          );
          if (
            workflow &&
            (await workflow.describe()).status.name !== 'TERMINATED'
          ) {
            await workflow.terminate();
          }
        } catch (err) {}
      }
    } catch (err) {}

    if (state === 'DRAFT') {
      return;
    }

    try {
      await this._temporalService.client
        .getRawClient()
        ?.workflow.start('postWorkflowV102', {
          workflowId: `post_${postId}`,
          taskQueue: 'main',
          workflowIdConflictPolicy: 'TERMINATE_EXISTING',
          args: [
            {
              taskQueue: taskQueue,
              postId: postId,
              organizationId: orgId,
            },
          ],
          typedSearchAttributes: new TypedSearchAttributes([
            {
              key: postIdSearchParam,
              value: postId,
            },
            {
              key: organizationId,
              value: orgId,
            },
          ]),
        });
    } catch (err) {}
  }

  async createPost(orgId: string, body: CreatePostDto): Promise<any[]> {
    const postList = [];
    for (const post of body.posts) {
      const previousPost =
        body.type === 'update'
          ? await this.loadPublishedUpdateTarget(orgId, post.group)
          : undefined;
      const updateProvider = previousPost
        ? this.getUpdateProvider(previousPost)
        : undefined;

      const messages = (post.value || []).map((p) => p.content);
      const updateContent = !body.shortLink
        ? messages
        : await this._shortLinkService.convertTextToShortLinks(orgId, messages);

      const shouldCreateFreshPostIds =
        body.type !== 'update'
          ? await this.shouldCreateFreshPostIds(orgId, post.group)
          : false;

      const postPayload = {
        ...post,
        value: (post.value || []).map((p, i) => {
          const { id, ...postValue } = p;
          return {
            ...postValue,
            ...(shouldCreateFreshPostIds ? {} : id ? { id } : {}),
            content: updateContent[i],
          };
        }),
      };

      const { posts } = await this._postRepository.createOrUpdatePost(
        body.type,
        orgId,
        body.type === 'now' ? dayjs().format('YYYY-MM-DDTHH:mm:00') : body.date,
        postPayload,
        body.tags,
        body.inter
      );

      if (!posts?.length) {
        return [] as any[];
      }

      if (body.type === 'update') {
        await this.updatePublishedPost(
          orgId,
          previousPost!,
          updateProvider!,
          posts
        );
      } else {
        this.startWorkflow(
          postPayload.settings.__type.split('-')[0].toLowerCase(),
          posts[0].id,
          orgId,
          posts[0].state
        ).catch((err) => {});
      }

      Sentry.metrics.count('post_created', 1);
      postList.push({
        postId: posts[0].id,
        integration: post.integration.id,
      });
    }

    return postList;
  }

  private async shouldCreateFreshPostIds(orgId: string, group?: string) {
    if (!group) {
      return false;
    }

    const existingPosts = await this._postRepository.getPostsByGroup(
      orgId,
      group
    );
    const existingRootPost = existingPosts.find((item) => !item.parentPostId);

    return (
      existingRootPost?.state === 'PUBLISHED' ||
      existingRootPost?.state === 'DELETED_REMOTE'
    );
  }

  private async loadPublishedUpdateTarget(
    orgId: string,
    group?: string,
    action = 'updated'
  ): Promise<Post & { integration: Integration }> {
    if (!group) {
      throw new BadRequestException(
        `The published post group is missing, so this post cannot be ${action}.`
      );
    }

    const previousPosts = await this._postRepository.getPostsByGroup(orgId, group);
    const previousPost = previousPosts.find((item) => !item.parentPostId);

    if (!previousPost?.integration) {
      throw new BadRequestException(
        'The original published post could not be found.'
      );
    }

    if (previousPost.state === 'DELETED_REMOTE') {
      throw new BadRequestException(
        'This post was already deleted on the platform.'
      );
    }

    if (!previousPost.releaseId || previousPost.releaseId === 'missing') {
      throw new BadRequestException(
        `This published post is missing its platform ID, so it cannot be ${action}.`
      );
    }

    return previousPost as Post & { integration: Integration };
  }

  private getUpdateProvider(
    previousPost: Post & { integration: Integration }
  ): SocialProvider {
    const integrationProvider = this._integrationManager.getSocialIntegration(
      previousPost.integration.providerIdentifier
    );
    const capabilities = integrationProvider.getPublishedCapabilities(
      previousPost.integration
    );

    if (capabilities.requiresReconnect) {
      throw new BadRequestException(
        capabilities.reason ||
          'Reconnect this channel to manage published posts.'
      );
    }

    if (!integrationProvider.update || capabilities.editMode === 'none') {
      throw new BadRequestException(
        capabilities.reason ||
          `${integrationProvider.name} does not support editing already-published posts yet.`
      );
    }

    return integrationProvider;
  }

  private getDeleteProvider(
    previousPost: Post & { integration: Integration }
  ): SocialProvider {
    const integrationProvider = this._integrationManager.getSocialIntegration(
      previousPost.integration.providerIdentifier
    );
    const capabilities = integrationProvider.getPublishedCapabilities(
      previousPost.integration
    );

    if (capabilities.requiresReconnect) {
      throw new BadRequestException(
        capabilities.reason ||
          'Reconnect this channel to manage published posts.'
      );
    }

    if (
      !integrationProvider.deletePublished ||
      !capabilities.canDeletePublished
    ) {
      throw new BadRequestException(
        capabilities.reason ||
          `${integrationProvider.name} does not support deleting already-published posts yet.`
      );
    }

    return integrationProvider;
  }

  private async buildPostDetailsForProvider(
    orgId: string,
    integrationProvider: SocialProvider,
    posts: Post[]
  ): Promise<PostDetails[]> {
    const newPosts = await this.updateTags(orgId, posts);

    return Promise.all(
      (newPosts || []).map(async (post) => ({
        id: post.id,
        message: stripHtmlValidation(
          integrationProvider.editor,
          post.content,
          true,
          false,
          !/<\/?[a-z][\s\S]*>/i.test(post.content),
          integrationProvider.mentionFormat
        ),
        settings: JSON.parse(post.settings || '{}'),
        media: await this.updateMedia(
          post.id,
          JSON.parse(post.image || '[]'),
          integrationProvider?.convertToJPEG || false
        ),
      }))
    );
  }

  private async markUpdatedPostsAsFailed(posts: Post[], error: unknown) {
    await Promise.all(
      posts.map((post, index) =>
        this._postRepository
          .changeState(
            post.id,
            'ERROR',
            index === 0 ? error : undefined,
            index === 0 ? posts : undefined
          )
          .catch(() => undefined)
      )
    );
  }

  private async getPublishedCommentActionTarget(
    orgId: string,
    postId: string,
    providerMethod: 'replyToComment' | 'hideComment' | 'deleteComment',
    action: string,
    forceRefresh = false
  ): Promise<{
    post: Post & { integration: Integration };
    integration: Integration;
    integrationProvider: SocialProvider;
  }> {
    const post = await this._postRepository.getPostById(postId, orgId);
    if (!post?.integration) {
      throw new BadRequestException(
        'The published post integration could not be found.'
      );
    }

    if (!post.releaseId || post.releaseId === 'missing') {
      throw new BadRequestException(
        `This published post is missing its platform ID, so comments cannot be managed.`
      );
    }

    const integrationProvider = this._integrationManager.getSocialIntegration(
      post.integration.providerIdentifier
    );

    if (!integrationProvider[providerMethod]) {
      throw new BadRequestException(
        `${integrationProvider.name} does not support ${action} published comments yet.`
      );
    }

    await this.ensurePublishedIntegrationAccess(
      orgId,
      post.integration,
      integrationProvider,
      undefined,
      forceRefresh
    );

    return {
      post: post as Post & { integration: Integration },
      integration: post.integration,
      integrationProvider,
    };
  }

  private async ensurePublishedIntegrationAccess(
    orgId: string,
    integration: Integration,
    integrationProvider: SocialProvider,
    onRefreshFailure?: () => Promise<void>,
    forceRefresh = false
  ) {
    if (
      forceRefresh ||
      (integration.tokenExpiration &&
        dayjs(integration.tokenExpiration).isBefore(dayjs()))
    ) {
      const data = await this._refreshIntegrationService.refresh(integration);

      if (!data || !data.accessToken) {
        await this._integrationService.disconnectChannel(orgId, integration);
        await onRefreshFailure?.();
        throw new BadRequestException(
          'Token expired or invalid, please reconnect this channel.'
        );
      }

      integration.token = data.accessToken;

      if (integrationProvider.refreshWait) {
        await timer(10000);
      }
    }
  }

  private getFacebookCommentReconnectResponse(
    message = FACEBOOK_COMMENT_RECONNECT_MESSAGE
  ): PublishedCommentsResult {
    return {
      supported: true,
      reconnectRequired: true,
      message,
      comments: [],
    };
  }

  private getInstagramCommentReconnectResponse(
    message = INSTAGRAM_COMMENT_RECONNECT_MESSAGE
  ): PublishedCommentsResult {
    return {
      supported: true,
      reconnectRequired: true,
      message,
      comments: [],
    };
  }

  private isInstagramCommentReconnectMessage(message: string) {
    const lowerMessage = message.toLowerCase();
    return (
      lowerMessage.includes('reconnect instagram') ||
      lowerMessage.includes('token expired') ||
      lowerMessage.includes('token expired or invalid') ||
      lowerMessage.includes('session has been invalidated')
    );
  }

  private getCommentReconnectMessage(integrationProvider: SocialProvider) {
    if (integrationProvider.identifier === 'instagram') {
      return 'Token expired or invalid. Reconnect Instagram.';
    }

    if (integrationProvider.identifier === 'facebook') {
      return FACEBOOK_COMMENT_RECONNECT_MESSAGE;
    }

    return 'Token expired or invalid, please reconnect this channel.';
  }

  private logPublishedCommentFailure(
    action: string,
    integrationProvider: SocialProvider,
    post: (Post & { integration?: Integration }) | null | undefined,
    commentId: string | undefined,
    error: unknown
  ) {
    console.error('Published comment management failed', {
      action,
      provider: integrationProvider.identifier,
      localPostId: post?.id,
      platformMediaId: post?.releaseId,
      platformCommentId: commentId,
      message: error instanceof Error ? error.message : String(error),
    });
  }

  private async updatePublishedPost(
    orgId: string,
    previousPost: Post & { integration: Integration },
    integrationProvider: SocialProvider,
    posts: Post[],
    forceRefresh = false
  ): Promise<void> {
    const integration = previousPost.integration;
    await this.ensurePublishedIntegrationAccess(
      orgId,
      integration,
      integrationProvider,
      async () => {
        await this.markUpdatedPostsAsFailed(
          posts,
          'Token expired or invalid, please reconnect this channel.'
        );
      },
      forceRefresh
    );

    try {
      const results = await integrationProvider.update!(
        integration.internalId,
        integration.token,
        previousPost.releaseId!,
        await this.buildPostDetailsForProvider(orgId, integrationProvider, posts),
        integration
      );

      if (!results?.length) {
        throw new BadRequestException(
          'The platform did not return an update result.'
        );
      }

      await Promise.all(
        posts.map((post, index) => {
          const result = results[index] || results[0];
          return this._postRepository.updatePost(
            post.id,
            result?.postId || previousPost.releaseId!,
            result?.releaseURL || previousPost.releaseURL || ''
          );
        })
      );
    } catch (error) {
      if (error instanceof RefreshToken) {
        return this.updatePublishedPost(
          orgId,
          previousPost,
          integrationProvider,
          posts,
          true
        );
      }

      await this.markUpdatedPostsAsFailed(posts, error);

      if (error instanceof BadBody) {
        throw new BadRequestException(
          error.message || 'Failed to update the published post.'
        );
      }

      throw error;
    }
  }

  async separatePosts(content: string, len: number) {
    return this._openaiService.separatePosts(content, len);
  }

  async changeState(id: string, state: State, err?: any, body?: any) {
    return this._postRepository.changeState(id, state, err, body);
  }

  async changeDate(
    orgId: string,
    id: string,
    date: string,
    action: 'schedule' | 'update' = 'schedule'
  ) {
    const getPostById = await this._postRepository.getPostById(id, orgId);

    // schedule: Set status to QUEUE and change date (reschedule the post)
    // update: Just change the date without changing the status
    const newDate = await this._postRepository.changeDate(
      orgId,
      id,
      date,
      getPostById.state === 'DRAFT',
      action
    );

    if (action === 'schedule') {
      try {
        await this.startWorkflow(
          getPostById.integration.providerIdentifier.split('-')[0].toLowerCase(),
          getPostById.id,
          orgId,
          getPostById.state === 'DRAFT' ? 'DRAFT' : 'QUEUE'
        );
      } catch (err) {}
    }

    return newDate;
  }

  async generatePostsDraft(orgId: string, body: CreateGeneratedPostsDto) {
    const getAllIntegrations = (
      await this._integrationService.getIntegrationsList(orgId)
    ).filter((f) => !f.disabled && f.providerIdentifier !== 'reddit');

    // const posts = chunk(body.posts, getAllIntegrations.length);
    const allDates = dayjs()
      .isoWeek(body.week)
      .year(body.year)
      .startOf('isoWeek');

    const dates = [...new Array(7)].map((_, i) => {
      return allDates.add(i, 'day').format('YYYY-MM-DD');
    });

    const findTime = (): string => {
      const totalMinutes = Math.floor(Math.random() * 144) * 10;

      // Convert total minutes to hours and minutes
      const hours = Math.floor(totalMinutes / 60);
      const minutes = totalMinutes % 60;

      // Format hours and minutes to always be two digits
      const formattedHours = hours.toString().padStart(2, '0');
      const formattedMinutes = minutes.toString().padStart(2, '0');
      const randomDate =
        shuffle(dates)[0] + 'T' + `${formattedHours}:${formattedMinutes}:00`;

      if (dayjs(randomDate).isBefore(dayjs())) {
        return findTime();
      }

      return randomDate;
    };

    for (const integration of getAllIntegrations) {
      for (const toPost of body.posts) {
        const group = makeId(10);
        const randomDate = findTime();

        await this.createPost(orgId, {
          type: 'draft',
          date: randomDate,
          order: '',
          shortLink: false,
          tags: [],
          posts: [
            {
              group,
              integration: {
                id: integration.id,
              },
              settings: {
                __type: integration.providerIdentifier as any,
                title: '',
                tags: [],
                subreddit: [],
              },
              value: [
                ...toPost.list.map((l) => ({
                  id: '',
                  content: l.post,
                  delay: 0,
                  image: [],
                })),
                {
                  id: '',
                  delay: 0,
                  content: `Check out the full story here:\n${
                    body.postId || body.url
                  }`,
                  image: [],
                },
              ],
            },
          ],
        });
      }
    }
  }

  findAllExistingCategories() {
    return this._postRepository.findAllExistingCategories();
  }

  findAllExistingTopicsOfCategory(category: string) {
    return this._postRepository.findAllExistingTopicsOfCategory(category);
  }

  findPopularPosts(category: string, topic?: string) {
    return this._postRepository.findPopularPosts(category, topic);
  }

  async findFreeDateTime(orgId: string, integrationId?: string) {
    const findTimes = await this._integrationService.findFreeDateTime(
      orgId,
      integrationId
    );
    return this.findFreeDateTimeRecursive(
      orgId,
      findTimes,
      dayjs.utc().startOf('day')
    );
  }

  async createPopularPosts(post: {
    category: string;
    topic: string;
    content: string;
    hook: string;
  }) {
    return this._postRepository.createPopularPosts(post);
  }

  private async findFreeDateTimeRecursive(
    orgId: string,
    times: number[],
    date: dayjs.Dayjs
  ): Promise<string> {
    const list = await this._postRepository.getPostsCountsByDates(
      orgId,
      times,
      date
    );

    if (!list.length) {
      return this.findFreeDateTimeRecursive(orgId, times, date.add(1, 'day'));
    }

    const num = list.reduce<null | number>((prev, curr) => {
      if (prev === null || prev > curr) {
        return curr;
      }
      return prev;
    }, null) as number;

    return date.clone().add(num, 'minutes').format('YYYY-MM-DDTHH:mm:00');
  }

  getComments(postId: string) {
    return this._postRepository.getComments(postId);
  }

  getTags(orgId: string) {
    return this._postRepository.getTags(orgId);
  }

  createTag(orgId: string, body: CreateTagDto) {
    return this._postRepository.createTag(orgId, body);
  }

  editTag(id: string, orgId: string, body: CreateTagDto) {
    return this._postRepository.editTag(id, orgId, body);
  }

  deleteTag(id: string, orgId: string) {
    return this._postRepository.deleteTag(id, orgId);
  }

  createComment(
    orgId: string,
    userId: string,
    postId: string,
    comment: string
  ) {
    return this._postRepository.createComment(orgId, userId, postId, comment);
  }
}
