import { NotificationsRepository } from '@gitroom/nestjs-libraries/database/prisma/notifications/notifications.repository';

const previousRead = new Date('2026-09-01T00:00:00.000Z');

const setup = () => {
  const findMany = jest.fn();
  let persistedRead = previousRead;
  const updateMany = jest.fn().mockImplementation(async ({ where, data }) => {
    if (
      where.id === 'user-1' &&
      persistedRead < where.lastReadNotifications.lt
    ) {
      persistedRead = data.lastReadNotifications;
      return { count: 1 };
    }
    return { count: 0 };
  });
  const repository = new NotificationsRepository(
    { model: { notifications: { findMany } } } as any,
    {
      model: {
        user: {
          findFirst: jest.fn().mockImplementation(async () => ({
            lastReadNotifications: persistedRead,
          })),
          updateMany,
        },
      },
    } as any
  );
  return {
    repository,
    findMany,
    updateMany,
    getPersistedRead: () => persistedRead,
  };
};

it('does not advance read state when the list query fails', async () => {
  const { repository, findMany, updateMany } = setup();
  findMany.mockRejectedValue(new Error('query failed'));

  await expect(repository.getNotifications('org-1', 'user-1')).rejects.toThrow(
    'query failed'
  );
  expect(updateMany).not.toHaveBeenCalled();
  expect(findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      take: 10,
      where: { organizationId: 'org-1' },
    })
  );
});

it('returns the prior read time and bounds the new cutoff to the fetched snapshot', async () => {
  const { repository, findMany, updateMany } = setup();
  const notifications = [
    { createdAt: new Date(), content: 'Previously read item' },
  ];
  findMany.mockResolvedValue(notifications);
  const startedAt = Date.now();

  await expect(repository.getNotifications('org-1', 'user-1')).resolves.toEqual(
    {
      lastReadNotifications: previousRead,
      notifications,
    }
  );
  const { where, data } = updateMany.mock.calls[0][0];
  const cutoff = data.lastReadNotifications as Date;
  expect(where).toEqual({
    id: 'user-1',
    lastReadNotifications: { lt: cutoff },
  });
  expect(cutoff.getTime()).toBeGreaterThanOrEqual(startedAt);
  expect(cutoff.getTime()).toBeLessThanOrEqual(Date.now());
  expect(findMany.mock.invocationCallOrder[0]).toBeLessThan(
    updateMany.mock.invocationCallOrder[0]
  );
});

it('does not move persisted read state backward when overlapping lists finish out of order', async () => {
  const { repository, findMany, updateMany, getPersistedRead } = setup();
  let finishOlder!: (value: unknown[]) => void;
  let finishNewer!: (value: unknown[]) => void;
  findMany
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishOlder = resolve;
        })
    )
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishNewer = resolve;
        })
    );

  jest.useFakeTimers();
  try {
    const olderTime = new Date('2026-09-28T12:00:00.000Z');
    const newerTime = new Date('2026-09-28T12:00:01.000Z');
    jest.setSystemTime(olderTime);
    const older = repository.getNotifications('org-1', 'user-1');
    await Promise.resolve();
    expect(findMany).toHaveBeenCalledTimes(1);

    jest.setSystemTime(newerTime);
    const newer = repository.getNotifications('org-1', 'user-1');
    await Promise.resolve();
    expect(findMany).toHaveBeenCalledTimes(2);

    finishNewer([]);
    await newer;
    expect(getPersistedRead()).toEqual(newerTime);
    finishOlder([]);
    await older;
    expect(getPersistedRead()).toEqual(newerTime);
    expect(updateMany).toHaveBeenCalledTimes(2);
    expect(
      updateMany.mock.calls.map(
        ([input]) => input.where.lastReadNotifications.lt
      )
    ).toEqual([newerTime, olderTime]);
  } finally {
    jest.useRealTimers();
  }
});
