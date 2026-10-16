import { SubscriptionRepository } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.repository';

describe('lifetime code claims', () => {
  const repository = () => new SubscriptionRepository({} as any, {} as any, {} as any, {} as any, {} as any);
  const claim = (repo: SubscriptionRepository, tx: any, code = 'private-code') =>
    repo.persistLifetimeSubscription(tx, false, 'lifetime-id', 'org_1', 5, 'STANDARD', 'MONTHLY', null, code, { id: 'org_1' });

  const transaction = (claimed = false) => ({
    $queryRaw: jest.fn(async () => []),
    usedCodes: { findFirst: jest.fn(async () => claimed ? { id: 'existing-claim', orgId: 'other-org' } : null), create: jest.fn(async () => ({})) },
    subscription: { upsert: jest.fn(async () => ({})) },
    organization: { update: jest.fn(async () => ({})) },
  });

  it('locks the parameterized code before checking or granting it in the same transaction', async () => {
    const tx = transaction();
    await expect(claim(repository(), tx)).resolves.toEqual({ applied: true, organizationId: 'org_1' });
    const [query, code] = tx.$queryRaw.mock.calls[0] as any;
    expect(query.join('?')).toContain('pg_advisory_xact_lock(hashtextextended(?, 0))');
    expect(code).toBe('private-code');
    expect(tx.usedCodes.findFirst).toHaveBeenCalledWith({ where: { code: 'private-code' } });
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.usedCodes.findFirst.mock.invocationCallOrder[0]);
    expect(tx.usedCodes.findFirst.mock.invocationCallOrder[0]).toBeLessThan(tx.subscription.upsert.mock.invocationCallOrder[0]);
    expect(tx.usedCodes.create).toHaveBeenCalledWith({ data: { code: 'private-code', orgId: 'org_1' } });
  });

  it('rejects a claim already held by any organization before entitlement writes', async () => {
    const tx = transaction(true);
    await expect(claim(repository(), tx)).rejects.toThrow('Lifetime code has already been redeemed.');
    expect(tx.subscription.upsert).not.toHaveBeenCalled();
    expect(tx.organization.update).not.toHaveBeenCalled();
    expect(tx.usedCodes.create).not.toHaveBeenCalled();
  });

  it('resumes reconciliation for the owner without applying an upgrade twice', async () => {
    const tx = transaction();
    tx.usedCodes.findFirst.mockResolvedValueOnce({ id: 'existing-claim', orgId: 'org_1' } as any);
    await expect(claim(repository(), tx)).resolves.toEqual({ applied: true, organizationId: 'org_1' });
    expect(tx.subscription.upsert).not.toHaveBeenCalled();
    expect(tx.organization.update).not.toHaveBeenCalled();
    expect(tx.usedCodes.create).not.toHaveBeenCalled();
  });

  it('does not fall back to an unlocked claim if the lock fails', async () => {
    const tx = transaction();
    tx.$queryRaw.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(claim(repository(), tx)).rejects.toThrow('database unavailable');
    expect(tx.usedCodes.findFirst).not.toHaveBeenCalled();
    expect(tx.subscription.upsert).not.toHaveBeenCalled();
  });

  it('rejects legacy lifetime persistence without a claim transaction', async () => {
    await expect(repository().createOrUpdateSubscription(false, 'id', 'org_1', 5, 'STANDARD', 'MONTHLY', null, 'code', { id: 'org_1' }))
      .rejects.toThrow('Lifetime subscriptions require a claim transaction.');
  });
});
