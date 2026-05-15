import {
  AnalyticsData,
  AuthTokenDetails,
  HistoricalMediaPage,
  PublishedComment,
  PublishedCommentActionResponse,
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
  private getAccountLabel(name?: string, username?: string) {
    return username || name || '';
  }
  maxLength() {
    return 2200;
  }

  override getPublishedCapabilities(integration?: Integration) {
    return this.buildPublishedCapabilities(integration, {
      editMode: 'none',
      canDeletePublished: false,
      reason:
        'Instagram published post editing and deletion are still disabled until we verify stable support for the exact media types this app publishes.',
      constraints: [
        'Use native Instagram tools for live post changes until this capability is implemented here.',
      ],
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
      const code = [graphError.code, graphError.subcode]
        .filter(Boolean)
        .join('/');
      const message = `Instagram Graph API error${
        code ? ` (${code})` : ''
      }: ${graphError.message}`;

      return {
        type: status === 401 ? ('refresh-token' as const) : ('bad-body' as const),
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

    const isStory = firstPost.settings.post_type === 'story';
    const isTrialReel = !!firstPost.settings.is_trial_reel;
    const medias = await Promise.all(
      firstPost?.media?.map(async (m) => {
        const params = new URLSearchParams({
          access_token: accessToken,
        });

        const mediaUrl = this.getPublicMediaUrl(m);
        const isVideo = this.isVideoMedia(m, mediaUrl);

        if (isVideo) {
          params.set('video_url', mediaUrl);
          params.set(
            'media_type',
            firstPost?.media?.length === 1
              ? isStory
                ? 'STORIES'
                : 'REELS'
              : isStory
              ? 'STORIES'
              : 'VIDEO'
          );
          params.set('thumb_offset', String(m?.thumbnailTimestamp || 0));
        } else {
          params.set('image_url', mediaUrl);
          if (isStory) {
            params.set('media_type', 'STORIES');
          }
        }

        if (firstPost.media?.length === 1) {
          params.set('caption', firstPost.message);
        }

        if ((firstPost?.media?.length || 0) > 1 && !isStory) {
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

        const { id: photoId } = await this.fetchInstagramJson<{ id?: string }>(
          `https://${type}/v20.0/${id}/media?${params.toString()}`,
          {
            method: 'POST',
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
          'instagram_media_create'
        );

        return photoId;
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
        `https://${type}/v20.0/${id}/media?${params.toString()}`,
        {
          method: 'POST',
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
        'instagram_carousel_create'
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

  private async fetchInstagramJson<T>(
    url: string,
    options: RequestInit = {},
    identifier = 'instagram',
    totalRetries = 0
  ): Promise<T> {
    const response = await this.fetch(url, options, identifier, totalRetries);
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
          options.body || '{}',
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
        options.body || '{}',
        handleError?.value
      );
    }

    if (!body.trim()) {
      throw new BadBody(
        identifier,
        bodyForError,
        options.body || '{}',
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
        options.body || '{}',
        `Instagram Graph API returned a non-JSON response (${response.status}).`
      );
    }

    if (!response.ok) {
      const json = JSON.stringify(payload);
      const graphError = this.getGraphApiError(json);
      throw new BadBody(
        identifier,
        json,
        options.body || '{}',
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
        options.body || '{}',
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
    identifier: string
  ) {
    const maxAttempts = 60;
    const delayMs = 5000;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const { status_code } = await this.fetchInstagramJson<{
        status_code?: string;
      }>(
        `https://${type}/v20.0/${containerId}?fields=status_code&access_token=${accessToken}`,
        undefined,
        identifier
      );

      if (status_code === 'FINISHED') {
        return;
      }

      if (status_code === 'ERROR') {
        throw new BadBody(
          identifier,
          '{}',
          '{}',
          `Instagram media container ${containerId} failed.`
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

  async readComments(
    id: string,
    accessToken: string,
    postId: string,
    integration: Integration,
    type = 'graph.facebook.com'
  ): Promise<PublishedComment[]> {
    const fields = encodeURIComponent(
      'id,text,username,timestamp,like_count,hidden'
    );
    const { data } = await (
      await this.fetch(
        `https://${type}/v20.0/${postId}/comments?fields=${fields}&limit=50&access_token=${accessToken}`
      )
    ).json();

    return (data || []).map((comment: any) => ({
      id: String(comment.id),
      message: comment.text || '',
      authorName: comment.username || '',
      createdTime: comment.timestamp || '',
      likeCount: Number(comment.like_count || 0),
      replyCount: Number(comment.reply_count || 0),
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
    const { id: replyId } = await (
      await this.fetch(
        `https://${type}/v20.0/${commentId}/replies?message=${encodeURIComponent(
          message
        )}&access_token=${accessToken}`,
        {
          method: 'POST',
        }
      )
    ).json();

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
    await this.fetch(
      `https://${type}/v20.0/${commentId}?hide=${
        hide ? 'true' : 'false'
      }&access_token=${accessToken}`,
      {
        method: 'POST',
      }
    );

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
    await this.fetch(
      `https://${type}/v20.0/${commentId}?access_token=${accessToken}`,
      {
        method: 'DELETE',
      }
    );

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
