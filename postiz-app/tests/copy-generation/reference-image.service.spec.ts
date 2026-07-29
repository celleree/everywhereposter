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

const withTransaction = (transaction: object) =>
  jest.fn(
    async (
      _orgId: string,
      callback: (currentTransaction: object) => Promise<unknown>
    ) => callback(transaction)
  );

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
      withOrganizationMutationLock: withTransaction(transaction),
      getMedia: jest.fn().mockResolvedValue({
        id: 'media-1',
        name: 'reference.png',
        originalName: 'reference.png',
        path: 'https://example.com/reference.png',
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

  it('rejects reference formats that cannot be sent to the vision model', async () => {
    const transaction = {};
    const repository = {
      withOrganizationMutationLock: withTransaction(transaction),
      getMedia: jest.fn().mockResolvedValue({
        id: 'media-tiff',
        name: 'reference.tiff',
        originalName: 'reference.tiff',
        path: 'https://example.com/reference.tiff',
        type: 'image',
      }),
      getReference: jest.fn(),
    };
    const service = new ReferenceImageService(repository as any);

    await expect(
      service.create('org-1', {
        mediaId: 'media-tiff',
        isActive: true,
      })
    ).rejects.toThrow('Reference images must be PNG, JPEG, or WebP files.');

    expect(repository.getReference).not.toHaveBeenCalled();
  });

  it('saves an overflow upload inactive when four references are already active', async () => {
    const transaction = {};
    const repository = {
      withOrganizationMutationLock: withTransaction(transaction),
      getMedia: jest.fn().mockResolvedValue({
        id: 'media-5',
        name: 'fifth-reference.webp',
        originalName: 'fifth-reference.webp',
        path: 'https://example.com/fifth-reference.webp',
        type: 'image',
      }),
      getReference: jest.fn().mockResolvedValue(undefined),
      countActive: jest.fn().mockResolvedValue(4),
      clearPrimary: jest.fn(),
      createReference: jest.fn().mockImplementation(async (state) => ({
        ...storedReference,
        ...state,
        mediaName: 'fifth-reference.webp',
        originalName: 'fifth-reference.webp',
        path: 'https://example.com/fifth-reference.webp',
      })),
    };
    const service = new ReferenceImageService(repository as any);

    const result = await service.create('org-1', {
      mediaId: 'media-5',
      isActive: true,
      isPrimary: true,
    });

    expect(repository.createReference).toHaveBeenCalledWith(
      expect.objectContaining({
        mediaId: 'media-5',
        isActive: false,
        isPrimary: false,
      }),
      transaction
    );
    expect(repository.clearPrimary).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      id: 'media-5',
      isActive: false,
      isPrimary: false,
    });
  });

  it('clears primary status when an active primary reference is deactivated', async () => {
    const transaction = {};
    const repository = {
      withOrganizationMutationLock: withTransaction(transaction),
      getReference: jest.fn().mockResolvedValue(storedReference),
      clearPrimary: jest.fn(),
      countActive: jest.fn(),
      updateReference: jest.fn().mockImplementation(async (state) => ({
        ...storedReference,
        ...state,
      })),
    };
    const service = new ReferenceImageService(repository as any);

    const result = await service.update('org-1', 'media-1', {
      isActive: false,
    });

    expect(repository.updateReference).toHaveBeenCalledWith(
      expect.objectContaining({
        mediaId: 'media-1',
        isActive: false,
        isPrimary: false,
      }),
      transaction
    );
    expect(repository.clearPrimary).not.toHaveBeenCalled();
    expect(repository.countActive).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      isActive: false,
      isPrimary: false,
    });
  });

  it('rejects updates to archived references until they are restored', async () => {
    const transaction = {};
    const repository = {
      withOrganizationMutationLock: withTransaction(transaction),
      getReference: jest.fn().mockResolvedValue({
        ...storedReference,
        isActive: false,
        isPrimary: false,
        archivedAt: new Date('2026-07-29T13:00:00.000Z'),
      }),
      updateReference: jest.fn(),
      clearPrimary: jest.fn(),
      countActive: jest.fn(),
    };
    const service = new ReferenceImageService(repository as any);

    await expect(
      service.update('org-1', 'media-1', { isActive: true })
    ).rejects.toThrow('Restore archived references before updating them.');

    expect(repository.updateReference).not.toHaveBeenCalled();
    expect(repository.clearPrimary).not.toHaveBeenCalled();
    expect(repository.countActive).not.toHaveBeenCalled();
  });

  it('revalidates the active limit before restoring legacy active state', async () => {
    const transaction = {};
    const repository = {
      withOrganizationMutationLock: withTransaction(transaction),
      getReference: jest.fn().mockResolvedValue({
        ...storedReference,
        archivedAt: new Date('2026-07-29T13:00:00.000Z'),
      }),
      countActive: jest.fn().mockResolvedValue(4),
      clearPrimary: jest.fn(),
      updateReference: jest.fn(),
    };
    const service = new ReferenceImageService(repository as any);

    await expect(service.restore('org-1', 'media-1')).rejects.toThrow(
      'You can activate up to 4 reference images at once.'
    );

    expect(repository.countActive).toHaveBeenCalledWith('org-1', transaction);
    expect(repository.clearPrimary).not.toHaveBeenCalled();
    expect(repository.updateReference).not.toHaveBeenCalled();
  });

  it('revalidates and replaces the visible primary when restoring a legacy primary', async () => {
    const transaction = {};
    const repository = {
      withOrganizationMutationLock: withTransaction(transaction),
      getReference: jest.fn().mockResolvedValue({
        ...storedReference,
        archivedAt: new Date('2026-07-29T13:00:00.000Z'),
      }),
      countActive: jest.fn().mockResolvedValue(3),
      clearPrimary: jest.fn().mockResolvedValue(undefined),
      updateReference: jest.fn().mockImplementation(async (state) => ({
        ...storedReference,
        ...state,
      })),
    };
    const service = new ReferenceImageService(repository as any);

    const result = await service.restore('org-1', 'media-1');

    expect(repository.countActive).toHaveBeenCalledWith('org-1', transaction);
    expect(repository.clearPrimary).toHaveBeenCalledWith(
      'org-1',
      'media-1',
      transaction
    );
    expect(repository.updateReference).toHaveBeenCalledWith(
      expect.objectContaining({
        mediaId: 'media-1',
        isActive: true,
        isPrimary: true,
      }),
      transaction
    );
    const [restoredState] = repository.updateReference.mock.calls[0];
    expect(restoredState).not.toHaveProperty('archivedAt');
    expect(result).toMatchObject({
      isActive: true,
      isPrimary: true,
    });
    expect(result.archivedAt).toBeUndefined();
  });

  it('treats usage tracking failures as best-effort', async () => {
    const repository = {
      getMediaWithOrganization: jest.fn().mockResolvedValue({
        id: 'source-media',
        organizationId: 'org-1',
      }),
      withOrganizationMutationLock: jest
        .fn()
        .mockRejectedValue(new Error('database temporarily unavailable')),
    };
    const service = new ReferenceImageService(repository as any);

    await expect(
      service.markUsedForSourceMedia(
        'source-media',
        [
          {
            id: 'media-1',
            name: 'Editorial reference',
            path: 'https://example.com/reference.png',
            tags: ['editorial'],
            isPrimary: true,
          },
        ],
        ['instagram']
      )
    ).resolves.toBeUndefined();

    expect(repository.withOrganizationMutationLock).toHaveBeenCalledTimes(1);
  });
});
