import { ReferenceImageService } from '@gitroom/nestjs-libraries/database/prisma/reference-images/reference-image.service';

const storedReference = {
  mediaId: 'media-1',
  organizationId: 'org-1',
  name: 'Editorial reference',
  tags: ['editorial'],
  brand: 'Founder account',
  aspectRatio: '4:5',
  styleNotes: 'Large headline with generous spacing.',
  isActive: true,
  isPrimary: true,
  usageCount: 0,
  lastPlatforms: [],
  createdAt: new Date('2026-07-29T12:00:00.000Z'),
  updatedAt: new Date('2026-07-29T12:00:00.000Z'),
  mediaName: 'reference.png',
  originalName: 'reference.png',
  path: 'https://example.com/reference.png',
  mediaType: 'image',
  alt: 'A founder presenting a product dashboard.',
};

describe('ReferenceImageService metadata isolation', () => {
  it('returns the media accessibility text without replacing it with reference metadata', async () => {
    const repository = {
      list: jest.fn().mockResolvedValue([storedReference]),
    };
    const service = new ReferenceImageService(repository as any);

    const result = await service.list('org-1');

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 'media-1',
      alt: 'A founder presenting a product dashboard.',
      name: 'Editorial reference',
      tags: ['editorial'],
    });
    expect(result[0].alt).not.toContain('styleNotes');
  });

  it('keeps a reference available when the underlying media alt text changes', async () => {
    const repository = {
      list: jest
        .fn()
        .mockResolvedValueOnce([storedReference])
        .mockResolvedValueOnce([
          {
            ...storedReference,
            alt: 'Updated accessible description for publishing.',
          },
        ]),
    };
    const service = new ReferenceImageService(repository as any);

    const before = await service.list('org-1');
    const after = await service.list('org-1');

    expect(before[0].id).toBe('media-1');
    expect(after[0]).toMatchObject({
      id: 'media-1',
      alt: 'Updated accessible description for publishing.',
      name: 'Editorial reference',
    });
  });

  it('creates reference state separately and never writes Media.alt', async () => {
    const transaction = {};
    const repository = {
      withOrganizationMutationLock: jest.fn(
        async (
          _orgId: string,
          callback: (currentTransaction: object) => Promise<unknown>
        ) => callback(transaction)
      ),
      getMedia: jest.fn().mockResolvedValue({
        id: 'media-1',
        name: 'reference.png',
        originalName: 'reference.png',
        type: 'image',
        alt: 'Existing accessible description.',
      }),
      getReference: jest.fn().mockResolvedValue(undefined),
      countActive: jest.fn().mockResolvedValue(0),
      clearPrimary: jest.fn(),
      createReference: jest.fn().mockResolvedValue(storedReference),
    };
    const service = new ReferenceImageService(repository as any);

    await service.create('org-1', {
      mediaId: 'media-1',
      name: 'Editorial reference',
      tags: ['editorial'],
      isActive: true,
      isPrimary: true,
    });

    expect(repository.createReference).toHaveBeenCalledWith(
      expect.objectContaining({
        mediaId: 'media-1',
        organizationId: 'org-1',
        name: 'Editorial reference',
        tags: ['editorial'],
        isActive: true,
        isPrimary: true,
      }),
      transaction
    );
    expect(repository.getMedia).toHaveBeenCalledTimes(1);
    expect(
      Object.values(repository).some(
        (value: any) => value?.mock?.calls?.some((call: any[]) =>
          call.some(
            (argument) =>
              typeof argument === 'string' &&
              argument.includes('__everywhereposter_reference_image_v1__')
          )
        )
      )
    ).toBe(false);
  });
});
