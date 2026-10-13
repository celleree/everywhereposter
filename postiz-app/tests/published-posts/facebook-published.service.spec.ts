jest.mock('sharp', () => ({ __esModule: true, default: jest.fn() }));
import { FacebookPublishedService } from '../../libraries/nestjs-libraries/src/database/prisma/posts/facebook-published.service';
import { FacebookProvider } from '../../libraries/nestjs-libraries/src/integrations/social/facebook.provider';

const clone = (value: any) => structuredClone(value);
const setup = () => {
  process.env.FACEBOOK_APP_ID = 'app';
  const row: any = {
    id: 'ledger',
    postId: 'post',
    integrationId: 'integration',
    providerState: 'SUCCEEDED',
    providerResult: [
      {
        id: 'post',
        postId: '123_456',
        status: 'success',
        releaseURL: 'https://www.facebook.com/123_456',
        facebookText: {
          version: 1,
          appId: 'app',
          pageId: '123',
          message: 'Original',
          revision: 0,
          mutation: null,
        },
      },
    ],
    post: {
      id: 'post',
      organizationId: 'org',
      integrationId: 'integration',
      group: 'group',
      state: 'PUBLISHED',
      content: 'Original',
      releaseId: '123_456',
      releaseURL: 'https://www.facebook.com/123_456',
      parentPostId: null,
      deletedAt: null,
      childrenPost: [],
      image: '[]',
      settings: '{"__type":"facebook"}',
      integration: {
        id: 'integration',
        organizationId: 'org',
        internalId: '123',
        name: 'Test Page',
        providerIdentifier: 'facebook',
        token: 'secret-token',
      },
    },
  };
  const db: any = {
    publishingSubmissionDestination: {
      findFirst: jest.fn(async ({ where }) =>
        where.submission.organizationId === 'org' && where.postId === 'post'
          ? clone(row)
          : null
      ),
      updateMany: jest.fn(async ({ where, data }) => {
        if (
          JSON.stringify(where.providerResult.equals) !==
          JSON.stringify(row.providerResult)
        )
          return { count: 0 };
        row.providerResult = clone(data.providerResult);
        return { count: 1 };
      }),
    },
    post: {
      updateMany: jest.fn(async ({ data }) => {
        Object.assign(row.post, data);
        return { count: 1 };
      }),
    },
    historicalPost: { updateMany: jest.fn(async () => ({ count: 1 })) },
    $transaction: jest.fn(async (fn) => {
      const before = clone(row);
      try {
        return await fn(db);
      } catch (error) {
        Object.assign(row, before);
        throw error;
      }
    }),
  };
  const read = jest
    .spyOn(FacebookProvider.prototype, 'readPublishedText')
    .mockResolvedValue({ id: '123_456', message: 'Original' });
  const update = jest
    .spyOn(FacebookProvider.prototype, 'update')
    .mockResolvedValue([
      {
        id: 'post',
        postId: '123_456',
        releaseURL: 'https://www.facebook.com/123_456',
        status: 'success',
      },
    ]);
  const remove = jest
    .spyOn(FacebookProvider.prototype, 'deletePublished')
    .mockResolvedValue({ status: 'deleted' });
  return {
    row,
    db,
    read,
    update,
    remove,
    service: new FacebookPublishedService(db),
  };
};
afterEach(() => jest.restoreAllMocks());

describe('Facebook published message ledger', () => {
  it('commits only after remote verification while preserving identity, group and PUBLISHED state', async () => {
    const { service, row, update } = setup();
    update.mockImplementationOnce(async () => {
      expect(row.post.content).toBe('Original');
      expect(row.providerResult[0].facebookText.mutation.phase).toBe(
        'IN_FLIGHT'
      );
      return [
        { id: 'post', postId: '123_456', releaseURL: '', status: 'success' },
      ];
    });
    await expect(
      service.mutate('org', 'post', {
        action: 'edit',
        revision: 0,
        message: 'Edited <literal>',
      })
    ).resolves.toMatchObject({ revision: 1, message: 'Edited <literal>' });
    expect(row.post).toMatchObject({
      state: 'PUBLISHED',
      releaseId: '123_456',
      group: 'group',
      content: 'Edited &lt;literal&gt;',
    });
  });
  it.each(['timeout', 'Graph rejected', 'malformed'])(
    'preserves confirmed state on %s and never resends',
    async (message) => {
      const { service, row, update } = setup();
      update.mockRejectedValueOnce(new Error(message));
      await expect(
        service.mutate('org', 'post', {
          action: 'edit',
          revision: 0,
          message: 'Edited',
        })
      ).rejects.toThrow('reconciliation');
      expect(row.post).toMatchObject({
        content: 'Original',
        state: 'PUBLISHED',
        releaseId: '123_456',
      });
      await expect(
        service.mutate('org', 'post', {
          action: 'edit',
          revision: 0,
          message: 'Edited',
        })
      ).rejects.toThrow('reconciliation');
      expect(update).toHaveBeenCalledTimes(1);
    }
  );
  it('reconciles an ambiguous edit through a read of the same remote ID only', async () => {
    const { service, row, update, read } = setup();
    update.mockRejectedValueOnce(new Error('timeout'));
    await service
      .mutate('org', 'post', { action: 'edit', revision: 0, message: 'Edited' })
      .catch(() => {});
    read.mockResolvedValue({ id: '123_456', message: 'Edited' });
    await expect(service.reconcile('org', 'post')).resolves.toMatchObject({
      message: 'Edited',
      pending: false,
    });
    expect(update).toHaveBeenCalledTimes(1);
    expect(row.post.content).toBe('Edited');
  });
  it('keeps unresolved reads and in-flight workers locked', async () => {
    const { service, row, update } = setup();
    update.mockRejectedValueOnce(new Error('timeout'));
    await service
      .mutate('org', 'post', { action: 'edit', revision: 0, message: 'Edited' })
      .catch(() => {});
    await expect(service.reconcile('org', 'post')).rejects.toThrow(
      'not confirmed'
    );
    row.providerResult[0].facebookText.mutation.phase = 'IN_FLIGHT';
    await expect(service.reconcile('org', 'post')).rejects.toThrow(
      'still running'
    );
  });
  it('finishes remote-success/local-write failure without repeating a mutation', async () => {
    const { service, db, row, update } = setup();
    db.post.updateMany.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(
      service.mutate('org', 'post', {
        action: 'edit',
        revision: 0,
        message: 'Edited',
      })
    ).rejects.toThrow('reconciliation');
    expect(row.post.content).toBe('Original');
    expect(row.providerResult[0].facebookText.mutation.phase).toBe('CONFIRMED');
    await expect(service.reconcile('org', 'post')).resolves.toMatchObject({
      message: 'Edited',
    });
    expect(update).toHaveBeenCalledTimes(1);
  });
  it('confirms deletion, tombstones historical data and repeats safely', async () => {
    const { service, row, db, remove } = setup();
    await expect(
      service.mutate('org', 'post', { action: 'delete', revision: 0 })
    ).resolves.toMatchObject({ deleted: true });
    expect(row.post.state).toBe('DELETED_REMOTE');
    expect(db.historicalPost.updateMany).toHaveBeenCalledTimes(1);
    await expect(
      service.mutate('org', 'post', { action: 'delete', revision: 0 })
    ).resolves.toMatchObject({ deleted: true });
    expect(remove).toHaveBeenCalledTimes(1);
  });
  it('does not infer deletion from inaccessible/404/Graph 100 and never retries', async () => {
    const { service, row, remove } = setup();
    remove.mockRejectedValueOnce(new Error('Graph 100'));
    await service
      .mutate('org', 'post', { action: 'delete', revision: 0 })
      .catch(() => {});
    await expect(service.reconcile('org', 'post')).rejects.toThrow(
      'unconfirmed'
    );
    expect(row.post.state).toBe('PUBLISHED');
    expect(remove).toHaveBeenCalledTimes(1);
  });
  it('rejects stale/concurrent edits and deletes using the durable database fence', async () => {
    const { service, update, remove } = setup();
    const results = await Promise.allSettled([
      service.mutate('org', 'post', {
        action: 'edit',
        revision: 0,
        message: 'Edited',
      }),
      service.mutate('org', 'post', { action: 'delete', revision: 0 }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(update.mock.calls.length + remove.mock.calls.length).toBe(1);
    await expect(
      service.mutate('org', 'post', {
        action: 'edit',
        revision: 0,
        message: 'Other',
      })
    ).rejects.toThrow('changed');
  });
  it.each([
    (r: any) => {
      r.providerResult[0].facebookText = undefined;
    },
    (r: any) => {
      r.post.releaseId = '123_999';
    },
    (r: any) => {
      r.integrationId = 'another';
    },
    (r: any) => {
      r.post.organizationId = 'another';
    },
    (r: any) => {
      r.post.integration.internalId = '999';
    },
    (r: any) => {
      r.post.state = 'ERROR';
    },
    (r: any) => {
      r.post.image = '[{"path":"photo.jpg"}]';
    },
    (r: any) => {
      r.post.settings = '{"url":"https://example.com"}';
    },
    (r: any) => {
      r.post.childrenPost = [{ id: 'comment' }];
    },
    (r: any) => {
      r.post.integration.disabled = true;
    },
    (r: any) => {
      r.post.integration.deletedAt = 'date';
    },
    (r: any) => {
      r.post.integration.inBetweenSteps = true;
    },
    (r: any) => {
      r.post.integration.tokenExpiration = new Date(0);
    },
    (r: any) => {
      r.post.integration.token = '';
    },
    (r: any) => {
      r.post.integration.providerIdentifier = 'instagram';
    },
    (r: any) => {
      r.providerResult[0].facebookText.appId = 'other-app';
    },
  ])(
    'rejects ineligible or tampered records before a provider call %#',
    async (tamper) => {
      const { service, row, read } = setup();
      tamper(row);
      await expect(
        service.mutate('org', 'post', { action: 'delete', revision: 0 })
      ).rejects.toThrow();
      expect(read).not.toHaveBeenCalled();
    }
  );
  it.each([
    { releaseId: '123_999' },
    { integration: 'other' },
    { group: 'other' },
    { image: [] },
    { settings: {} },
    { children: [] },
  ])('rejects extra mutable payload fields %j', async (extra) => {
    const { service, read } = setup();
    await expect(
      service.mutate('org', 'post', {
        action: 'edit',
        revision: 0,
        message: 'Edited',
        ...extra,
      } as any)
    ).rejects.toThrow('Supply only');
    expect(read).not.toHaveBeenCalled();
  });
  it('does not reveal another organization or imported post', async () => {
    const { service, read } = setup();
    expect(await service.status('other-org', 'post')).toMatchObject({
      eligible: false,
    });
    expect(await service.status('org', 'imported')).toMatchObject({
      eligible: false,
    });
    expect(JSON.stringify(await service.status('org', 'post'))).not.toContain(
      'secret-token'
    );
    expect(read).not.toHaveBeenCalled();
  });
});
