import { OrganizationRepository } from '../../libraries/nestjs-libraries/src/database/prisma/organizations/organization.repository';
import { AuthMiddleware } from '../../apps/backend/src/services/auth/auth.middleware';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { CreatorAuditController } from '../../apps/backend/src/api/routes/creator-audit.controller';

jest.mock('@gitroom/nestjs-libraries/database/prisma/prisma.service', () => ({ PrismaRepository: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/organizations/organization.service', () => ({ OrganizationService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/users/users.service', () => ({ UsersService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/integrations/integration.service', () => ({ IntegrationService: class {} }));

it('carries the selected membership identity from the real organization query into audit authorization', async () => {
  const actor = 'fixture-user';
  const member = { userId: actor, disabled: false, role: 'ADMIN' };
  const findMany = jest.fn(async (query: any) => [{
    id: 'fixture-org', apiKey: 'fixture-key',
    users: [Object.fromEntries(Object.keys(query.include.users.select).map(key => [key, member[key as keyof typeof member]]))],
  }]);
  const repository = new OrganizationRepository({ model: { organization: { findMany } } } as any, {} as any, {} as any);
  const organizations = await repository.getOrgsByUserId(actor);
  expect(findMany.mock.calls[0][0].where.users.some.userId).toBe(actor);
  expect(findMany.mock.calls[0][0].include.users.where.userId).toBe(actor);
  expect(organizations[0].users[0]).toEqual(member);

  const verify = jest.spyOn(AuthService, 'verifyJWT').mockReturnValue({ id: actor, activated: true } as any);
  const req: any = { headers: { auth: 'fixture' }, cookies: {} };
  try {
    const next = jest.fn();
    await new AuthMiddleware({ getOrgsByUserId: async () => organizations } as any, {} as any).use(req, {} as any, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(req.org.users.find((entry: any) => entry.userId === req.user.id)).toEqual(member);
  } finally { verify.mockRestore(); }
});

it.each(['foreign', 'disabled'])('continues rejecting an audit for a %s membership', async state => {
  const previous = { ...process.env };
  process.env.CREATOR_AUDIT_ENABLED = 'true';
  process.env.CREATOR_AUDIT_SERVICE_SECRET = 'fixture-dedicated-secret-'.repeat(4);
  process.env.CREATOR_AUDIT_SERVICE_URL = 'http://audit.example.test';
  const upstream = jest.spyOn(global, 'fetch');
  try {
    const req: any = { method: 'GET', path: '/creator-audit/audit', url: '/creator-audit/audit', headers: {},
      org: { id: 'fixture-org', users: [{ userId: state === 'foreign' ? 'other-user' : 'fixture-user',
        role: 'ADMIN', disabled: state === 'disabled' }] }, user: { id: 'fixture-user' } };
    await expect(new CreatorAuditController().proxy(req, {} as any)).rejects.toMatchObject({ status: 403 });
    expect(upstream).not.toHaveBeenCalled();
  } finally { upstream.mockRestore(); process.env = previous; }
});
