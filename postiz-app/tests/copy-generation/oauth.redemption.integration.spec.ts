// Password hashing is outside this OAuth credential boundary. Keep AES/PKCE real.
jest.mock('bcrypt', () => ({ hashSync: jest.fn(), compareSync: jest.fn() }));
import { createHash, randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { OAuthRepository } from '@gitroom/nestjs-libraries/database/prisma/oauth/oauth.repository';
import { OAuthService, getMcpResource } from '@gitroom/nestjs-libraries/database/prisma/oauth/oauth.service';
import { AuthService } from '@gitroom/helpers/auth/auth.service';

// Requires an isolated, migrated PostgreSQL database. Never uses DATABASE_URL.
const database = process.env.OAUTH_TEST_DATABASE_URL;
(database ? describe : describe.skip)('OAuth PostgreSQL conditional redemption', () => {
  let clients: PrismaClient[];
  let repositories: OAuthRepository[];
  let services: OAuthService[];
  const id = randomUUID();
  const verifier = 'x'.repeat(43);
  let app: any;
  const request = () => ({ client_id: id, response_type: 'code',
    redirect_uri: 'https://client.test/callback', resource: getMcpResource(), scope: 'accounts:read',
    code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' });
  const redeem = (service: OAuthService, code: string) => service.exchangeCodeForToken({
    ...request(), code, grant_type: 'authorization_code', client_secret: 'secret', code_verifier: verifier,
  });
  beforeAll(async () => {
    clients = [0, 1].map(() => new PrismaClient({ datasources: { db: { url: database } } }));
    repositories = clients.map((client) => new OAuthRepository(
      { model: client } as any, { model: client } as any
    ));
    services = repositories.map((repository) => new OAuthService(repository));
    process.env.JWT_SECRET = 'oauth-test-only-secret';
    process.env.NEXT_PUBLIC_BACKEND_URL = 'https://server.test/api';
    await clients[0].organization.create({ data: { id, name: 'OAuth test' } });
    await clients[0].user.create({ data: { id, email: `${id}@test.invalid`, providerName: 'LOCAL', timezone: 0,
      organizations: { create: { organizationId: id } } } });
    app = await clients[0].oAuthApp.create({ data: { name: 'OAuth test', clientId: id,
      clientSecret: AuthService.fixedEncryption('secret'), redirectUrl: request().redirect_uri, organizationId: id } });
  });
  afterAll(async () => {
    await clients[0].oAuthAuthorization.deleteMany({ where: { organizationId: id } });
    await clients[0].oAuthApp.deleteMany({ where: { organizationId: id } });
    await clients[0].userOrganization.deleteMany({ where: { organizationId: id } });
    await clients[0].user.deleteMany({ where: { id } });
    await clients[0].organization.deleteMany({ where: { id } });
    await Promise.all(clients.map((client) => client.$disconnect()));
  });
  it('issues exactly one token across concurrent connections and rejects replay', async () => {
    const code = await services[0].createAuthorizationCode(app.id, id, id, request());
    // Force both requests past lookup before either may execute the UPDATE.
    let readers = 0;
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    const lookups = repositories.map((repository) => {
      const lookup = repository.findByCode.bind(repository);
      return jest.spyOn(repository, 'findByCode').mockImplementationOnce(async (value) => {
        const authorization = await lookup(value);
        if (++readers === 2) release();
        await barrier;
        return authorization;
      });
    });
    const results = await Promise.allSettled(services.map((service) => redeem(service, code)));
    lookups.forEach((lookup) => lookup.mockRestore());
    expect(readers).toBe(2);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    await expect(redeem(services[0], code)).rejects.toThrow();
    const success = results.find((result) => result.status === 'fulfilled') as PromiseFulfilledResult<any>;
    await expect(services[0].getOrgByOAuthToken(success.value.access_token, getMcpResource(), 'accounts:read'))
      .resolves.toMatchObject({ organizationId: id });
    await clients[0].userOrganization.updateMany({ where: { userId: id }, data: { disabled: true } });
    await expect(services[0].getOrgByOAuthToken(success.value.access_token, getMcpResource(), 'accounts:read'))
      .resolves.toBeNull();
    const newCode = await services[0].createAuthorizationCode(app.id, id, id, request());
    await expect(redeem(services[0], newCode)).rejects.toThrow();
  });
});
