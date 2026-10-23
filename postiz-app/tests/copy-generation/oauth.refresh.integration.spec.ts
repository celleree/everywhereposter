jest.mock('bcrypt', () => ({ hashSync: jest.fn(), compareSync: jest.fn() }));
import { createHash, randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { OAuthRepository } from '../../libraries/nestjs-libraries/src/database/prisma/oauth/oauth.repository';
import { OAuthService, getMcpResource } from '../../libraries/nestjs-libraries/src/database/prisma/oauth/oauth.service';
import { AuthService } from '@gitroom/helpers/auth/auth.service';

// Only an explicitly selected disposable database; never falls back to DATABASE_URL.
const database = process.env.OAUTH_TEST_DATABASE_URL;
(database ? describe : describe.skip)('OAuth refresh PostgreSQL lifecycle', () => {
  let clients: PrismaClient[], repositories: OAuthRepository[], services: OAuthService[];
  const id = randomUUID();
  const hash = (v: string) => createHash('sha256').update(v).digest('hex');
  const verifier = 'x'.repeat(43);
  let app: any;
  const request = () => ({ client_id: id, response_type: 'code', scope: 'accounts:read posts:write',
    redirect_uri: 'https://client.test/callback', resource: getMcpResource(),
    code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' });
  const issue = async () => services[0].exchangeCodeForToken({ ...request(), grant_type: 'authorization_code',
    code: await services[0].createAuthorizationCode(app.id, id, id, request()), client_secret: 'secret', code_verifier: verifier });
  const refresh = (token: string, extra: object = {}, service = services[0]) => service.refreshToken({
    client_id: id, client_secret: 'secret', grant_type: 'refresh_token', refresh_token: token, ...extra,
  } as any);
  const authenticate = (token: string) => services[0].getOrgByOAuthToken(token, getMcpResource(), 'accounts:read');
  beforeAll(async () => {
    process.env.JWT_SECRET = 'oauth-test-only-secret';
    process.env.NEXT_PUBLIC_BACKEND_URL = 'https://server.test/api';
    clients = [0, 1].map(() => new PrismaClient({ datasources: { db: { url: database } } }));
    repositories = clients.map((client) => new OAuthRepository(...[0, 1, 2].map(() => ({ model: client })) as [any, any, any]));
    services = repositories.map((repository) => new OAuthService(repository));
    await clients[0].organization.create({ data: { id, name: 'Refresh test' } });
    await clients[0].user.create({ data: { id, email: `${id}@test.invalid`, providerName: 'LOCAL', timezone: 0,
      organizations: { create: { organizationId: id } } } });
    app = await clients[0].oAuthApp.create({ data: { name: 'Refresh test', clientId: id,
      clientSecret: AuthService.fixedEncryption('secret'), redirectUrl: request().redirect_uri, organizationId: id } });
  });
  beforeEach(async () => {
    await clients[0].user.update({ where: { id }, data: { activated: true } });
    await clients[0].userOrganization.upsert({ where: { userId_organizationId: { userId: id, organizationId: id } },
      create: { userId: id, organizationId: id }, update: { disabled: false } });
    await clients[0].oAuthApp.update({ where: { id: app.id }, data: { deletedAt: null, clientSecret: AuthService.fixedEncryption('secret') } });
  });
  afterAll(async () => {
    await clients[0].oAuthAuthorization.deleteMany({ where: { organizationId: id } });
    await clients[0].oAuthApp.deleteMany({ where: { organizationId: id } });
    await clients[0].userOrganization.deleteMany({ where: { userId: id } });
    await clients[0].user.delete({ where: { id } });
    await clients[0].organization.delete({ where: { id } });
    await Promise.all(clients.map((client) => client.$disconnect()));
  });
  it('renews expired access, hashes refresh credentials, rotates and preserves absolute expiry', async () => {
    const first = await issue();
    const row = await clients[0].oAuthRefreshToken.findUniqueOrThrow({ where: { tokenHash: hash(first.refresh_token) } });
    expect(row.expiresAt.getTime() - Date.now()).toBeGreaterThan(29 * 86400000);
    expect(JSON.stringify(row)).not.toContain(first.refresh_token);
    await clients[0].oAuthAuthorization.update({ where: { id: row.authorizationId }, data: { tokenExpiresAt: new Date(0) } });
    expect(await authenticate(first.access_token)).toBeNull();
    const next = await refresh(first.refresh_token);
    expect(next).toMatchObject({ expires_in: 3600, scope: request().scope });
    expect(next.refresh_token).not.toBe(first.refresh_token);
    expect(await authenticate(next.access_token)).toMatchObject({ organizationId: id, userId: id });
    expect(await authenticate(first.access_token)).toBeNull();
    const successor = await clients[0].oAuthRefreshToken.findUniqueOrThrow({ where: { tokenHash: hash(next.refresh_token) } });
    expect(successor.expiresAt).toEqual(row.expiresAt);
    expect(successor.familyId).toBe(row.familyId);
  });
  it('rolls back token consumption and access replacement when descendant insertion fails', async () => {
    const first = await issue();
    const row = await repositories[0].findByRefreshToken(hash(first.refresh_token));
    await expect(repositories[0].rotateRefreshToken(row!, {
      tokenHash: row!.tokenHash, accessToken: 'unused', tokenExpiresAt: new Date(Date.now() + 3600000), scope: request().scope,
    }, AuthService.fixedEncryption('secret'))).rejects.toThrow();
    expect(await authenticate(first.access_token)).not.toBeNull();
    expect(await refresh(first.refresh_token)).toHaveProperty('access_token');
  });
  it('revokes the entire current family on replay, including its access token', async () => {
    const first = await issue(), next = await refresh(first.refresh_token);
    await expect(refresh(first.refresh_token)).rejects.toThrow();
    await expect(refresh(next.refresh_token)).rejects.toThrow();
    expect(await authenticate(next.access_token)).toBeNull();
  });
  it('serializes concurrent refreshes across connections without revoking the winner', async () => {
    const first = await issue();
    let readers = 0, release!: () => void;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    const lookups = repositories.map((repository) => {
      const lookup = repository.findByRefreshToken.bind(repository);
      return jest.spyOn(repository, 'findByRefreshToken').mockImplementationOnce(async (hash) => {
        const row = await lookup(hash);
        if (++readers === 2) release();
        await barrier;
        return row;
      });
    });
    const results = await Promise.allSettled(services.map((s) => refresh(first.refresh_token, {}, s)));
    lookups.forEach((spy) => spy.mockRestore());
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const winner = results.find((r) => r.status === 'fulfilled') as PromiseFulfilledResult<any>;
    expect(await authenticate(winner.value.access_token)).not.toBeNull();
    expect(await refresh(winner.value.refresh_token)).toHaveProperty('access_token');
  });
  it.each(['expired', 'revoked', 'removed membership', 'disabled membership', 'inactive user', 'deleted app', 'rotated secret'])('rejects %s credentials', async (kind) => {
    const first = await issue();
    if (kind === 'expired') await clients[0].oAuthRefreshToken.update({ where: { tokenHash: hash(first.refresh_token) }, data: { expiresAt: new Date(0) } });
    if (kind === 'revoked') await clients[0].oAuthAuthorization.updateMany({ where: { userId: id }, data: { revokedAt: new Date() } });
    if (kind === 'removed membership') await clients[0].userOrganization.deleteMany({ where: { userId: id } });
    if (kind === 'disabled membership') await clients[0].userOrganization.updateMany({ where: { userId: id }, data: { disabled: true } });
    if (kind === 'inactive user') await clients[0].user.update({ where: { id }, data: { activated: false } });
    if (kind === 'deleted app') await clients[0].oAuthApp.update({ where: { id: app.id }, data: { deletedAt: new Date() } });
    if (kind === 'rotated secret') await services[0].rotateSecret(id);
    await expect(refresh(first.refresh_token)).rejects.toThrow();
  });
  it('preserves resource and scope isolation; supports only narrowing scopes', async () => {
    const first = await issue();
    for (const extra of [{ resource: 'https://foreign.test' }, { scope: 'admin:write' }, { scope: '' }, { scope: 'accounts:read accounts:read' }, { client_secret: 'wrong' }]) {
      await expect(refresh(first.refresh_token, extra)).rejects.toThrow();
    }
    const narrow = await refresh(first.refresh_token, { scope: 'accounts:read', resource: getMcpResource() });
    expect(narrow.scope).toBe('accounts:read');
    await expect(refresh(narrow.refresh_token, { scope: 'accounts:read posts:write' })).rejects.toThrow();
    expect(await services[0].getOrgByOAuthToken(narrow.access_token, getMcpResource(), 'posts:write')).toBeNull();
  });
  it('cannot redeem or revoke a different client grant', async () => {
    const first = await issue();
    const foreign = await clients[0].oAuthApp.create({ data: { name: 'Other client', clientId: randomUUID(),
      clientSecret: AuthService.fixedEncryption('secret'), redirectUrl: request().redirect_uri, organizationId: id } });
    await expect(refresh(first.refresh_token, { client_id: foreign.clientId })).rejects.toThrow();
    await services[0].revokeToken({ client_id: foreign.clientId, client_secret: 'secret', token: first.refresh_token });
    expect(await refresh(first.refresh_token)).toHaveProperty('access_token');
  });
  it('cannot refresh after membership moves to another organization', async () => {
    const first = await issue(), foreign = randomUUID();
    await clients[0].organization.create({ data: { id: foreign, name: 'Foreign org' } });
    try {
      await clients[0].userOrganization.deleteMany({ where: { userId: id } });
      await clients[0].userOrganization.create({ data: { userId: id, organizationId: foreign } });
      await expect(refresh(first.refresh_token)).rejects.toThrow();
    } finally {
      await clients[0].userOrganization.deleteMany({ where: { organizationId: foreign } });
      await clients[0].organization.delete({ where: { id: foreign } });
    }
  });
  it.each(['refresh_token', 'access_token'])('revokes using %s and treats unknown credentials as no-ops', async (field) => {
    const first = await issue();
    await services[0].revokeToken({ client_id: id, client_secret: 'secret', token: 'unknown' });
    expect(await authenticate(first.access_token)).not.toBeNull();
    await services[0].revokeToken({ client_id: id, client_secret: 'secret', token: first[field] });
    expect(await authenticate(first.access_token)).toBeNull();
    await expect(refresh(first.refresh_token)).rejects.toThrow();
  });
  it('old-family replay and revocation cannot revoke a later explicit consent', async () => {
    const old = await issue();
    await refresh(old.refresh_token);
    const current = await issue();
    await expect(refresh(old.refresh_token)).rejects.toThrow();
    await services[0].revokeToken({ client_id: id, client_secret: 'secret', token: old.refresh_token });
    expect(await refresh(current.refresh_token)).toHaveProperty('access_token');
  });
  it('does not expose credentials through approved-app discovery', async () => {
    await issue();
    const approved = await services[0].getApprovedApps(id);
    expect(approved).toEqual([expect.objectContaining({ id: expect.any(String), oauthApp: { name: 'Refresh test', description: null, picture: null } })]);
    expect(JSON.stringify(approved)).not.toMatch(/clientSecret|accessToken|authorizationCode|refresh|tokenHash/);
  });
});
