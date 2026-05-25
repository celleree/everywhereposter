import {
  AnalyticsData,
  AuthTokenDetails,
  HistoricalMediaPage,
  PublishedComment,
  PublishedCommentActionResponse,
  PublishedDeleteResponse,
  PostDetails,
  PostResponse,
  SocialProvider,
} from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import { timer } from '@gitroom/helpers/utils/timer';
import dayjs from 'dayjs';
import {
  BadBody,
  RefreshToken,
  SocialAbstract,
} from '@gitroom/nestjs-libraries/integrations/social.abstract';
import { InstagramDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/instagram.dto';
import { Integration } from '@prisma/client';
import { Rules } from '@gitroom/nestjs-libraries/chat/rules.description.decorator';
import sharp from 'sharp';

type InstagramMediaCreateDiagnostics = {
  mediaUrl?: string;
  mediaType?: string;
  isVideo: boolean;
  selectedMediaType?: string;
  postType?: string;
  post_type?: string;
  resolvedPostType?: string;
  postTypeWasExplicit?: boolean;
  thumbOffset?: string;
  isStory: boolean;
  isReel: boolean;
  isCarousel: boolean;
  isCarouselItem: boolean;
  isTrialReel: boolean;
  createParams?: Record<string, string>;
  publicUrlPreflight?: InstagramPublicUrlPreflight;
  imageFile?: InstagramImageFileDiagnostics;
  httpStatus?: number | string;
  graphResponse?: any;
  graphError?: string;
};

type InstagramPublicUrlPreflight = {
  method: 'HEAD' | 'GET';
  status: number;
  finalUrl: string;
  contentType: string;
  contentLength: string;
  cfCacheStatus: string;
  redirected: boolean;
};

type InstagramImageFileDiagnostics = {
  format?: string;
  width?: number;
  height?: number;
  aspectRatio?: number;
  space?: string;
  channels?: number;
  depth?: string;
  hasAlpha?: boolean;
  isProgressive?: boolean;
  hasProfile?: boolean;
  orientation?: number;
  size: number;
};

@Rules(
  "Instagram should have at least one attachment, if it's a story, it can have only one picture"
)
export class InstagramProvider
  extends SocialAbstract
  implements SocialProvider
{
  identifier = 'instagram';
  name = 'Instagram\n(Facebook Business)';
  isBetweenSteps = true;
  toolTip = 'Instagram must be business and connected to a Facebook page';
  scopes = [
    'instagram_basic',
    'pages_show_list',
    'pages_read_engagement',
    'business_management',
    'instagram_content_publish',
    'instagram_manage_comments',
    'instagram_manage_insights',
  ];
  override maxConcurrentJob = 400;
  editor = 'normal' as const;
  dto = InstagramDto;
  convertToJPEG = true;
  private getAccountLabel(name?: string, username?: string) {
    return username || name || '';
  }
  maxLength() {
    return 2200;
  }

  override getPublishedCapabilities(integration?: Integration) {
    return this.buildPublishedCapabilities(integration, {
      editMode: 'none',
      canDeletePublished: true,
    });
  }

  async refreshToken(refresh_token: string): Promise<AuthTokenDetails> {
    return {
      refreshToken: '',
      expiresIn: 0,
      accessToken: '',
      id: '',
      name: '',
      picture: '',
      username: '',
    };
  }

  public override handleErrors(
    body: string,
    status: number
  ):
    | {
        type: 'refresh-token' | 'bad-body' | 'retry';
        value: string;
      }
    | undefined {
    if (body.indexOf('An unknown error occurred') > -1) {
      return {
        type: 'retry' as const,
        value: 'An unknown error occurred, please try again later',
      };
    }
    if (body.indexOf('2207081') > -1) {
      return {
        type: 'bad-body' as const,
        value: "This account doesn't support Trial Reels",
      };
    }

    if (body.indexOf('REVOKED_ACCESS_TOKEN') > -1) {
      return {
        type: 'refresh-token' as const,
        value:
          'Something is wrong with your connected user, please re-authenticate',
      };
    }

    if (
      body.toLowerCase().indexOf('the user is not an instagram business') > -1
    ) {
      return {
        type: 'refresh-token' as const,
        value:
          'Your Instagram account is not a business account, please convert it to a business account',
      };
    }

    if (body.toLowerCase().indexOf('session has been invalidated') > -1) {
      return {
        type: 'refresh-token' as const,
        value: 'You session has been invalidated, this can usually happen from frequent posting, please re-authenticate, and wait 1-2 days before posting again',
      };
    }

    if (body.indexOf('2207050') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Instagram user is restricted',
      };
    }

    // Media download/upload errors
    if (body.indexOf('2207003') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Timeout downloading media, please try again',
      };
    }

    if (body.indexOf('2207020') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Media expired, please upload again',
      };
    }

    if (body.indexOf('2207032') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Failed to create media, please try again',
      };
    }

    if (body.indexOf('2207053') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Unknown upload error, please try again',
      };
    }

    if (body.indexOf('2207052') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Media fetch failed, please try again',
      };
    }

    if (body.indexOf('2207057') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Invalid thumbnail offset for video',
      };
    }

    if (body.indexOf('2207026') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Unsupported video format',
      };
    }

    if (body.indexOf('2207023') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Unknown media type',
      };
    }

    if (body.indexOf('2207006') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Media not found, please upload again',
      };
    }

    if (body.indexOf('2207008') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Media builder expired, please try again',
      };
    }

    // Content validation errors
    if (body.indexOf('2207028') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Carousel validation failed',
      };
    }

    if (body.indexOf('2207010') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Caption is too long',
      };
    }

    // Product tagging errors
    if (body.indexOf('2207035') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Product tag positions not supported for videos',
      };
    }

    if (body.indexOf('2207036') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Product tag positions required for photos',
      };
    }

    if (body.indexOf('2207037') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Product tag validation failed',
      };
    }

    if (body.indexOf('2207040') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Too many product tags',
      };
    }

    // Image format/size errors
    if (body.indexOf('2207004') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Image is too large',
      };
    }

    if (body.indexOf('2207005') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Unsupported image format',
      };
    }

    if (body.indexOf('2207009') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Aspect ratio not supported, must be between 4:5 to 1.91:1',
      };
    }

    if (body.indexOf('Page request limit reached') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Page posting for today is limited, please try again tomorrow',
      };
    }

    if (body.indexOf('2207042') > -1) {
      return {
        type: 'bad-body' as const,
        value:
          'You have reached the maximum of 25 posts per day, allowed for your account',
      };
    }

    if (body.indexOf('Not enough permissions to post') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Not enough permissions to post',
      };
    }

    if (body.indexOf('36003') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Aspect ratio not supported, must be between 4:5 to 1.91:1',
      };
    }

    if (body.indexOf('190,') > -1) {
      return {
        type: 'bad-body' as const,
        value:
          'The account is missing some permissions to perform this action, please re-add the account and allow all permissions',
      };
    }

    if (body.indexOf('36001') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Invalid Instagram image resolution max: 1920x1080px',
      };
    }

    if (body.indexOf('2207051') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Instagram blocked your request',
      };
    }

    if (body.indexOf('2207001') > -1) {
      return {
        type: 'bad-body' as const,
        value:
          'Instagram detected that your post is spam, please try again with different content',
      };
    }

    if (body.indexOf('2207027') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Unknown error, please try again later or contact support',
      };
    }

    if (body.indexOf('param collaborators is not allowed') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Collaborators are not allowed for carousel',
      };
    }

    const graphError = this.getGraphApiError(body);
    if (graphError?.message) {
      const message = this.formatGraphApiErrorMessage(graphError);

      return {
        type:
          status === 401 || graphError.code === '190'
            ? ('refresh-token' as const)
            : ('bad-body' as const),
        value: message,
      };
    }

    return undefined;
  }

  async reConnect(
    id: string,
    requiredId: string,
    accessToken: string
  ): Promise<Omit<AuthTokenDetails, 'refreshToken' | 'expiresIn'>> {
    const findPage = (await this.pages(accessToken)).find(
      (p) => p.id === requiredId
    );

    const information = await this.fetchPageInformation(accessToken, {
      id: requiredId,
      pageId: findPage?.pageId!,
    });

    return {
      id: information.id,
      name: information.name,
      accessToken: information.access_token,
      picture: information.picture,
      username: information.username,
    };
  }

  async generateAuthUrl() {
    const state = makeId(6);
    return {
      url:
        'https://www.facebook.com/v20.0/dialog/oauth' +
        `?client_id=${process.env.FACEBOOK_APP_ID}` +
        `&redirect_uri=${encodeURIComponent(
          `${process.env.FRONTEND_URL}/integrations/social/instagram`
        )}` +
        `&state=${state}` +
        `&scope=${encodeURIComponent(this.scopes.join(','))}`,
      codeVerifier: makeId(10),
      state,
    };
  }

  async authenticate(params: {
    code: string;
    codeVerifier: string;
    refresh: string;
  }) {
    const getAccessToken = await (
      await fetch(
        'https://graph.facebook.com/v20.0/oauth/access_token' +
          `?client_id=${process.env.FACEBOOK_APP_ID}` +
          `&redirect_uri=${encodeURIComponent(
            `${process.env.FRONTEND_URL}/integrations/social/instagram${
              params.refresh ? `?refresh=${params.refresh}` : ''
            }`
          )}` +
          `&client_secret=${process.env.FACEBOOK_APP_SECRET}` +
          `&code=${params.code}`
      )
    ).json();

    const { access_token, expires_in, ...all } = await (
      await fetch(
        'https://graph.facebook.com/v20.0/oauth/access_token' +
          '?grant_type=fb_exchange_token' +
          `&client_id=${process.env.FACEBOOK_APP_ID}` +
          `&client_secret=${process.env.FACEBOOK_APP_SECRET}` +
          `&fb_exchange_token=${getAccessToken.access_token}`
      )
    ).json();

    const { data } = await (
      await fetch(
        `https://graph.facebook.com/v20.0/me/permissions?access_token=${access_token}`
      )
    ).json();

    const permissions = data
      .filter((d: any) => d.status === 'granted')
      .map((p: any) => p.permission);
    this.checkScopes(this.scopes, permissions);

    const { id, name, picture } = await (
      await fetch(
        `https://graph.facebook.com/v20.0/me?fields=id,name,picture&access_token=${access_token}`
      )
    ).json();

    return {
      id,
      name,
      accessToken: access_token,
      refreshToken: access_token,
      expiresIn: dayjs().add(59, 'days').unix() - dayjs().unix(),
      picture: picture?.data?.url || '',
      username: '',
    };
  }

  async pages(accessToken: string) {
    const seenPageIds = new Set<string>();
    const allFacebookPages: any[] = [];

    const fetchPaginated = async (startUrl: string) => {
      let nextUrl: string | undefined = startUrl;
      while (nextUrl) {
        const response = await (await fetch(nextUrl)).json();
        if (response.data) {
          for (const page of response.data) {
            if (!seenPageIds.has(page.id)) {
              seenPageIds.add(page.id);
              allFacebookPages.push(page);
            }
          }
        }
        nextUrl = response.paging?.next;
      }
    };

    // Fetch pages the user explicitly shared during the OAuth dialog
    await fetchPaginated(
      `https://graph.facebook.com/v20.0/me/accounts?fields=id,instagram_business_account,username,name,picture.type(large)&limit=100&access_token=${accessToken}`
    );

    // Also fetch pages via Business Manager API to discover pages
    // not selected during the OAuth page selection step
    try {
      let bizUrl:
        | string
        | undefined = `https://graph.facebook.com/v20.0/me/businesses?access_token=${accessToken}`;

      while (bizUrl) {
        const bizResponse = await (await fetch(bizUrl)).json();
        if (bizResponse.data) {
          for (const business of bizResponse.data) {
            try {
              await fetchPaginated(
                `https://graph.facebook.com/v20.0/${business.id}/owned_pages?fields=id,instagram_business_account,username,name,picture.type(large)&limit=100&access_token=${accessToken}`
              );
            } catch {
              // Continue with other businesses
            }

            try {
              await fetchPaginated(
                `https://graph.facebook.com/v20.0/${business.id}/client_pages?fields=id,instagram_business_account,username,name,picture.type(large)&limit=100&access_token=${accessToken}`
              );
            } catch {
              // Continue with other businesses
            }
          }
        }
        bizUrl = bizResponse.paging?.next;
      }
    } catch {
      // Business Manager API not available for all users
    }

    const onlyConnectedAccounts = await Promise.all(
      allFacebookPages
        .filter((f: any) => f.instagram_business_account)
        .map(async (p: any) => {
          const account = await (
            await fetch(
              `https://graph.facebook.com/v20.0/${p.instagram_business_account.id}?fields=name,username,profile_picture_url&access_token=${accessToken}`
            )
          ).json();

          return {
            pageId: p.id,
            ...account,
            id: p.instagram_business_account.id,
          };
        })
    );

    return onlyConnectedAccounts.map((p: any) => ({
      pageId: p.pageId,
      id: p.id,
      name: this.getAccountLabel(p.name, p.username),
      username: p.username,
      picture: { data: { url: p.profile_picture_url } },
    }));
  }

  async fetchPageInformation(
    accessToken: string,
    data: { pageId: string; id: string }
  ) {
    const { access_token, ...all } = await (
      await fetch(
        `https://graph.facebook.com/v20.0/${data.pageId}?fields=access_token,name,picture.type(large)&access_token=${accessToken}`
      )
    ).json();

    const { id, name, profile_picture_url, username } = await (
      await fetch(
        `https://graph.facebook.com/v20.0/${data.id}?fields=username,name,profile_picture_url&access_token=${accessToken}`
      )
    ).json();

    return {
      id,
      name: this.getAccountLabel(name, username),
      picture: profile_picture_url,
      access_token,
      username,
    };
  }

  async post(
    id: string,
    accessToken: string,
    postDetails: PostDetails<InstagramDto>[],
    integration: Integration,
    type = 'graph.facebook.com'
  ): Promise<PostResponse[]> {
    const [firstPost] = postDetails;
    if (!firstPost?.media?.length) {
      throw new BadBody(
        'instagram',
        '{}',
        '{}',
        'Instagram publishing requires at least one image or video.'
      );
    }

    const isTrialReel = !!firstPost.settings.is_trial_reel;
    const mediaCount = firstPost.media.length;
    const hasVideo = firstPost.media.some((media) =>
      this.isVideoMedia(media, this.getPublicMediaUrl(media))
    );
    const validPostTypes = ['post', 'reel', 'story'];
    const rawPostType = firstPost.settings.post_type;
    const hasValidPostType = validPostTypes.includes(String(rawPostType));
    const rawPostTypeExplicit = (firstPost.settings as any).post_type_explicit;
    const postTypeExplicit =
      rawPostTypeExplicit === true || rawPostTypeExplicit === 'true';
    const isStandaloneVideo = mediaCount === 1 && hasVideo;
    const resolvedPostType = hasValidPostType
      ? rawPostType
      : isStandaloneVideo
      ? 'reel'
      : 'post';
    const postTypeWasExplicit =
      rawPostTypeExplicit === false || rawPostTypeExplicit === 'false'
        ? false
        : hasValidPostType || postTypeExplicit;
    const isStory = resolvedPostType === 'story';
    const isCarousel = mediaCount > 1 && !isStory;
    const isExplicitReel =
      !isStory && (resolvedPostType === 'reel' || isTrialReel);

    if (isTrialReel && isStory) {
      throw new BadBody(
        'instagram_reel_validation',
        '{}',
        '{}',
        'Instagram Trial Reels must use Reel as the post type, not Story.'
      );
    }

    if (isExplicitReel && (mediaCount !== 1 || !hasVideo)) {
      throw new BadBody(
        'instagram_reel_validation',
        '{}',
        '{}',
        'Instagram Reels require exactly one video.'
      );
    }

    const medias = await Promise.all(
      firstPost?.media?.map(async (m) => {
        const params = new URLSearchParams({
          access_token: accessToken,
        });

        const mediaUrl = this.getPublicMediaUrl(m);
        const isVideo = this.isVideoMedia(m, mediaUrl);
        const thumbOffset = String(m?.thumbnailTimestamp || 0);
        let selectedMediaType = '';

        if (isVideo) {
          params.set('video_url', mediaUrl);
          selectedMediaType = isStory
            ? 'STORIES'
            : isExplicitReel
            ? 'REELS'
            : 'VIDEO';
          params.set('media_type', selectedMediaType);
          params.set('thumb_offset', thumbOffset);
        } else {
          params.set('image_url', mediaUrl);
          if (isStory) {
            selectedMediaType = 'STORIES';
            params.set('media_type', 'STORIES');
          }
        }

        if (mediaCount === 1) {
          params.set('caption', firstPost.message);
        }

        if (isCarousel) {
          params.set('is_carousel_item', 'true');
        }

        if (isTrialReel) {
          params.set(
            'trial_params',
            JSON.stringify({
              graduation_strategy:
                firstPost.settings.graduation_strategy || 'MANUAL',
            })
          );
        }

        if (firstPost?.settings?.collaborators?.length && !isStory) {
          params.set(
            'collaborators',
            JSON.stringify(firstPost?.settings?.collaborators.map((p) => p.label))
          );
        }

        const diagnostics: InstagramMediaCreateDiagnostics = {
          mediaUrl,
          mediaType: m.type,
          isVideo,
          selectedMediaType,
          postType: rawPostType,
          post_type: rawPostType,
          resolvedPostType,
          postTypeWasExplicit,
          thumbOffset: isVideo ? thumbOffset : undefined,
          isStory,
          isReel: selectedMediaType === 'REELS',
          isCarousel,
          isCarouselItem: isCarousel,
          isTrialReel,
          createParams: this.getSafeInstagramParams(params),
        };

        try {
          if (isVideo) {
            await this.validatePublicVideoUrl(mediaUrl, diagnostics);
          } else {
            await this.validatePublicImageUrl(mediaUrl, diagnostics);
          }

          const { id: photoId } = await this.fetchInstagramJson<{ id?: string }>(
            `https://${type}/v20.0/${id}/media`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
              },
              body: params,
            },
            'instagram_media_create'
          );

          if (!photoId) {
            throw new BadBody(
              'instagram_media_create',
              '{}',
              '{}',
              'Instagram did not return a media container id.'
            );
          }

          await this.waitForMediaContainer(
            photoId,
            accessToken,
            type,
            'instagram_media_create',
            diagnostics
          );

          return photoId;
        } catch (error) {
          if (!isVideo) {
            this.throwInstagramImageMediaCreateFailure(diagnostics, error);
          }

          this.logInstagramMediaCreateFailure(diagnostics, error);
          throw error;
        }
      }) || []
    );

    if (isStory && medias.length > 1) {
      // Stories don't support carousels - publish each media as a separate story
      let lastMediaId = '';
      let lastPermalink = '';
      for (const mediaCreationId of medias) {
        const mediaId = await this.publishMediaContainer(
          id,
          accessToken,
          mediaCreationId,
          type
        );
        lastMediaId = mediaId;
        lastPermalink = await this.getPermalink(mediaId, accessToken, type);
      }

      return [
        {
          id: firstPost.id,
          postId: lastMediaId,
          releaseURL: lastPermalink,
          status: 'success',
        },
      ];
    } else if (medias.length === 1) {
      const mediaId = await this.publishMediaContainer(
        id,
        accessToken,
        medias[0],
        type
      );
      const permalink = await this.getPermalink(mediaId, accessToken, type);

      return [
        {
          id: firstPost.id,
          postId: mediaId,
          releaseURL: permalink,
          status: 'success',
        },
      ];
    } else {
      const params = new URLSearchParams({
        caption: firstPost?.message,
        media_type: 'CAROUSEL',
        children: medias.join(','),
        access_token: accessToken,
      });
      const { id: containerId } = await this.fetchInstagramJson<{ id?: string }>(
        `https://${type}/v20.0/${id}/media`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: params,
        },
        'instagram_carousel_create'
      );

      if (!containerId) {
        throw new BadBody(
          'instagram_carousel_create',
          '{}',
          '{}',
          'Instagram did not return a carousel container id.'
        );
      }

      await this.waitForMediaContainer(
        containerId,
        accessToken,
        type,
        'instagram_carousel_create',
        {
          isVideo: medias.some(Boolean) && firstPost.media.some((media) =>
            this.isVideoMedia(media, this.getPublicMediaUrl(media))
          ),
          postType: rawPostType,
          post_type: rawPostType,
          resolvedPostType,
          postTypeWasExplicit,
          isStory,
          isReel: false,
          isCarousel: true,
          isCarouselItem: false,
          isTrialReel,
          createParams: this.getSafeInstagramParams(params),
        }
      );

      const mediaId = await this.publishMediaContainer(
        id,
        accessToken,
        containerId,
        type
      );
      const permalink = await this.getPermalink(mediaId, accessToken, type);

      return [
        {
          id: firstPost.id,
          postId: mediaId,
          releaseURL: permalink,
          status: 'success',
        },
      ];
    }
  }

  private getGraphApiError(body: string) {
    try {
      const parsed = JSON.parse(body || '{}');
      const error = parsed?.error;
      if (!error) {
        return undefined;
      }

      return {
        message:
          error.error_user_msg ||
          error.message ||
          error.error_user_title ||
          'Instagram Graph API returned an error.',
        code: error.code ? String(error.code) : '',
        subcode: error.error_subcode ? String(error.error_subcode) : '',
      };
    } catch {
      return undefined;
    }
  }

  private formatGraphApiErrorMessage(graphError: {
    message: string;
    code: string;
    subcode: string;
  }) {
    const code = [graphError.code, graphError.subcode]
      .filter(Boolean)
      .join('/');
    const messageWithCode = `Instagram Graph API error${
      code ? ` (${code})` : ''
    }: ${graphError.message}`;
    const lowerMessage = graphError.message.toLowerCase();

    if (graphError.code === '190' || lowerMessage.includes('access token')) {
      return `Token expired or invalid. Reconnect Instagram. Meta said: ${messageWithCode}`;
    }

    if (
      lowerMessage.includes('instagram_manage_comments') ||
      lowerMessage.includes('manage_comments')
    ) {
      return `Reconnect Instagram and grant instagram_manage_comments. Meta said: ${messageWithCode}`;
    }

    if (
      lowerMessage.includes('unsupported') ||
      lowerMessage.includes('does not exist') ||
      lowerMessage.includes('cannot be loaded')
    ) {
      return `Instagram media/comment is not accessible. Confirm the saved platform media ID and selected Instagram comment ID are correct for this connected account. Meta said: ${messageWithCode}`;
    }

    if (
      lowerMessage.includes('permission') ||
      graphError.code === '10' ||
      graphError.code === '200'
    ) {
      return `Meta blocked this Instagram Graph call. Confirm the Meta user is an app Admin, Developer, or Tester, manages the connected Facebook Page, and granted the required Instagram permissions. Meta said: ${messageWithCode}`;
    }

    return messageWithCode;
  }

  private isAlreadyDeletedInstagramDeleteError(error: unknown) {
    const message = error instanceof Error ? error.message.toLowerCase() : '';
    const details = JSON.stringify((error as any)?.details || '').toLowerCase();

    return (
      message.includes('already deleted') ||
      details.includes('already deleted') ||
      details.includes('already_deleted')
    );
  }

  private async fetchInstagramJson<T>(
    url: string,
    options: RequestInit = {},
    identifier = 'instagram',
    totalRetries = 0
  ): Promise<T> {
    const requestBodyForDiagnostics = this.getSafeInstagramRequestBody(
      options.body
    );
    const response = await fetch(url, options);
    let body = '';

    try {
      body = await response.text();
    } catch {
      body = '';
    }

    const bodyForError = body || '{}';
    const handleError = this.handleErrors(bodyForError, response.status);

    if (
      response.status === 429 ||
      (response.status === 500 && !handleError) ||
      body.includes('rate_limit_exceeded') ||
      body.includes('Rate limit') ||
      handleError?.type === 'retry'
    ) {
      if (totalRetries > 2) {
        throw new BadBody(
          identifier,
          bodyForError,
          requestBodyForDiagnostics,
          handleError?.value ||
            `Instagram Graph API request failed after retries (${response.status}).`
        );
      }

      await timer(5000);
      return this.fetchInstagramJson<T>(
        url,
        options,
        identifier,
        totalRetries + 1
      );
    }

    if (
      (response.status === 401 &&
        (handleError?.type === 'refresh-token' || !handleError)) ||
      handleError?.type === 'refresh-token'
    ) {
      throw new RefreshToken(
        identifier,
        bodyForError,
        requestBodyForDiagnostics,
        handleError?.value
      );
    }

    if (!body.trim()) {
      throw new BadBody(
        identifier,
        bodyForError,
        requestBodyForDiagnostics,
        `Instagram Graph API returned an empty response (${response.status}).`
      );
    }

    let payload: any;
    try {
      payload = JSON.parse(body);
    } catch {
      throw new BadBody(
        identifier,
        bodyForError,
        requestBodyForDiagnostics,
        `Instagram Graph API returned a non-JSON response (${response.status}).`
      );
    }

    if (!response.ok) {
      const json = JSON.stringify(payload);
      const graphError = this.getGraphApiError(json);
      throw new BadBody(
        identifier,
        json,
        requestBodyForDiagnostics,
        handleError?.value ||
          graphError?.message ||
          `Instagram Graph API request failed (${response.status}).`
      );
    }

    if (payload?.error) {
      const json = JSON.stringify(payload);
      throw new BadBody(
        identifier,
        json,
        requestBodyForDiagnostics,
        this.handleErrors(json, response.status)?.value ||
          'Instagram Graph API returned an error.'
      );
    }

    return payload;
  }

  private getPublicMediaUrl(media: NonNullable<PostDetails['media']>[number]) {
    const mediaUrl = String((media as any).url || media.path || '').trim();

    if (!mediaUrl) {
      throw new BadBody(
        'instagram_media_url',
        '{}',
        '{}',
        'Instagram media is missing a public URL.'
      );
    }

    let parsed: URL;
    try {
      parsed = new URL(mediaUrl);
    } catch {
      throw new BadBody(
        'instagram_media_url',
        '{}',
        '{}',
        `Instagram media URL is invalid or not a public HTTPS URL: ${mediaUrl}`
      );
    }

    const hostname = parsed.hostname.toLowerCase();
    if (parsed.protocol !== 'https:' || this.isLocalOrPrivateHost(hostname)) {
      throw new BadBody(
        'instagram_media_url',
        '{}',
        '{}',
        `Instagram media URL must be a publicly reachable HTTPS URL for Meta: ${mediaUrl}`
      );
    }

    return mediaUrl;
  }

  private isVideoMedia(
    media: NonNullable<PostDetails['media']>[number],
    mediaUrl: string
  ) {
    return (
      media.type === 'video' ||
      mediaUrl.toLowerCase().split('?')[0].includes('.mp4')
    );
  }

  private getSafeInstagramParams(params: URLSearchParams) {
    return Array.from(params.entries()).reduce<Record<string, string>>(
      (acc, [key, value]) => {
        if (key.toLowerCase().includes('token')) {
          return acc;
        }

        acc[key] = value;
        return acc;
      },
      {}
    );
  }

  private getSafeInstagramRequestBody(body?: BodyInit | null): BodyInit {
    if (!body) {
      return '{}';
    }

    if (body instanceof URLSearchParams) {
      return (
        this.safeStringifyDiagnostics(this.getSafeInstagramParams(body)) || '{}'
      );
    }

    if (typeof body === 'string') {
      const trimmed = body.trim();
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
          return this.safeStringifyDiagnostics(JSON.parse(trimmed)) || '{}';
        } catch {}
      }

      try {
        const params = new URLSearchParams(body);
        if (body.includes('=') || body.includes('&')) {
          return (
            this.safeStringifyDiagnostics(this.getSafeInstagramParams(params)) ||
            '{}'
          );
        }
      } catch {}

      return body
        .replace(/(access_token=)[^&\s]+/gi, '$1[redacted]')
        .replace(/("access_token"\s*:\s*")[^"]+/gi, '$1[redacted]');
    }

    return this.safeStringifyDiagnostics(body) || '{}';
  }

  private safeStringifyDiagnostics(value: any) {
    return JSON.stringify(value, (key, item) => {
      if (key.toLowerCase().includes('token')) {
        return '[redacted]';
      }

      return item;
    });
  }

  private parseDiagnosticJson(value: any) {
    if (typeof value !== 'string' || !value.trim()) {
      return undefined;
    }

    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }

  private getInstagramFailureDetails(error: unknown) {
    const failure = error as any;
    const details = Array.isArray(failure?.details)
      ? failure.details[0]
      : undefined;
    const graphResponse = this.parseDiagnosticJson(details?.json);

    return {
      identifier:
        typeof details?.identifier === 'string' ? details.identifier : '',
      message:
        error instanceof Error
          ? error.message
          : typeof error === 'string'
          ? error
          : 'Unknown Instagram media create error',
      graphResponse,
      body: details?.body,
    };
  }

  private throwInstagramImageMediaCreateFailure(
    diagnostics: InstagramMediaCreateDiagnostics,
    error: unknown
  ): never {
    const failure = this.getInstagramFailureDetails(error);
    const imageDiagnostics: InstagramMediaCreateDiagnostics = {
      ...diagnostics,
      httpStatus:
        diagnostics.httpStatus ||
        diagnostics.publicUrlPreflight?.status ||
        'unavailable from Instagram fetch wrapper',
      graphResponse: failure.graphResponse,
      graphError: failure.message,
    };

    throw new BadBody(
      failure.identifier || 'instagram_media_create',
      this.safeStringifyDiagnostics(failure.graphResponse || {}) || '{}',
      failure.body || '{}',
      `Instagram image media create failed. ${
        failure.message
      }. Diagnostics: ${this.safeStringifyDiagnostics(imageDiagnostics)}`
    );
  }

  private logInstagramMediaCreateFailure(
    diagnostics: InstagramMediaCreateDiagnostics,
    error: unknown
  ) {
    if (!diagnostics.isVideo) {
      return;
    }

    console.error('Instagram video media create failed', {
      ...diagnostics,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  private buildPublicUrlPreflight(
    response: Response,
    method: 'HEAD' | 'GET'
  ): InstagramPublicUrlPreflight {
    return {
      method,
      status: response.status,
      finalUrl: response.url,
      contentType: response.headers.get('content-type') || '',
      contentLength: response.headers.get('content-length') || '',
      cfCacheStatus: response.headers.get('cf-cache-status') || '',
      redirected: response.redirected,
    };
  }

  private hasAuthRedirectUrl(url: string) {
    try {
      const parsed = new URL(url);
      return (
        this.isLocalOrPrivateHost(parsed.hostname.toLowerCase()) ||
        parsed.pathname.startsWith('/auth') ||
        parsed.pathname.startsWith('/login')
      );
    } catch {
      return true;
    }
  }

  private async fetchPublicImageUrl(
    mediaUrl: string,
    method: 'HEAD' | 'GET'
  ) {
    return fetch(mediaUrl, { method });
  }

  private getInstagramImageAspectBounds(
    diagnostics: InstagramMediaCreateDiagnostics
  ) {
    return diagnostics.isStory
      ? { min: 9 / 16, max: 1.91 }
      : { min: 4 / 5, max: 1.91 };
  }

  private async validateInstagramImageFile(
    mediaUrl: string,
    diagnostics: InstagramMediaCreateDiagnostics
  ) {
    let response: Response;

    try {
      response = await this.fetchPublicImageUrl(mediaUrl, 'GET');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new BadBody(
        'instagram_image_preflight',
        '{}',
        '{}',
        `Instagram image validation failed before calling Meta. Could not download ${mediaUrl}: ${message}. Diagnostics: ${this.safeStringifyDiagnostics(
          diagnostics
        )}`
      );
    }

    if (
      !response.ok ||
      response.redirected ||
      response.url !== mediaUrl ||
      this.hasAuthRedirectUrl(response.url)
    ) {
      throw new BadBody(
        'instagram_image_preflight',
        this.safeStringifyDiagnostics(
          this.buildPublicUrlPreflight(response, 'GET')
        ),
        '{}',
        `Instagram image validation failed before calling Meta. Public image GET did not return a direct HTTP 200 response. Diagnostics: ${this.safeStringifyDiagnostics(
          diagnostics
        )}`
      );
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length) {
      throw new BadBody(
        'instagram_image_preflight',
        '{}',
        '{}',
        `Instagram image validation failed before calling Meta. Public image body was empty for ${mediaUrl}. Diagnostics: ${this.safeStringifyDiagnostics(
          diagnostics
        )}`
      );
    }

    let metadata: sharp.Metadata;
    try {
      metadata = await sharp(buffer, { failOn: 'error' }).metadata();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new BadBody(
        'instagram_image_preflight',
        '{}',
        '{}',
        `Instagram image validation failed before calling Meta. Image is corrupt or unsupported: ${message}. Diagnostics: ${this.safeStringifyDiagnostics(
          diagnostics
        )}`
      );
    }

    const width = metadata.width || 0;
    const height = metadata.height || 0;
    const aspectRatio =
      width && height ? Number((width / height).toFixed(4)) : undefined;
    diagnostics.imageFile = {
      format: metadata.format,
      width: metadata.width,
      height: metadata.height,
      aspectRatio,
      space: metadata.space,
      channels: metadata.channels,
      depth: metadata.depth,
      hasAlpha: metadata.hasAlpha,
      isProgressive: metadata.isProgressive,
      hasProfile: metadata.hasProfile,
      orientation: metadata.orientation,
      size: buffer.length,
    };

    if (metadata.format !== 'jpeg') {
      throw new BadBody(
        'instagram_image_preflight',
        this.safeStringifyDiagnostics(diagnostics.imageFile),
        '{}',
        `Instagram image validation failed before calling Meta. Expected normalized JPEG, got "${
          metadata.format || 'unknown'
        }". Diagnostics: ${this.safeStringifyDiagnostics(diagnostics)}`
      );
    }

    if (!width || !height) {
      throw new BadBody(
        'instagram_image_preflight',
        this.safeStringifyDiagnostics(diagnostics.imageFile),
        '{}',
        `Instagram image validation failed before calling Meta. Could not read image dimensions. Diagnostics: ${this.safeStringifyDiagnostics(
          diagnostics
        )}`
      );
    }

    if (width < 320 || height < 320) {
      throw new BadBody(
        'instagram_image_preflight',
        this.safeStringifyDiagnostics(diagnostics.imageFile),
        '{}',
        `Instagram image validation failed before calling Meta. Image dimensions ${width}x${height} are below Instagram's 320px minimum. Diagnostics: ${this.safeStringifyDiagnostics(
          diagnostics
        )}`
      );
    }

    const aspectBounds = this.getInstagramImageAspectBounds(diagnostics);
    if (
      !aspectRatio ||
      aspectRatio < aspectBounds.min ||
      aspectRatio > aspectBounds.max
    ) {
      throw new BadBody(
        'instagram_image_preflight',
        this.safeStringifyDiagnostics(diagnostics.imageFile),
        '{}',
        `Instagram image validation failed before calling Meta. Image aspect ratio ${
          aspectRatio || 'unknown'
        } is outside Instagram's supported range ${aspectBounds.min.toFixed(
          4
        )}-${aspectBounds.max}. Diagnostics: ${this.safeStringifyDiagnostics(
          diagnostics
        )}`
      );
    }

    if (metadata.hasAlpha || metadata.channels !== 3) {
      throw new BadBody(
        'instagram_image_preflight',
        this.safeStringifyDiagnostics(diagnostics.imageFile),
        '{}',
        `Instagram image validation failed before calling Meta. Image must be flattened RGB without alpha. Diagnostics: ${this.safeStringifyDiagnostics(
          diagnostics
        )}`
      );
    }

    if (metadata.space !== 'srgb') {
      throw new BadBody(
        'instagram_image_preflight',
        this.safeStringifyDiagnostics(diagnostics.imageFile),
        '{}',
        `Instagram image validation failed before calling Meta. Image color space must be sRGB, got "${
          metadata.space || 'unknown'
        }". Diagnostics: ${this.safeStringifyDiagnostics(diagnostics)}`
      );
    }

    if (metadata.isProgressive || !metadata.hasProfile) {
      throw new BadBody(
        'instagram_image_preflight',
        this.safeStringifyDiagnostics(diagnostics.imageFile),
        '{}',
        `Instagram image validation failed before calling Meta. Image must be a baseline JPEG with an sRGB profile. Diagnostics: ${this.safeStringifyDiagnostics(
          diagnostics
        )}`
      );
    }
  }

  private async fetchPublicVideoUrl(
    mediaUrl: string,
    method: 'HEAD' | 'GET'
  ) {
    return fetch(mediaUrl, {
      method,
      ...(method === 'GET' ? { headers: { Range: 'bytes=0-0' } } : {}),
    });
  }

  private async validatePublicImageUrl(
    mediaUrl: string,
    diagnostics: InstagramMediaCreateDiagnostics
  ) {
    let response: Response | undefined;
    let method: 'HEAD' | 'GET' = 'HEAD';
    let headError = '';

    try {
      response = await this.fetchPublicImageUrl(mediaUrl, 'HEAD');
    } catch (error) {
      headError = error instanceof Error ? error.message : String(error);
    }

    const allowedContentTypes = ['image/jpeg', 'image/jpg', 'image/png'];
    const shouldRetryWithGet = (current?: Response) => {
      if (!current?.ok || current.status !== 200) {
        return true;
      }

      const preflight = this.buildPublicUrlPreflight(current, method);
      const contentType = preflight.contentType
        .split(';')[0]
        .trim()
        .toLowerCase();

      return (
        current.redirected ||
        current.url !== mediaUrl ||
        this.hasAuthRedirectUrl(current.url) ||
        !allowedContentTypes.includes(contentType) ||
        !preflight.contentLength
      );
    };

    if (shouldRetryWithGet(response)) {
      method = 'GET';
      try {
        response = await this.fetchPublicImageUrl(mediaUrl, 'GET');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new BadBody(
          'instagram_image_preflight',
          '{}',
          '{}',
          `Instagram image URL preflight failed before calling Meta. Public URL is unreachable: ${mediaUrl}. HEAD error: ${
            headError || 'none'
          }. GET error: ${message}. Diagnostics: ${this.safeStringifyDiagnostics(
            diagnostics
          )}`
        );
      }
    }

    if (!response) {
      throw new BadBody(
        'instagram_image_preflight',
        '{}',
        '{}',
        `Instagram image URL preflight failed before calling Meta. No response returned for ${mediaUrl}. Diagnostics: ${this.safeStringifyDiagnostics(
          diagnostics
        )}`
      );
    }

    const preflight = this.buildPublicUrlPreflight(response, method);
    diagnostics.publicUrlPreflight = preflight;
    diagnostics.httpStatus = preflight.status;

    if (!response.ok || response.status !== 200) {
      throw new BadBody(
        'instagram_image_preflight',
        this.safeStringifyDiagnostics(preflight),
        '{}',
        `Instagram image URL preflight failed before calling Meta. Public URL returned HTTP ${response.status} for ${method}: ${mediaUrl}. Diagnostics: ${this.safeStringifyDiagnostics(
          diagnostics
        )}`
      );
    }

    if (
      response.redirected ||
      preflight.finalUrl !== mediaUrl ||
      this.hasAuthRedirectUrl(preflight.finalUrl)
    ) {
      throw new BadBody(
        'instagram_image_preflight',
        this.safeStringifyDiagnostics(preflight),
        '{}',
        `Instagram image URL preflight failed before calling Meta. Public URL redirected to ${preflight.finalUrl}. Diagnostics: ${this.safeStringifyDiagnostics(
          diagnostics
        )}`
      );
    }

    const contentType = preflight.contentType
      .split(';')[0]
      .trim()
      .toLowerCase();
    if (!allowedContentTypes.includes(contentType)) {
      throw new BadBody(
        'instagram_image_preflight',
        this.safeStringifyDiagnostics(preflight),
        '{}',
        `Instagram image URL preflight failed before calling Meta. Expected content-type image/jpeg or image/png, got "${
          contentType || 'missing'
        }" from ${mediaUrl}. Diagnostics: ${this.safeStringifyDiagnostics(
          diagnostics
        )}`
      );
    }

    const parsedLength = Number(preflight.contentLength);
    if (
      !preflight.contentLength ||
      !Number.isFinite(parsedLength) ||
      parsedLength <= 0
    ) {
      throw new BadBody(
        'instagram_image_preflight',
        this.safeStringifyDiagnostics(preflight),
        '{}',
        `Instagram image URL preflight failed before calling Meta. Invalid content-length "${
          preflight.contentLength || 'missing'
        }" from ${mediaUrl}. Diagnostics: ${this.safeStringifyDiagnostics(
          diagnostics
        )}`
      );
    }

    await this.validateInstagramImageFile(mediaUrl, diagnostics);
  }

  private async validatePublicVideoUrl(
    mediaUrl: string,
    diagnostics: InstagramMediaCreateDiagnostics
  ) {
    let response: Response | undefined;
    let method: 'HEAD' | 'GET' = 'HEAD';
    let headError = '';

    try {
      response = await this.fetchPublicVideoUrl(mediaUrl, 'HEAD');
    } catch (error) {
      headError = error instanceof Error ? error.message : String(error);
    }

    if (!response?.ok) {
      method = 'GET';
      try {
        response = await this.fetchPublicVideoUrl(mediaUrl, 'GET');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new BadBody(
          'instagram_video_preflight',
          '{}',
          '{}',
          `Instagram video URL preflight failed before calling Meta. Public URL is unreachable: ${mediaUrl}. HEAD error: ${
            headError || 'none'
          }. GET error: ${message}. Diagnostics: ${this.safeStringifyDiagnostics(
            diagnostics
          )}`
        );
      }
    }

    if (!response.ok) {
      throw new BadBody(
        'instagram_video_preflight',
        '{}',
        '{}',
        `Instagram video URL preflight failed before calling Meta. Public URL returned HTTP ${response.status} for ${method}: ${mediaUrl}. Diagnostics: ${this.safeStringifyDiagnostics(
          diagnostics
        )}`
      );
    }

    const allowedContentTypes = ['video/mp4', 'application/octet-stream'];
    let contentType = (response.headers.get('content-type') || '')
      .split(';')[0]
      .trim()
      .toLowerCase();
    let contentLength = response.headers.get('content-length') || '';

    if (!allowedContentTypes.includes(contentType) && method === 'HEAD') {
      try {
        const getResponse = await this.fetchPublicVideoUrl(mediaUrl, 'GET');
        if (getResponse.ok) {
          response = getResponse;
          method = 'GET';
          contentType = (response.headers.get('content-type') || '')
            .split(';')[0]
            .trim()
            .toLowerCase();
          contentLength = response.headers.get('content-length') || '';
        }
      } catch {}
    }

    if (!allowedContentTypes.includes(contentType)) {
      throw new BadBody(
        'instagram_video_preflight',
        '{}',
        '{}',
        `Instagram video URL preflight failed before calling Meta. Expected content-type video/mp4 or application/octet-stream, got "${
          contentType || 'missing'
        }" from ${mediaUrl}. Diagnostics: ${this.safeStringifyDiagnostics({
          ...diagnostics,
          preflight: {
            method,
            status: response.status,
            contentType,
            contentLength: contentLength || 'missing',
          },
        })}`
      );
    }

    if (contentLength) {
      const parsedLength = Number(contentLength);
      if (!Number.isFinite(parsedLength) || parsedLength <= 0) {
        throw new BadBody(
          'instagram_video_preflight',
          '{}',
          '{}',
          `Instagram video URL preflight failed before calling Meta. Invalid content-length "${contentLength}" from ${mediaUrl}. Diagnostics: ${this.safeStringifyDiagnostics(
            diagnostics
          )}`
        );
      }
    }
  }

  private isLocalOrPrivateHost(hostname: string) {
    if (
      hostname === 'localhost' ||
      hostname === '0.0.0.0' ||
      hostname === '::1' ||
      hostname === 'host.docker.internal' ||
      hostname.endsWith('.local')
    ) {
      return true;
    }

    const parts = hostname.split('.').map((part) => Number(part));
    if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) {
      return false;
    }

    const [first, second] = parts;
    return (
      first === 10 ||
      first === 127 ||
      first === 0 ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168) ||
      (first === 169 && second === 254)
    );
  }

  private async waitForMediaContainer(
    containerId: string,
    accessToken: string,
    type: string,
    identifier: string,
    diagnostics?: InstagramMediaCreateDiagnostics
  ) {
    const maxAttempts = 60;
    const delayMs = 5000;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      let status_code: string | undefined;
      try {
        ({ status_code } = await this.fetchInstagramJson<{
          status_code?: string;
        }>(
          `https://${type}/v20.0/${containerId}?fields=status_code&access_token=${accessToken}`,
          undefined,
          identifier
        ));
      } catch (error) {
        if (
          this.canContinueAfterContainerStatusAuthorizationError(
            diagnostics,
            error
          )
        ) {
          this.warnContainerStatusAuthorizationError(
            containerId,
            diagnostics,
            error
          );
          return;
        }

        throw error;
      }

      if (status_code === 'FINISHED') {
        return;
      }

      if (status_code === 'ERROR') {
        const containerDiagnostics = await this.fetchMediaContainerDiagnostics(
          containerId,
          accessToken,
          type,
          identifier
        );
        const message = this.formatMediaContainerFailureMessage(
          containerId,
          containerDiagnostics,
          diagnostics
        );

        console.error('Instagram media container failed', {
          containerId,
          mediaCreate: diagnostics,
          container: containerDiagnostics,
        });

        throw new BadBody(
          identifier,
          this.safeStringifyDiagnostics(containerDiagnostics),
          '{}',
          message
        );
      }

      if (!status_code) {
        throw new BadBody(
          identifier,
          '{}',
          '{}',
          `Instagram media container ${containerId} did not return status_code.`
        );
      }

      if (status_code !== 'IN_PROGRESS') {
        throw new BadBody(
          identifier,
          '{}',
          '{}',
          `Instagram media container ${containerId} returned unexpected status ${status_code}.`
        );
      }

      await timer(delayMs);
    }

    throw new BadBody(
      identifier,
      '{}',
      '{}',
      `Timed out waiting for Instagram media container ${containerId} to finish.`
    );
  }

  private canContinueAfterContainerStatusAuthorizationError(
    diagnostics: InstagramMediaCreateDiagnostics | undefined,
    error: unknown
  ) {
    if (
      !diagnostics ||
      diagnostics.isVideo ||
      diagnostics.isStory ||
      diagnostics.isReel ||
      diagnostics.isCarousel ||
      diagnostics.isCarouselItem
    ) {
      return false;
    }

    const failure = this.getInstagramFailureDetails(error);
    const graphError = this.getGraphApiError(
      this.safeStringifyDiagnostics(failure.graphResponse || {}) || '{}'
    );

    return graphError?.code === '100' && graphError?.subcode === '33';
  }

  private warnContainerStatusAuthorizationError(
    containerId: string,
    diagnostics: InstagramMediaCreateDiagnostics | undefined,
    error: unknown
  ) {
    const failure = this.getInstagramFailureDetails(error);

    console.warn(
      'Instagram media container status lookup returned Graph API 100/33; continuing to media_publish for single-image post',
      this.parseDiagnosticJson(
        this.safeStringifyDiagnostics({
          containerId,
          mediaCreate: diagnostics,
          graphResponse: failure.graphResponse,
          graphError: failure.message,
        })
      )
    );
  }

  private async fetchMediaContainerDiagnostics(
    containerId: string,
    accessToken: string,
    type: string,
    identifier: string
  ) {
    const fieldSets = [
      'status_code,status,error,error_message,id',
      'status_code,status,error_message,id',
      'status_code,status,id',
    ];
    let lastError = '';

    for (const fields of fieldSets) {
      try {
        const result = await this.fetchInstagramJson<Record<string, any>>(
          `https://${type}/v20.0/${containerId}?fields=${encodeURIComponent(
            fields
          )}&access_token=${accessToken}`,
          undefined,
          `${identifier}_diagnostics`
        );

        return {
          requestedFields: fields,
          response: result,
        };
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
    }

    return {
      requestedFields: fieldSets.join(' | '),
      diagnosticFetchError: lastError || 'Unknown diagnostic fetch failure.',
    };
  }

  private formatMediaContainerFailureMessage(
    containerId: string,
    containerDiagnostics: Record<string, any>,
    mediaDiagnostics?: InstagramMediaCreateDiagnostics
  ) {
    return `Instagram media container ${containerId} failed. Meta container response: ${this.safeStringifyDiagnostics(
      containerDiagnostics
    )}. Media create diagnostics: ${this.safeStringifyDiagnostics(
      mediaDiagnostics || {}
    )}`;
  }

  private async publishMediaContainer(
    id: string,
    accessToken: string,
    creationId: string,
    type: string
  ) {
    const params = new URLSearchParams({
      creation_id: creationId,
      access_token: accessToken,
    });
    const { id: mediaId } = await this.fetchInstagramJson<{ id?: string }>(
      `https://${type}/v20.0/${id}/media_publish?${params.toString()}`,
      {
        method: 'POST',
      },
      'instagram_media_publish'
    );

    if (!mediaId) {
      throw new BadBody(
        'instagram_media_publish',
        '{}',
        '{}',
        'Instagram did not return a published media id.'
      );
    }

    return mediaId;
  }

  private async getPermalink(mediaId: string, accessToken: string, type: string) {
    const { permalink } = await this.fetchInstagramJson<{ permalink?: string }>(
      `https://${type}/v20.0/${mediaId}?fields=permalink&access_token=${accessToken}`,
      undefined,
      'instagram_permalink'
    );

    return permalink || '';
  }

  async comment(
    id: string,
    postId: string,
    lastCommentId: string | undefined,
    accessToken: string,
    postDetails: PostDetails<InstagramDto>[],
    integration: Integration,
    type = 'graph.facebook.com'
  ): Promise<PostResponse[]> {
    const [commentPost] = postDetails;

    const { id: commentId } = await (
      await this.fetch(
        `https://${type}/v20.0/${postId}/comments?message=${encodeURIComponent(
          commentPost.message
        )}&access_token=${accessToken}`,
        {
          method: 'POST',
        }
      )
    ).json();

    // Get the permalink from the parent post
    const { permalink } = await (
      await this.fetch(
        `https://${type}/v20.0/${postId}?fields=permalink&access_token=${accessToken}`
      )
    ).json();

    return [
      {
        id: commentPost.id,
        postId: commentId,
        releaseURL: permalink,
        status: 'success',
      },
    ];
  }

  async deletePublished(
    id: string,
    accessToken: string,
    releaseId: string,
    integration: Integration,
    type = 'graph.facebook.com'
  ): Promise<PublishedDeleteResponse> {
    try {
      const result = await this.fetchInstagramJson<{ success?: boolean }>(
        `https://${type}/v20.0/${releaseId}?access_token=${accessToken}`,
        {
          method: 'DELETE',
        },
        'instagram_delete_published'
      );

      if (result?.success === false) {
        throw new BadBody(
          'instagram_delete_published',
          JSON.stringify(result),
          '{}',
          'Instagram rejected the published post delete request.'
        );
      }

      return {
        status: 'deleted',
      };
    } catch (error) {
      if (this.isAlreadyDeletedInstagramDeleteError(error)) {
        return {
          status: 'already_deleted',
        };
      }

      throw error;
    }
  }

  async readComments(
    id: string,
    accessToken: string,
    postId: string,
    integration: Integration,
    type = 'graph.facebook.com'
  ): Promise<PublishedComment[]> {
    const fields = encodeURIComponent(
      'id,text,username,timestamp,like_count,hidden,replies{id}'
    );
    const { data } = await this.fetchInstagramJson<{ data?: any[] }>(
      `https://${type}/v20.0/${postId}/comments?fields=${fields}&limit=50&access_token=${accessToken}`,
      undefined,
      'instagram_comments'
    );

    return (data || []).map((comment: any) => ({
      id: String(comment.id),
      message: comment.text || '',
      authorName:
        comment.username || comment.from?.username || comment.user?.username || '',
      createdTime: comment.timestamp || '',
      likeCount: Number(comment.like_count || 0),
      replyCount: Number(
        comment.reply_count ||
          comment.replies_count ||
          comment.replies?.summary?.total_count ||
          comment.replies?.data?.length ||
          0
      ),
      permalinkUrl: comment.permalink || comment.permalink_url || '',
      hidden:
        typeof comment.hidden === 'boolean' ? comment.hidden : undefined,
      canReply: true,
      canHide: true,
      canDelete: true,
    }));
  }

  async replyToComment(
    id: string,
    accessToken: string,
    postId: string,
    commentId: string,
    message: string,
    integration: Integration,
    type = 'graph.facebook.com'
  ): Promise<PublishedCommentActionResponse> {
    const { id: replyId } = await this.fetchInstagramJson<{ id?: string }>(
      `https://${type}/v20.0/${commentId}/replies?message=${encodeURIComponent(
        message
      )}&access_token=${accessToken}`,
      {
        method: 'POST',
      },
      'instagram_comment_reply'
    );

    if (!replyId) {
      throw new BadBody(
        'instagram_comment_reply',
        '{}',
        '{}',
        'Instagram did not return a reply comment ID.'
      );
    }

    return {
      success: true,
      commentId,
      replyId,
    };
  }

  async hideComment(
    id: string,
    accessToken: string,
    postId: string,
    commentId: string,
    hide: boolean,
    integration: Integration,
    type = 'graph.facebook.com'
  ): Promise<PublishedCommentActionResponse> {
    const result = await this.fetchInstagramJson<{ success?: boolean }>(
      `https://${type}/v20.0/${commentId}?hide=${
        hide ? 'true' : 'false'
      }&access_token=${accessToken}`,
      {
        method: 'POST',
      },
      'instagram_comment_hide'
    );

    if (result?.success === false) {
      throw new BadBody(
        'instagram_comment_hide',
        JSON.stringify(result),
        '{}',
        'Instagram rejected the hide/unhide comment request.'
      );
    }

    return {
      success: true,
      commentId,
      hidden: hide,
    };
  }

  async deleteComment(
    id: string,
    accessToken: string,
    postId: string,
    commentId: string,
    integration: Integration,
    type = 'graph.facebook.com'
  ): Promise<PublishedCommentActionResponse> {
    const result = await this.fetchInstagramJson<{ success?: boolean }>(
      `https://${type}/v20.0/${commentId}?access_token=${accessToken}`,
      {
        method: 'DELETE',
      },
      'instagram_comment_delete'
    );

    if (result?.success === false) {
      throw new BadBody(
        'instagram_comment_delete',
        JSON.stringify(result),
        '{}',
        'Instagram rejected the delete comment request.'
      );
    }

    return {
      success: true,
      commentId,
    };
  }

  private setTitle(name: string) {
    switch (name) {
      case 'likes': {
        return 'Likes';
      }

      case 'followers': {
        return 'Followers';
      }

      case 'reach': {
        return 'Reach';
      }

      case 'follower_count': {
        return 'Follower Count';
      }

      case 'views': {
        return 'Views';
      }

      case 'comments': {
        return 'Comments';
      }

      case 'shares': {
        return 'Shares';
      }

      case 'saves': {
        return 'Saves';
      }

      case 'replies': {
        return 'Replies';
      }
    }

    return '';
  }

  async analytics(
    id: string,
    accessToken: string,
    date: number,
    type = 'graph.facebook.com'
  ): Promise<AnalyticsData[]> {
    const until = dayjs().endOf('day').unix();
    const since = dayjs().subtract(date, 'day').unix();

    const { data, ...all } = await (
      await fetch(
        `https://${type}/v21.0/${id}/insights?metric=follower_count,reach&access_token=${accessToken}&period=day&since=${since}&until=${until}`
      )
    ).json();

    const { data: data2, ...all2 } = await (
      await fetch(
        `https://${type}/v21.0/${id}/insights?metric_type=total_value&metric=likes,views,comments,shares,saves,replies&access_token=${accessToken}&period=day&since=${since}&until=${until}`
      )
    ).json();
    const analytics = [];

    analytics.push(
      ...(data?.map((d: any) => ({
        label: this.setTitle(d.name),
        percentageChange: 5,
        data: d.values.map((v: any) => ({
          total: v.value,
          date: dayjs(v.end_time).format('YYYY-MM-DD'),
        })),
      })) || [])
    );

    analytics.push(
      ...data2.map((d: any) => ({
        label: this.setTitle(d.name),
        percentageChange: 5,
        data: [
          {
            total: d.total_value.value,
            date: dayjs().format('YYYY-MM-DD'),
          },
          {
            total: d.total_value.value,
            date: dayjs().add(1, 'day').format('YYYY-MM-DD'),
          },
        ],
      }))
    );

    return analytics;
  }

  async listMedia(
    accessToken: string,
    data: { page?: number } = {},
    id: string,
    integration: Integration,
    type = 'graph.facebook.com'
  ): Promise<HistoricalMediaPage> {
    const page = data.page || 1;
    const pageSize = 12;

    try {
      const fields = encodeURIComponent(
        'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,children{media_type,media_url,thumbnail_url}'
      );
      const { data: media } = await (
        await this.fetch(
          `https://${type}/v21.0/${id}/media?fields=${fields}&limit=50&access_token=${accessToken}`
        )
      ).json();

      const results = (media || []).map((item: any) => {
        const mediaType = String(item.media_type || '').toUpperCase();
        const isVideo = ['VIDEO', 'REELS'].includes(mediaType);
        const firstChild = item.children?.data?.[0];
        const thumbnail =
          item.thumbnail_url ||
          item.media_url ||
          firstChild?.thumbnail_url ||
          firstChild?.media_url ||
          '';

        return {
          id: String(item.id),
          url: item.permalink || item.media_url || '',
          thumbnail,
          name:
            item.caption ||
            (isVideo ? 'Instagram video' : 'Instagram image'),
          type: isVideo ? ('video' as const) : ('image' as const),
          publishedAt: item.timestamp || undefined,
        };
      });

      const start = (page - 1) * pageSize;

      return {
        results: results.slice(start, start + pageSize),
        pages: Math.max(1, Math.ceil(results.length / pageSize)),
      };
    } catch (err) {
      console.error(
        `Error fetching Instagram media list for ${integration.providerIdentifier}:`,
        err
      );
      return {
        results: [],
        pages: 1,
      };
    }
  }

  music(accessToken: string, data: { q: string }) {
    return this.fetch(
      `https://graph.facebook.com/v20.0/music/search?q=${encodeURIComponent(
        data.q
      )}&access_token=${accessToken}`
    );
  }

  async postAnalytics(
    integrationId: string,
    accessToken: string,
    postId: string,
    date: number,
    type = 'graph.facebook.com'
  ): Promise<AnalyticsData[]> {
    const today = dayjs().format('YYYY-MM-DD');

    try {
      // Fetch media insights from Instagram Graph API
      const { data } = await (
        await this.fetch(
          `https://${type}/v21.0/${postId}/insights?metric=views,reach,saved,likes,comments,shares&access_token=${accessToken}`
        )
      ).json();

      if (!data || data.length === 0) {
        return [];
      }

      const result: AnalyticsData[] = [];

      for (const metric of data) {
        const value = metric.values?.[0]?.value;
        if (value === undefined) continue;

        let label = '';

        switch (metric.name) {
          case 'views':
            label = 'Views';
            break;
          case 'reach':
            label = 'Reach';
            break;
          case 'engagement':
            label = 'Engagement';
            break;
          case 'saved':
            label = 'Saves';
            break;
          case 'likes':
            label = 'Likes';
            break;
          case 'comments':
            label = 'Comments';
            break;
          case 'shares':
            label = 'Shares';
            break;
        }

        if (label) {
          result.push({
            label,
            percentageChange: 0,
            data: [{ total: String(value), date: today }],
          });
        }
      }

      return result;
    } catch (err) {
      console.error('Error fetching Instagram post analytics:', err);
      return [];
    }
  }
}
