import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { PostsRepository } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.repository';
import { GetPostsListDto } from '@gitroom/nestjs-libraries/dtos/posts/get.posts.list.dto';
import {
  expandPostsList,
  minifyPostsList,
} from '@gitroom/helpers/utils/posts.list.minify';

const NOW = new Date('2026-09-28T12:00:00.000Z');

const post = (id: string, overrides: Record<string, any> = {}) => ({
  id,
  organizationId: 'org-1',
  state: 'QUEUE',
  publishDate: new Date('2026-09-29T12:00:00.000Z'),
  intervalInDays: null,
  parentPostId: null,
  deletedAt: null,
  group: `group-${id}`,
  content: id,
  tags: [],
  integration: {
    id: 'integration-1',
    name: 'Account',
    providerIdentifier: 'x',
    picture: '',
    customerId: 'customer-1',
    deletedAt: null,
    disabled: false,
    refreshNeeded: false,
  },
  ...overrides,
});

// In-memory Prisma stand-in: exercises the repository's composed filter,
// ordering, count and pagination, but does not prove database execution.
const createRepository = (rows: ReturnType<typeof post>[]) => {
  const eligible = (where: any) =>
    rows.filter((row) => {
      const org = where.AND[0].OR[0].organizationId;
      const now = where.AND[1].publishDate.gte;
      return (
        row.organizationId === org &&
        row.publishDate >= now &&
        row.deletedAt === where.deletedAt &&
        row.parentPostId === where.parentPostId &&
        row.intervalInDays === where.intervalInDays &&
        (!where.state || row.state === where.state) &&
        (!where.integration ||
          (row.integration.customerId ===
            (where.integration.customerId || row.integration.customerId) &&
            (!('deletedAt' in where.integration) ||
              row.integration.deletedAt === where.integration.deletedAt)))
      );
    });
  const findMany = jest.fn(async ({ where, skip, take, orderBy }: any) => {
    const sorted = eligible(where).sort((a, b) => {
      const date = a.publishDate.getTime() - b.publishDate.getTime();
      return date || (Array.isArray(orderBy) ? a.id.localeCompare(b.id) : 0);
    });
    return sorted.slice(skip, skip + take);
  });
  const count = jest.fn(async ({ where }: any) => eligible(where).length);
  const repository = new PostsRepository(
    { model: { post: { findMany, count } } } as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any
  );
  return { repository, findMany, count };
};

describe('GET /posts/list scheduled-once repository contract', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
  });
  afterEach(() => jest.useRealTimers());

  it('validates only the optional scheduled-once selector', () => {
    expect(validateSync(plainToInstance(GetPostsListDto, {}))).toHaveLength(0);
    expect(
      validateSync(plainToInstance(GetPostsListDto, { mode: 'scheduled-once' }))
    ).toHaveLength(0);
    for (const mode of ['scheduled', 'all', '', 1, ['scheduled-once']]) {
      expect(
        validateSync(plainToInstance(GetPostsListDto, { mode })).some(
          (error) => error.property === 'mode'
        )
      ).toBe(true);
    }
  });

  it('preserves the legacy query, ordering, and response shape without mode', async () => {
    const { repository, findMany, count } = createRepository([
      post('draft', { state: 'DRAFT' }),
      post('queued', {
        integration: { ...post('queued').integration, deletedAt: NOW },
      }),
    ]);
    const result = await repository.getPostsList('org-1', { page: 0, limit: 20 });
    expect(result).toMatchObject({ total: 2, page: 0, limit: 20, hasMore: false });
    expect(result.posts.map((item) => item.id)).toEqual(['draft', 'queued']);
    const args = findMany.mock.calls[0][0];
    expect(args.where).not.toHaveProperty('state');
    expect(args.where).not.toHaveProperty('integration');
    expect(args.orderBy).toEqual({ publishDate: 'asc' });
    expect(count.mock.calls[0][0].where).toBe(args.where);
  });

  it('filters before counting and pages with a stable tie-breaker', async () => {
    const atNow = { publishDate: NOW };
    const rows = [
      post('b', atNow),
      post('a', atNow),
      post('later'),
      post('before', { publishDate: new Date(NOW.getTime() - 1) }),
      post('draft', { state: 'DRAFT' }),
      post('failed', { state: 'ERROR' }),
      post('published', { state: 'PUBLISHED' }),
      post('remote-deleted', { state: 'DELETED_REMOTE' }),
      post('deleted', { deletedAt: NOW }),
      post('recurring', { intervalInDays: 7 }),
      post('child', { parentPostId: 'a' }),
      post('other-org', { organizationId: 'org-2' }),
      post('other-customer', {
        integration: { ...post('x').integration, customerId: 'customer-2' },
      }),
      post('deleted-integration', {
        integration: { ...post('x').integration, deletedAt: NOW },
      }),
      post('disabled', {
        integration: { ...post('x').integration, disabled: true, refreshNeeded: true },
      }),
    ];
    const { repository, findMany, count } = createRepository(rows);
    const query = { mode: 'scheduled-once' as const, customer: 'customer-1', limit: 2 };
    const first = await repository.getPostsList('org-1', { ...query, page: 0 });
    const second = await repository.getPostsList('org-1', { ...query, page: 1 });
    const third = await repository.getPostsList('org-1', { ...query, page: 2 });
    const beyond = await repository.getPostsList('org-1', { ...query, page: 3 });
    expect(first.posts.map((item) => item.id)).toEqual(['a', 'b']);
    expect(second.posts.map((item) => item.id)).toEqual(['disabled', 'later']);
    expect(third.posts).toEqual([]);
    expect(beyond.posts).toEqual([]);
    expect([first, second, third, beyond].map(({ total, hasMore }) => [total, hasMore]))
      .toEqual([[4, true], [4, false], [4, false], [4, false]]);
    for (const [index, call] of findMany.mock.calls.entries()) {
      const args = call[0];
      expect(args.where).toBe(count.mock.calls[index][0].where);
      expect(args.where.AND[1].publishDate.gte).toEqual(NOW);
      expect(args.where).toMatchObject({
        state: 'QUEUE',
        deletedAt: null,
        parentPostId: null,
        intervalInDays: null,
        integration: { deletedAt: null, customerId: 'customer-1' },
      });
      expect(args.orderBy).toEqual([{ publishDate: 'asc' }, { id: 'asc' }]);
    }
  });

  it('returns an empty page and preserves the minified response contract', async () => {
    const { repository } = createRepository([]);
    expect(await repository.getPostsList('org-1', { mode: 'scheduled-once' }))
      .toMatchObject({ posts: [], total: 0, page: 0, limit: 20, hasMore: false });
    const populated = createRepository([post('one')]);
    const result = await populated.repository.getPostsList('org-1', {
      mode: 'scheduled-once',
    });
    expect(expandPostsList(minifyPostsList(result))).toEqual(result);
  });
});
