jest.mock('bcrypt', () => ({ hashSync: jest.fn(), compareSync: jest.fn() }));
jest.mock('@mastra/core/tools', () => ({ createTool: (definition: unknown) => definition }));
import Redis from 'ioredis';
import { randomUUID } from 'crypto';
import { createOAuthPublishingTools } from '../../libraries/nestjs-libraries/src/chat/oauth-publishing.tools';
import { runWithContext } from '../../libraries/nestjs-libraries/src/chat/async.storage';

const redisUrl = process.env.OAUTH_TEST_REDIS_URL;
(redisUrl ? describe : describe.skip)('OAuth batch confirmation with real Redis', () => {
  let redis: Redis[];
  const grant = randomUUID();
  const batch = { type: 'now', date: '2030-01-01T00:00:00Z', posts: [
    { integrationId: 'linkedin', content: 'One approved batch', mediaIds: [], settings: {} },
    { integrationId: 'x', content: 'One approved batch', mediaIds: [], settings: { who_can_reply_post: 'everyone' } },
  ] };
  const posts = { createPost: jest.fn(async (_org: string, _body: any) => [{ postId: 'one', integration: 'linkedin' }, { postId: 'two', integration: 'x' }]) };
  const registry = (client: Redis) => createOAuthPublishingTools({ redis: client, posts,
    integrations: { getIntegrationsList: jest.fn(), getIntegrationById: jest.fn(async (_org, id) => ({ id, name: id, internalId: id, providerIdentifier: id })) } as any,
    media: { getMediaByOrganizationIdAndId: jest.fn() }, permissions: { check: jest.fn(async () => ({ can: () => true })) } as any,
  }).writeTools;
  const call = (tools: any, name: string, value: any) => runWithContext({ requestId: randomUUID(), auth: { id: 'org' }, oauth: { id: grant, scopes: ['posts:write'] } },
    () => tools[name].execute(tools[name].inputSchema.parse(value)));
  beforeAll(async () => {
    process.env.JWT_SECRET = 'batch-integration-test-secret';
    redis = [new Redis(redisUrl!), new Redis(redisUrl!)];
    await Promise.all(redis.map((client) => client.ping()));
  });
  afterAll(async () => {
    // Remove only this test's keys, never flush an instance.
    const keys = await redis[0].keys(`oauth-post:${grant}:*`);
    if (keys.length) await redis[0].del(...keys);
    await Promise.all(redis.map((client) => client.quit()));
  });
  it('survives a server reconstruction and serializes duplicate batch submissions', async () => {
    const first = registry(redis[0]);
    const prepared = await call(first, 'prepare_post', batch);
    expect(await redis[0].keys(`oauth-post:${grant}:*`)).toEqual([]);
    const second = registry(redis[1]);
    const args = { confirmationId: prepared.confirmationId, confirmed: true, preview: batch };
    const results: any[] = await Promise.all([call(first, 'publish_post', args), call(second, 'publish_post', args)]);
    expect(posts.createPost).toHaveBeenCalledTimes(1);
    expect(posts.createPost.mock.calls[0][1].posts).toHaveLength(2);
    expect(results.some((r) => r.status === 'queued')).toBe(true);
    const keys = await redis[0].keys(`oauth-post:${grant}:*`);
    expect(keys).toHaveLength(1);
    expect(await redis[0].ttl(keys[0])).toBeGreaterThan(86000);
    expect(await call(second, 'publish_post', args)).toMatchObject({ status: 'queued' });
    expect(posts.createPost).toHaveBeenCalledTimes(1);
  });
  it('never dispatches an expired batch or one missing explicit confirmation', async () => {
    const tools = registry(redis[0]);
    const prepared = await call(tools, 'prepare_post', batch);
    expect(() => call(tools, 'publish_post', { confirmationId: prepared.confirmationId, preview: batch })).toThrow();
    const now = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 900_000);
    try {
      await expect(call(tools, 'publish_post', { confirmationId: prepared.confirmationId, confirmed: true, preview: batch })).rejects.toThrow('expired');
    } finally { now.mockRestore(); }
    expect(posts.createPost).not.toHaveBeenCalled();
  });
});
