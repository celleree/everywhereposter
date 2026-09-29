import { NotificationsRepository } from '@gitroom/nestjs-libraries/database/prisma/notifications/notifications.repository';

const previousRead = new Date('2026-09-01T00:00:00.000Z');

const setup = () => {
  const findMany = jest.fn();
  const update = jest.fn().mockResolvedValue(undefined);
  const repository = new NotificationsRepository(
    { model: { notifications: { findMany } } } as any,
    {
      model: {
        user: {
          findFirst: jest
            .fn()
            .mockResolvedValue({ lastReadNotifications: previousRead }),
          update,
        },
      },
    } as any
  );
  return { repository, findMany, update };
};

it('does not advance read state when the list query fails', async () => {
  const { repository, findMany, update } = setup();
  findMany.mockRejectedValue(new Error('query failed'));

  await expect(repository.getNotifications('org-1', 'user-1')).rejects.toThrow(
    'query failed'
  );
  expect(update).not.toHaveBeenCalled();
  expect(findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      take: 10,
      where: { organizationId: 'org-1' },
    })
  );
});

it('returns the prior read time and bounds the new cutoff to the fetched snapshot', async () => {
  const { repository, findMany, update } = setup();
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
  const cutoff = update.mock.calls[0][0].data.lastReadNotifications as Date;
  expect(cutoff.getTime()).toBeGreaterThanOrEqual(startedAt);
  expect(cutoff.getTime()).toBeLessThanOrEqual(Date.now());
  expect(findMany.mock.invocationCallOrder[0]).toBeLessThan(
    update.mock.invocationCallOrder[0]
  );
});
