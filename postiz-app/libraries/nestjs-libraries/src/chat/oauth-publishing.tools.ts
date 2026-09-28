import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { getContext } from './async.storage';
import { createListConnectedAccountsTool } from './tools/list.connected.accounts.tool';
import { getValidationSchemas } from './validation.schemas.helper';
import { socialIntegrationList, IntegrationManager } from '../integrations/integration.manager';
import { CreatePostDto } from '../dtos/posts/create.post.dto';
import { stripHtmlValidation } from '@gitroom/helpers/utils/strip.html.validation';
import { weightedLength } from '@gitroom/helpers/utils/count.length';
import type { IntegrationService } from '../database/prisma/integrations/integration.service';
import type { MediaService } from '../database/prisma/media/media.service';
import type { PostsService } from '../database/prisma/posts/posts.service';
import type { Redis } from 'ioredis';
import type { PermissionsService } from '@gitroom/backend/services/auth/permissions/permissions.service';
import { AuthorizationActions, Sections } from '@gitroom/backend/services/auth/permissions/permission.exception.class';

// Reviewed publishing-option methods only; new legacy tools are never inherited.
const optionMethods: Record<string, string[]> = {
  pinterest: ['boards'], reddit: ['subreddits', 'restrictions'],
  discord: ['channels'], slack: ['channels'], medium: ['publications'],
  dribbble: ['teams'], wrapcast: ['subreddits'], devto: ['tags', 'organizations'],
  hashnode: ['tagsList', 'publications'], wordpress: ['postTypes'],
  lemmy: ['subreddits'], listmonk: ['list', 'templates'],
  skool: ['groups', 'label'], whop: ['companies', 'experiences'], mewe: ['groups'],
  tiktok: ['creatorInfo'],
};
const id = z.string().min(1).max(100);
const settings = z.record(z.string().max(100), z.unknown()).refine(
  (value) => JSON.stringify(value).length <= 16000 &&
    !Object.keys(value).some((k) => ['__proto__', 'constructor', 'prototype', '__type'].includes(k)),
  'Invalid platform settings'
);
export const publishingInput = z.object({
  type: z.enum(['now', 'schedule']),
  date: z.string().datetime({ offset: true }).describe('UTC or explicit-offset publication time; future for schedule'),
  posts: z.array(z.object({
    integrationId: id,
    content: z.string().max(50000),
    mediaIds: z.array(id).max(20),
    settings,
  }).strict()).min(1).max(20),
}).strict();
type PublishInput = z.infer<typeof publishingInput>;
type Dependencies = {
  integrations: Pick<IntegrationService, 'getIntegrationsList' | 'getIntegrationById'>;
  media: Pick<MediaService, 'getMediaByOrganizationIdAndId'>;
  posts: Pick<PostsService, 'createPost'>;
  redis: Pick<Redis, 'get' | 'set'>;
  permissions: Pick<PermissionsService, 'check'>;
};
export function requireOAuthScope(scope: string) {
  const context = getContext();
  if (!context?.auth?.id || !context.oauth?.scopes.includes(scope)) {
    throw new Error('Insufficient OAuth scope');
  }
  return { organizationId: context.auth.id as string, grantId: context.oauth.id };
}
export const oauthToolMeta = (scope: string, readOnlyHint: boolean, openWorldHint = false, destructiveHint = false) => ({
  annotations: { readOnlyHint, openWorldHint, destructiveHint, idempotentHint: readOnlyHint },
  _meta: { securitySchemes: [{ type: 'oauth2', scopes: [scope] }] },
});

export function createOAuthPublishingTools(deps: Dependencies) {
  const manager = new IntegrationManager();
  const account = async (integrationId: string) => {
    const { organizationId } = requireOAuthScope('posts:write');
    const integration = await deps.integrations.getIntegrationById(organizationId, integrationId);
    if (!integration || integration.deletedAt || integration.disabled || integration.refreshNeeded || integration.inBetweenSteps) {
      throw new Error('Account unavailable; reconnect or finish account setup');
    }
    const provider = socialIntegrationList.find((p) => p.identifier === integration.providerIdentifier);
    if (!provider) throw new Error('Unsupported platform');
    return { integration, provider };
  };
  const validateSettingMedia = async (value: unknown, organizationId: string, depth = 0): Promise<void> => {
    if (depth > 8) throw new Error('Platform settings are too deeply nested');
    if (!value || typeof value !== 'object') return;
    if ('path' in value) {
      const item = value as Record<string, unknown>;
      if (typeof item.id !== 'string' || Object.keys(item).some((k) => !['id', 'path', 'alt'].includes(k))) throw new Error('Invalid settings media reference');
      const media = await deps.media.getMediaByOrganizationIdAndId(organizationId, item.id);
      if (!media || media.deletedAt || media.type !== 'image' || media.path !== item.path) throw new Error('Settings media unavailable in this organization');
    }
    for (const child of Object.values(value)) await validateSettingMedia(child, organizationId, depth + 1);
  };
  const buildPost = async (input: PublishInput) => {
    const { organizationId } = requireOAuthScope('posts:write');
    const ability = await deps.permissions.check(organizationId, getContext()!.auth.createdAt, 'USER',
      [[AuthorizationActions.Create, Sections.POSTS_PER_MONTH]]);
    if (!ability.can(AuthorizationActions.Create, Sections.POSTS_PER_MONTH)) throw new Error('Publishing entitlement unavailable');
    if (input.type === 'schedule' && new Date(input.date).getTime() <= Date.now()) throw new Error('Scheduled date must be in the future');
    if (new Set(input.posts.map((p) => p.integrationId)).size !== input.posts.length) throw new Error('Select each destination only once');
    const destinations = [];
    const posts = [];
    for (const post of input.posts) {
      const { integration, provider } = await account(post.integrationId);
      await validateSettingMedia(post.settings, organizationId);
      if (provider.dto) {
        const errors = await validate(plainToInstance(provider.dto, post.settings), { whitelist: true, forbidNonWhitelisted: true });
        if (errors.length) throw new Error(`Invalid ${provider.identifier} settings: ${errors.map((e) => e.property).join(', ')}`);
      } else if (Object.keys(post.settings).length) throw new Error('This platform does not accept additional settings');
      const text = stripHtmlValidation('normal', post.content, true);
      const length = provider.identifier === 'x' ? Math.max(text.length, weightedLength(text)) : text.length;
      if (length > provider.maxLength(false)) throw new Error('Post exceeds the platform character limit');
      const image = [];
      for (const mediaId of post.mediaIds) {
        const media = await deps.media.getMediaByOrganizationIdAndId(organizationId, mediaId);
        if (!media || media.deletedAt || !['image', 'video'].includes(media.type)) throw new Error('Media unavailable in this organization');
        image.push({ id: media.id, path: media.path });
      }
      posts.push({ integration: { id: integration.id }, group: randomUUID(),
        settings: { ...post.settings, __type: provider.identifier },
        value: [{ content: post.content, image, delay: 0 }] });
      destinations.push({ id: integration.id, name: integration.name, platform: provider.identifier, attachments: image });
    }
    const body = plainToInstance(CreatePostDto, { ...input, shortLink: false, tags: [], posts });
    if ((await validate(body)).length) throw new Error('Invalid post content, attachments, or platform settings');
    return { body, destinations };
  };
  const list = createListConnectedAccountsTool(deps.integrations);
  const readTools = {
    list_connected_accounts: createTool({ ...list, mcp: oauthToolMeta('accounts:read', true), execute: async () => {
      requireOAuthScope('accounts:read');
      return list.execute!({} as never, {} as never);
    } }),
  };
  const writeTools = {
    integrationSchema: createTool({
      id: 'integrationSchema', description: 'Inspect publishing settings and available option lookups for one authorized connected account. Use before preparing a post.',
      inputSchema: z.object({ integrationId: id }).strict(), mcp: oauthToolMeta('posts:write', true),
      execute: async ({ integrationId }) => {
        const { provider } = await account(integrationId);
        return { platform: provider.identifier, maxLength: provider.maxLength(false),
          rules: manager.getAllRulesDescription()[provider.identifier],
          settings: provider.dto ? getValidationSchemas()[provider.dto.name] : {},
          tools: (manager.getAllTools()[provider.identifier] || []).filter((t) => optionMethods[provider.identifier]?.includes(t.methodName)),
          ...(provider.identifier === 'tiktok' ? { creatorInfo: 'Call triggerTool with methodName creatorInfo before choosing privacy and interaction settings.' } : {}),
        };
      },
    }),
    triggerTool: createTool({
      id: 'triggerTool', description: 'Resolve publishing options for an authorized account using only a method listed by integrationSchema. Never publishes.',
      inputSchema: z.object({ integrationId: id, methodName: id,
        data: z.record(z.string().max(40), z.string().max(200)).refine((v) => Object.keys(v).length <= 5),
      }).strict(), mcp: oauthToolMeta('posts:write', true, true),
      execute: async ({ integrationId, methodName, data }) => {
        const { integration, provider } = await account(integrationId);
        if (!optionMethods[provider.identifier]?.includes(methodName)) throw new Error('Publishing option unavailable');
        if (Object.entries(data).some(([k, v]) => !['word', 'subreddit', 'id'].includes(k) || (typeof v !== 'string' || !/^[\w /-]*$/.test(v)))) throw new Error('Invalid option query');
        try {
          const result = await (provider as any)[methodName](integration.token, data, integration.internalId, integration);
          if (methodName === 'creatorInfo') {
            const p = result?.data;
            if (!p?.creator_nickname || !Array.isArray(p.privacy_level_options)) throw new Error();
            return { creator: { name: p.creator_nickname, privacy_level_options: p.privacy_level_options,
              comment_disabled: p.comment_disabled, duet_disabled: p.duet_disabled,
              stitch_disabled: p.stitch_disabled, max_video_post_duration_sec: p.max_video_post_duration_sec } };
          }
          // Providers are not permitted to return arbitrary credentials or records through OAuth.
          const project = (p: any): any => Object.fromEntries(['id', 'name', 'title', 'label', 'value', 'username', 'subreddit', 'allow', 'is_flair_required', 'flairs']
            .filter((key) => p?.[key] !== undefined).map((key) => [key, key === 'flairs' ? p[key].map(project) : p[key]]));
          return { options: Array.isArray(result) ? result.slice(0, 1000).map(project) : project(result) };
        } catch { throw new Error('Unable to load publishing options; check the account connection'); }
      },
    }),
    prepare_post: createTool({
      id: 'prepare_post', description: 'Validate a complete post and return a 15-minute preview. Show all content, attachments, destination accounts, time and settings to the user and ask for explicit confirmation. This does not publish.',
      inputSchema: publishingInput, mcp: oauthToolMeta('posts:write', false),
      execute: async (input) => {
        const { grantId } = requireOAuthScope('posts:write');
        const { destinations } = await buildPost(input);
        const confirmationId = randomUUID();
        await deps.redis.set(`oauth-post:${grantId}:${confirmationId}`, JSON.stringify({ input, destinations }), 'EX', 900);
        return { confirmationId, preview: input, destinations, expiresInSeconds: 900, requiresConfirmation: true };
      },
    }),
    publish_post: createTool({
      id: 'publish_post', description: 'Publish now or schedule the exact prepared preview ONLY after the user has explicitly confirmed its content, attachments, destination accounts, time and settings. Include the complete unchanged preview. On an uncertain result, check EverywherePoster before preparing another post; never automatically retry with a new confirmation.',
      inputSchema: z.object({ confirmationId: z.string().uuid(), confirmed: z.literal(true), preview: publishingInput }).strict(),
      mcp: oauthToolMeta('posts:write', false, true, true),
      execute: async ({ confirmationId, confirmed, preview }) => {
        const { grantId, organizationId } = requireOAuthScope('posts:write');
        if (confirmed !== true) throw new Error('Explicit confirmation required');
        const key = `oauth-post:${grantId}:${confirmationId}`;
        const stored = await deps.redis.get(key);
        if (!stored || JSON.stringify(JSON.parse(stored).input) !== JSON.stringify(preview)) throw new Error('Preview expired or changed; check EverywherePoster before preparing and confirming again');
        const receiptKey = `${key}:receipt`;
        const receipt = await deps.redis.get(receiptKey);
        if (receipt) return JSON.parse(receipt);
        const { body, destinations } = await buildPost(preview);
        if (JSON.stringify(destinations) !== JSON.stringify(JSON.parse(stored).destinations)) throw new Error('Destinations or attachments changed; prepare and confirm again');
        const pending = { status: 'pending_or_uncertain', message: 'Check EverywherePoster before preparing another post.' };
        if (!await deps.redis.set(receiptKey, JSON.stringify(pending), 'EX', 86400, 'NX')) return pending;
        try {
          const output = await deps.posts.createPost(organizationId, body);
          const receipt = { status: preview.type === 'now' ? 'queued' : 'scheduled', posts: output.map((p) => ({ postId: p.postId, integration: p.integration })) };
          await deps.redis.set(receiptKey, JSON.stringify(receipt), 'EX', 86400);
          return receipt;
        } catch { return pending; }
      },
    }),
  };
  return { readTools, writeTools };
}
