import {
  AnalyticsData,
  AuthTokenDetails,
  HistoricalMediaPage,
  PublishedDeleteResponse,
  PostDetails,
  PostResponse,
  SocialProvider,
} from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import { google, youtube_v3 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library/build/src/auth/oauth2client';
import axios from 'axios';
import { YoutubeSettingsDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/youtube.settings.dto';
import { SocialAbstract } from '@gitroom/nestjs-libraries/integrations/social.abstract';
import * as process from 'node:process';
import dayjs from 'dayjs';
import { GaxiosResponse } from 'gaxios/build/src/common';
import Schema$Video = youtube_v3.Schema$Video;
import { Rules } from '@gitroom/nestjs-libraries/chat/rules.description.decorator';
import { Integration } from '@prisma/client';

const clientAndYoutube = () => {
  const client = new google.auth.OAuth2({
    clientId: process.env.YOUTUBE_CLIENT_ID,
    clientSecret: process.env.YOUTUBE_CLIENT_SECRET,
    redirectUri: `${process.env.FRONTEND_URL}/integrations/social/youtube`,
  });

  const youtube = (newClient: OAuth2Client) =>
    google.youtube({
      version: 'v3',
      auth: newClient,
    });

  const youtubeAnalytics = (newClient: OAuth2Client) =>
    google.youtubeAnalytics({
      version: 'v2',
      auth: newClient,
    });

  const oauth2 = (newClient: OAuth2Client) =>
    google.oauth2({
      version: 'v2',
      auth: newClient,
    });

  return { client, youtube, oauth2, youtubeAnalytics };
};

const yesNoToBoolean = (value?: '' | 'no' | 'yes') => {
  if (value === 'yes') {
    return true;
  }

  if (value === 'no') {
    return false;
  }

  return undefined;
};

@Rules('YouTube must have on video attachment, it cannot be empty')
export class YoutubeProvider extends SocialAbstract implements SocialProvider {
  override maxConcurrentJob = 200; // YouTube has strict upload quotas
  identifier = 'youtube';
  name = 'YouTube';
  isBetweenSteps = true;
  dto = YoutubeSettingsDto;
  scopes = [
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/youtube.force-ssl',
    'https://www.googleapis.com/auth/youtube.readonly',
    'https://www.googleapis.com/auth/youtube.upload',
    'https://www.googleapis.com/auth/yt-analytics.readonly',
  ];

  editor = 'normal' as const;
  maxLength() {
    return 5000;
  }

  override getPublishedCapabilities(integration?: Integration) {
    return this.buildPublishedCapabilities(integration, {
      editMode: 'metadata',
      canDeletePublished: true,
      constraints: [
        'YouTube published video edits are limited to metadata such as title, description, tags, privacy, and thumbnail.',
        'Replacing the uploaded video file is not supported.',
      ],
    });
  }

  override handleErrors(body: string):
    | {
        type: 'refresh-token' | 'bad-body';
        value: string;
      }
    | undefined {
    if (body.includes('invalidTitle')) {
      return {
        type: 'bad-body',
        value:
          'We have uploaded your video but we could not set the title. Title is too long.',
      };
    }

    if (body.includes('failedPrecondition')) {
      return {
        type: 'bad-body',
        value:
          'We have uploaded your video but we could not set the thumbnail. Thumbnail size is too large.',
      };
    }

    if (body.includes('uploadLimitExceeded')) {
      return {
        type: 'bad-body',
        value:
          'You have reached your daily upload limit, please try again tomorrow.',
      };
    }

    if (body.includes('youtubeSignupRequired')) {
      return {
        type: 'bad-body',
        value:
          'You have to link your youtube account to your google account first.',
      };
    }

    if (body.includes('youtube.thumbnail')) {
      return {
        type: 'bad-body',
        value:
          'Your account is not verified, we have uploaded your video but we could not set the thumbnail. Please verify your account and try again.',
      };
    }

    if (body.includes('Unauthorized')) {
      return {
        type: 'refresh-token',
        value:
          'Token expired or invalid, please reconnect your YouTube account.',
      };
    }

    if (body.includes('UNAUTHENTICATED') || body.includes('invalid_grant')) {
      return {
        type: 'refresh-token',
        value: 'Please re-authenticate your YouTube account',
      };
    }

    return undefined;
  }

  async refreshToken(refresh_token: string): Promise<AuthTokenDetails> {
    const { client, oauth2 } = clientAndYoutube();
    client.setCredentials({ refresh_token });
    const { credentials } = await client.refreshAccessToken();
    const user = oauth2(client);
    const expiryDate = new Date(credentials.expiry_date!);
    const unixTimestamp =
      Math.floor(expiryDate.getTime() / 1000) -
      Math.floor(new Date().getTime() / 1000);

    const { data } = await user.userinfo.get();

    return {
      accessToken: credentials.access_token!,
      expiresIn: unixTimestamp!,
      refreshToken: credentials.refresh_token ?? refresh_token,
      id: data.id!,
      name: data.name!,
      picture: data?.picture || '',
      username: '',
    };
  }

  async generateAuthUrl() {
    const state = makeId(7);
    const { client } = clientAndYoutube();
    return {
      url: client.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent',
        state,
        redirect_uri: `${process.env.FRONTEND_URL}/integrations/social/youtube`,
        scope: this.scopes.slice(0),
      }),
      codeVerifier: makeId(11),
      state,
    };
  }

  async authenticate(params: {
    code: string;
    codeVerifier: string;
    refresh?: string;
  }) {
    const { client, oauth2 } = clientAndYoutube();
    const { tokens } = await client.getToken(params.code);
    client.setCredentials(tokens);
    const { scopes } = await client.getTokenInfo(tokens.access_token!);
    this.checkScopes(this.scopes, scopes);

    const user = oauth2(client);
    const { data } = await user.userinfo.get();

    const expiryDate = new Date(tokens.expiry_date!);
    const unixTimestamp =
      Math.floor(expiryDate.getTime() / 1000) -
      Math.floor(new Date().getTime() / 1000);

    return {
      accessToken: tokens.access_token!,
      expiresIn: unixTimestamp,
      refreshToken: tokens.refresh_token!,
      id: data.id!,
      name: data.name!,
      picture: data?.picture || '',
      username: '',
    };
  }

  async pages(accessToken: string) {
    const { client, youtube } = clientAndYoutube();
    client.setCredentials({ access_token: accessToken });
    const youtubeClient = youtube(client);

    try {
      // Get all channels the user has access to
      const response = await youtubeClient.channels.list({
        part: ['snippet', 'contentDetails', 'statistics'],
        mine: true,
      });

      const channels = response.data.items || [];

      return channels.map((channel) => ({
        id: channel.id!,
        name: channel.snippet?.title || 'Unnamed Channel',
        picture: {
          data: {
            url: channel.snippet?.thumbnails?.default?.url || '',
          },
        },
        username: channel.snippet?.customUrl || '',
        subscriberCount: channel.statistics?.subscriberCount || '0',
      }));
    } catch (error) {
      console.error('Failed to fetch YouTube channels:', error);
      return [];
    }
  }

  async fetchPageInformation(accessToken: string, data: { id: string }) {
    const { client, youtube } = clientAndYoutube();
    client.setCredentials({ access_token: accessToken });
    const youtubeClient = youtube(client);

    try {
      const response = await youtubeClient.channels.list({
        part: ['snippet', 'contentDetails', 'statistics'],
        id: [data.id],
      });

      const channel = response.data.items?.[0];

      if (!channel) {
        throw new Error('Channel not found');
      }

      return {
        id: channel.id!,
        name: channel.snippet?.title || 'Unnamed Channel',
        access_token: accessToken,
        picture: channel.snippet?.thumbnails?.default?.url || '',
        username: channel.snippet?.customUrl || '',
      };
    } catch (error) {
      console.error('Failed to fetch YouTube channel information:', error);
      throw error;
    }
  }

  async reConnect(
    id: string,
    requiredId: string,
    accessToken: string
  ): Promise<Omit<AuthTokenDetails, 'refreshToken' | 'expiresIn'>> {
    const pages = await this.pages(accessToken);
    const findPage = pages.find((p) => p.id === requiredId);

    if (!findPage) {
      throw new Error('Channel not found');
    }

    const information = await this.fetchPageInformation(accessToken, {
      id: requiredId,
    });

    return {
      id: information.id,
      name: information.name,
      accessToken: information.access_token,
      picture: information.picture,
      username: information.username,
    };
  }

  async post(
    id: string,
    accessToken: string,
    postDetails: PostDetails[]
  ): Promise<PostResponse[]> {
    const [firstPost, ...comments] = postDetails;

    const { client, youtube } = clientAndYoutube();
    client.setCredentials({ access_token: accessToken });
    const youtubeClient = youtube(client);

    const { settings }: { settings: YoutubeSettingsDto } = firstPost;
    const embeddable = yesNoToBoolean(settings.embeddable);
    const publicStatsViewable = yesNoToBoolean(settings.publicStatsViewable);
    const hasPaidProductPlacement = yesNoToBoolean(
      settings.hasPaidProductPlacement
    );
    const parts = [
      'id',
      'snippet',
      'status',
      ...(typeof hasPaidProductPlacement === 'boolean'
        ? ['paidProductPlacementDetails']
        : []),
    ];

    const response = await axios({
      url: firstPost?.media?.[0]?.path,
      method: 'GET',
      responseType: 'stream',
    });

    const all: GaxiosResponse<Schema$Video> = await this.runInConcurrent(
      async () =>
        youtubeClient.videos.insert({
          part: parts,
          notifySubscribers: settings.notifySubscribers !== 'no',
          requestBody: {
            snippet: {
              title: settings.title,
              description: firstPost?.message,
              ...(settings?.tags?.length
                ? { tags: settings.tags.map((p) => p.label) }
                : {}),
            },
            status: {
              privacyStatus: settings.type,
              selfDeclaredMadeForKids:
                settings.selfDeclaredMadeForKids === 'yes',
              ...(settings.license ? { license: settings.license } : {}),
              ...(typeof embeddable === 'boolean' ? { embeddable } : {}),
              ...(typeof publicStatsViewable === 'boolean'
                ? { publicStatsViewable }
                : {}),
            },
            ...(typeof hasPaidProductPlacement === 'boolean'
              ? {
                  paidProductPlacementDetails: {
                    hasPaidProductPlacement,
                  },
                }
              : {}),
          },
          media: {
            body: response.data,
          },
        }),
      true
    );

    if (settings?.thumbnail?.path) {
      await this.runInConcurrent(async () =>
        youtubeClient.thumbnails.set({
          videoId: all?.data?.id!,
          media: {
            body: (
              await axios({
                url: settings?.thumbnail?.path,
                method: 'GET',
                responseType: 'stream',
              })
            ).data,
          },
        })
      );
    }

    return [
      {
        id: firstPost.id,
        releaseURL: `https://www.youtube.com/watch?v=${all?.data?.id}`,
        postId: all?.data?.id!,
        status: 'success',
      },
    ];
  }

  async update(
    id: string,
    accessToken: string,
    releaseId: string,
    postDetails: PostDetails[]
  ): Promise<PostResponse[]> {
    const [firstPost] = postDetails;

    const { client, youtube } = clientAndYoutube();
    client.setCredentials({ access_token: accessToken });
    const youtubeClient = youtube(client);

    const { settings }: { settings: YoutubeSettingsDto } = firstPost;
    const embeddable = yesNoToBoolean(settings.embeddable);
    const publicStatsViewable = yesNoToBoolean(settings.publicStatsViewable);
    const hasPaidProductPlacement = yesNoToBoolean(
      settings.hasPaidProductPlacement
    );
    const parts = [
      'id',
      'snippet',
      'status',
      ...(typeof hasPaidProductPlacement === 'boolean'
        ? ['paidProductPlacementDetails']
        : []),
    ];

    const existingVideo = await this.runInConcurrent(
      async () =>
        youtubeClient.videos.list({
          part: ['snippet', 'status'],
          id: [releaseId],
        }),
      true
    );

    const currentVideo = existingVideo.data.items?.[0];

    if (!currentVideo) {
      throw new Error('The original YouTube video could not be found.');
    }

    const currentSnippet = currentVideo.snippet;
    const currentStatus = currentVideo.status;

    const updatedVideo = await this.runInConcurrent(
      async () =>
        youtubeClient.videos.update({
          part: parts,
          requestBody: {
            id: releaseId,
            snippet: {
              title: settings.title,
              description: firstPost?.message || '',
              tags: (settings?.tags || []).map((tag) => tag.label),
              categoryId: currentSnippet?.categoryId || '22',
              ...(currentSnippet?.defaultLanguage
                ? { defaultLanguage: currentSnippet.defaultLanguage }
                : {}),
              ...(currentSnippet?.defaultAudioLanguage
                ? {
                    defaultAudioLanguage: currentSnippet.defaultAudioLanguage,
                  }
                : {}),
            },
            status: {
              privacyStatus: settings.type,
              selfDeclaredMadeForKids:
                settings.selfDeclaredMadeForKids === 'yes',
              ...(typeof embeddable === 'boolean'
                ? { embeddable }
                : typeof currentStatus?.embeddable === 'boolean'
                ? { embeddable: currentStatus.embeddable }
                : {}),
              ...(settings.license
                ? { license: settings.license }
                : currentStatus?.license
                ? { license: currentStatus.license }
                : {}),
              ...(typeof publicStatsViewable === 'boolean'
                ? {
                    publicStatsViewable,
                  }
                : typeof currentStatus?.publicStatsViewable === 'boolean'
                ? {
                    publicStatsViewable: currentStatus.publicStatsViewable,
                  }
                : {}),
              ...(currentStatus?.publishAt
                ? { publishAt: currentStatus.publishAt }
                : {}),
            },
            ...(typeof hasPaidProductPlacement === 'boolean'
              ? {
                  paidProductPlacementDetails: {
                    hasPaidProductPlacement,
                  },
                }
              : {}),
          },
        }),
      true
    );

    if (settings?.thumbnail?.path) {
      await this.runInConcurrent(async () =>
        youtubeClient.thumbnails.set({
          videoId: releaseId,
          media: {
            body: (
              await axios({
                url: settings.thumbnail?.path,
                method: 'GET',
                responseType: 'stream',
              })
            ).data,
          },
        })
      );
    }

    const finalId = updatedVideo?.data?.id || releaseId;

    return [
      {
        id: firstPost.id,
        releaseURL: `https://www.youtube.com/watch?v=${finalId}`,
        postId: finalId,
        status: 'success',
      },
    ];
  }

  async deletePublished(
    id: string,
    accessToken: string,
    releaseId: string
  ): Promise<PublishedDeleteResponse> {
    const { client, youtube } = clientAndYoutube();
    client.setCredentials({ access_token: accessToken });
    const youtubeClient = youtube(client);

    try {
      await youtubeClient.videos.delete({
        id: releaseId,
      });

      return {
        status: 'deleted',
      };
    } catch (error: any) {
      if (
        error?.response?.status === 404 ||
        error?.code === 404 ||
        JSON.stringify(error).includes('videoNotFound')
      ) {
        return {
          status: 'already_deleted',
        };
      }

      throw error;
    }
  }

  async listMedia(
    accessToken: string,
    data: { page?: number } = {}
  ): Promise<HistoricalMediaPage> {
    const page = data.page || 1;
    const pageSize = 12;

    try {
      const { client, youtube } = clientAndYoutube();
      client.setCredentials({ access_token: accessToken });
      const youtubeClient = youtube(client);

      const channelResponse = await youtubeClient.channels.list({
        part: ['contentDetails'],
        mine: true,
      });

      const uploadsPlaylistId =
        channelResponse.data.items?.[0]?.contentDetails?.relatedPlaylists
          ?.uploads;

      if (!uploadsPlaylistId) {
        return {
          results: [],
          pages: 1,
        };
      }

      const playlistResponse = await youtubeClient.playlistItems.list({
        part: ['contentDetails', 'snippet'],
        playlistId: uploadsPlaylistId,
        maxResults: 50,
      });

      const items = (playlistResponse.data.items || [])
        .filter((item) => item.contentDetails?.videoId)
        .map((item) => {
          const videoId = item.contentDetails?.videoId!;
          const thumbnails = item.snippet?.thumbnails;

          return {
            id: videoId,
            url: `https://www.youtube.com/watch?v=${videoId}`,
            thumbnail:
              thumbnails?.maxres?.url ||
              thumbnails?.high?.url ||
              thumbnails?.medium?.url ||
              thumbnails?.default?.url ||
              '',
            name: item.snippet?.title || 'YouTube video',
            type: 'video' as const,
            publishedAt: item.contentDetails?.videoPublishedAt || undefined,
          };
        });

      const start = (page - 1) * pageSize;

      return {
        results: items.slice(start, start + pageSize),
        pages: Math.max(1, Math.ceil(items.length / pageSize)),
      };
    } catch (err) {
      console.error('Error fetching YouTube media list:', err);
      return {
        results: [],
        pages: 1,
      };
    }
  }

  async analytics(
    id: string,
    accessToken: string,
    date: number
  ): Promise<AnalyticsData[]> {
    try {
      const endDate = dayjs().format('YYYY-MM-DD');
      const startDate = dayjs().subtract(date, 'day').format('YYYY-MM-DD');

      const { client, youtubeAnalytics } = clientAndYoutube();
      client.setCredentials({ access_token: accessToken });

      const youtubeClient = youtubeAnalytics(client);
      const { data } = await youtubeClient.reports.query({
        ids: 'channel==MINE',
        startDate,
        endDate,
        metrics:
          'views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained,likes,subscribersLost',
        dimensions: 'day',
        sort: 'day',
      });

      const columns = data?.columnHeaders?.map((p) => p.name)!;
      const mappedData = data?.rows?.map((p) => {
        return columns.reduce((acc, curr, index) => {
          acc[curr!] = p[index];
          return acc;
        }, {} as any);
      });

      const acc = [] as any[];
      acc.push({
        label: 'Views',
        data: mappedData?.map((p: any) => ({
          total: p.views,
          date: p.day,
        })),
      });

      acc.push({
        label: 'Estimated Minutes Watched',
        data: mappedData?.map((p: any) => ({
          total: p.estimatedMinutesWatched,
          date: p.day,
        })),
      });

      acc.push({
        label: 'Average View Duration',
        average: true,
        data: mappedData?.map((p: any) => ({
          total: p.averageViewDuration,
          date: p.day,
        })),
      });

      acc.push({
        label: 'Average View Percentage',
        average: true,
        data: mappedData?.map((p: any) => ({
          total: p.averageViewPercentage,
          date: p.day,
        })),
      });

      acc.push({
        label: 'Subscribers Gained',
        data: mappedData?.map((p: any) => ({
          total: p.subscribersGained,
          date: p.day,
        })),
      });

      acc.push({
        label: 'Subscribers Lost',
        data: mappedData?.map((p: any) => ({
          total: p.subscribersLost,
          date: p.day,
        })),
      });

      acc.push({
        label: 'Likes',
        data: mappedData?.map((p: any) => ({
          total: p.likes,
          date: p.day,
        })),
      });

      return acc;
    } catch (err) {
      return [];
    }
  }

  async postAnalytics(
    integrationId: string,
    accessToken: string,
    postId: string,
    date: number
  ): Promise<AnalyticsData[]> {
    const today = dayjs().format('YYYY-MM-DD');

    try {
      const { client, youtube } = clientAndYoutube();
      client.setCredentials({ access_token: accessToken });
      const youtubeClient = youtube(client);

      // Fetch video statistics
      const response = await youtubeClient.videos.list({
        part: ['statistics', 'snippet'],
        id: [postId],
      });

      const video = response.data.items?.[0];

      if (!video || !video.statistics) {
        return [];
      }

      const stats = video.statistics;
      const result: AnalyticsData[] = [];

      if (stats.viewCount !== undefined) {
        result.push({
          label: 'Views',
          percentageChange: 0,
          data: [{ total: String(stats.viewCount), date: today }],
        });
      }

      if (stats.likeCount !== undefined) {
        result.push({
          label: 'Likes',
          percentageChange: 0,
          data: [{ total: String(stats.likeCount), date: today }],
        });
      }

      if (stats.commentCount !== undefined) {
        result.push({
          label: 'Comments',
          percentageChange: 0,
          data: [{ total: String(stats.commentCount), date: today }],
        });
      }

      if (stats.favoriteCount !== undefined) {
        result.push({
          label: 'Favorites',
          percentageChange: 0,
          data: [{ total: String(stats.favoriteCount), date: today }],
        });
      }

      return result;
    } catch (err) {
      console.error('Error fetching YouTube post analytics:', err);
      return [];
    }
  }
}
