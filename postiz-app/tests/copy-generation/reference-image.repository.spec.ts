import { ReferenceImageRepository } from '@gitroom/nestjs-libraries/database/prisma/reference-images/reference-image.repository';

describe('ReferenceImageRepository active counting', () => {
  it('excludes references whose media has been soft-deleted', async () => {
    const queryRaw = jest.fn().mockResolvedValue([{ count: BigInt(2) }]);
    const repository = new ReferenceImageRepository({} as any, {} as any);

    const result = await repository.countActive('org-1', {
      $queryRaw: queryRaw,
    } as any);

    expect(result).toBe(2);
    expect(queryRaw).toHaveBeenCalledTimes(1);

    const query = queryRaw.mock.calls[0][0] as {
      strings?: string[];
      sql?: string;
      text?: string;
    };
    const sql =
      query.strings?.join('?') || query.sql || query.text || String(query);

    expect(sql).toContain('INNER JOIN public."Media" media');
    expect(sql).toContain('media."deletedAt" IS NULL');
  });
});
