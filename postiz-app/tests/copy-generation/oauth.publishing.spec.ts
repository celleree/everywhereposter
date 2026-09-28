jest.mock('bcrypt', () => ({ hashSync: jest.fn(), compareSync: jest.fn() }));
jest.mock('@mastra/core/tools', () => ({ createTool: (definition: unknown) => definition }));
import { createOAuthPublishingTools } from '../../libraries/nestjs-libraries/src/chat/oauth-publishing.tools';
import { runWithContext } from '../../libraries/nestjs-libraries/src/chat/async.storage';

const input = () => ({ type: 'now', date: '2030-01-01T12:00:00Z', posts: [
  { integrationId: 'account', content: '<p>Hello</p>', mediaIds: ['media'], settings: {} },
] });

describe('restricted OAuth publishing', () => {
  let deps: any;
  let tools: any;
  let store: Map<string, string>;
  const call = (name: string, input: any, scopes = ['accounts:read', 'posts:write'], grantId = 'grant') =>
    runWithContext({ requestId: 'pos_test', auth: { id: 'org' }, oauth: { id: grantId, scopes } },
      () => tools[name].execute(tools[name].inputSchema.parse(input)));
  beforeEach(() => {
    store = new Map();
    deps = {
      integrations: {
        getIntegrationsList: jest.fn().mockResolvedValue([]),
        getIntegrationById: jest.fn(async (org, id) => org === 'org' && id === 'account' ?
          { id, name: 'My account', providerIdentifier: 'linkedin', token: 'provider-secret' } : null),
      },
      media: { getMediaByOrganizationIdAndId: jest.fn(async (org, id) => org === 'org' && id === 'media' ?
        { id, path: 'https://app.test/uploads/test.png', type: 'image' } : null) },
      posts: { createPost: jest.fn().mockResolvedValue([{ postId: 'post', integration: 'account', secret: 'omit' }]) },
      redis: {
        get: jest.fn(async (key) => store.get(key)),
        set: jest.fn(async (key, value, _ex, _ttl, nx) => {
          if (nx && store.has(key)) return null;
          store.set(key, value); return 'OK';
        }),
      },
    };
    const registry = createOAuthPublishingTools(deps);
    tools = { ...registry.readTools, ...registry.writeTools };
  });
  it('exposes only intended tools with accurate write and OAuth annotations', () => {
    expect(Object.keys(tools)).toEqual(['list_connected_accounts', 'integrationSchema', 'triggerTool', 'prepare_post', 'publish_post']);
    expect(tools.publish_post.mcp.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true, openWorldHint: true });
    expect(tools.publish_post.mcp._meta.securitySchemes).toEqual([{ type: 'oauth2', scopes: ['posts:write'] }]);
  });
  it('retains account listing and rejects all writes and publishing reads for accounts:read', async () => {
    await expect(call('list_connected_accounts', {}, ['accounts:read'])).resolves.toEqual({ accounts: [] });
    for (const [name, args] of Object.entries({ integrationSchema: { integrationId: 'account' }, triggerTool: { integrationId: 'account', methodName: 'boards', data: {} }, prepare_post: input(), publish_post: { confirmationId: 'a1a03eab-c509-4bde-bb44-ad78b8cbb084', confirmed: true, preview: input() } })) {
      await expect(call(name, args, ['accounts:read'])).rejects.toThrow('scope');
    }
    expect(deps.posts.createPost).not.toHaveBeenCalled();
    expect(deps.redis.set).not.toHaveBeenCalled();
  });
  it.each(['now', 'schedule'])('previews then %s through the existing post service', async (type) => {
    const preview = { ...input(), type };
    const prepared: any = await call('prepare_post', preview);
    expect(prepared.destinations).toEqual([{ id: 'account', name: 'My account', platform: 'linkedin', attachments: [{ id: 'media', path: 'https://app.test/uploads/test.png' }] }]);
    expect(deps.posts.createPost).not.toHaveBeenCalled();
    const args = { confirmationId: prepared.confirmationId, confirmed: true, preview };
    const result = await call('publish_post', args);
    expect(result).toEqual({ status: type === 'now' ? 'queued' : 'scheduled', posts: [{ postId: 'post', integration: 'account' }] });
    expect(deps.posts.createPost).toHaveBeenCalledWith('org', expect.objectContaining({ type,
      posts: [expect.objectContaining({ integration: { id: 'account' }, settings: { __type: 'linkedin' },
        value: [{ content: '<p>Hello</p>', image: [{ id: 'media', path: 'https://app.test/uploads/test.png' }], delay: 0 }] })] }));
    await call('publish_post', args);
    expect(deps.posts.createPost).toHaveBeenCalledTimes(1);
  });
  it('rejects foreign accounts and media before any writes', async () => {
    const foreign = input(); foreign.posts[0].integrationId = 'foreign';
    await expect(call('prepare_post', foreign)).rejects.toThrow('Account');
    foreign.posts[0].integrationId = 'account'; foreign.posts[0].mediaIds = ['foreign'];
    await expect(call('prepare_post', foreign)).rejects.toThrow('Media');
    expect(deps.redis.set).not.toHaveBeenCalled();
  });
  it.each([
    { settings: { post_as_images_carousel: 'yes' } },
    { settings: { __type: 'x' } },
    { settings: { token: 'secret' } },
    { content: 'x'.repeat(3100) },
    { content: '', mediaIds: [] },
  ])('enforces platform validation %p', async (change) => {
    const post = input(); Object.assign(post.posts[0], change);
    await expect(Promise.resolve().then(() => call('prepare_post', post))).rejects.toThrow();
    expect(deps.posts.createPost).not.toHaveBeenCalled();
  });
  it('rejects past scheduling, tenant selectors and external attachment URLs', async () => {
    await expect(call('prepare_post', { ...input(), type: 'schedule', date: '2000-01-01T00:00:00Z' })).rejects.toThrow('future');
    expect(() => call('prepare_post', { ...input(), organizationId: 'other' })).toThrow();
    const post = input(); (post.posts[0] as any).attachments = ['https://evil.test/a'];
    expect(() => call('prepare_post', post)).toThrow();
  });
  it('binds confirmation to the unchanged preview and grant; rejects missing confirmation and expiry', async () => {
    const prepared: any = await call('prepare_post', input());
    const args = { confirmationId: prepared.confirmationId, confirmed: true, preview: input() };
    expect(() => call('publish_post', { ...args, confirmed: false })).toThrow();
    await expect(call('publish_post', args, ['posts:write'], 'other-grant')).rejects.toThrow('expired or changed');
    const changed = input(); changed.posts[0].content = 'Changed';
    await expect(call('publish_post', { ...args, preview: changed })).rejects.toThrow('expired or changed');
    store.clear();
    await expect(call('publish_post', args)).rejects.toThrow('expired or changed');
    expect(deps.posts.createPost).not.toHaveBeenCalled();
  });
  it('revalidates ownership and account state at confirmation', async () => {
    const prepared: any = await call('prepare_post', input());
    deps.integrations.getIntegrationById.mockResolvedValue(null);
    await expect(call('publish_post', { confirmationId: prepared.confirmationId, confirmed: true, preview: input() })).rejects.toThrow('Account');
    expect(deps.posts.createPost).not.toHaveBeenCalled();
  });
  it('uses an atomic receipt for concurrent calls and never leaks raw errors', async () => {
    const prepared: any = await call('prepare_post', input());
    deps.posts.createPost.mockRejectedValue(new Error('secret download_url=https://private.test?token=secret'));
    const args = { confirmationId: prepared.confirmationId, confirmed: true, preview: input() };
    const results = await Promise.all([call('publish_post', args), call('publish_post', args)]);
    expect(deps.posts.createPost).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(results)).not.toMatch(/secret|download_url/);
    await call('publish_post', args);
    expect(deps.posts.createPost).toHaveBeenCalledTimes(1);
  });
  it('rejects unlisted provider methods without executing them', async () => {
    await expect(call('triggerTool', { integrationId: 'account', methodName: 'post', data: {} })).rejects.toThrow('unavailable');
  });
});
