import { MediaService } from '@gitroom/nestjs-libraries/database/prisma/media/media.service';
import {
  AuthorizationActions,
  Sections,
} from '@gitroom/backend/services/auth/permissions/permission.exception.class';

const org = {
  id: 'org-1',
  subscription: {
    subscriptionTier: 'STANDARD',
    createdAt: new Date('2026-07-01T00:00:00.000Z'),
  },
} as any;

describe('MediaService image credits', () => {
  const originalStripeKey = process.env.STRIPE_PUBLISHABLE_KEY;
  const mediaRepository = {};
  const openAi = {
    generateImage: jest.fn(),
    generatePromptForPicture: jest.fn(),
  };
  const subscriptionService = {
    useCredit: jest.fn(),
    useCreditWithinLimit: jest.fn(),
  };
  const videoManager = {};

  const createService = () =>
    new MediaService(
      mediaRepository as any,
      openAi as any,
      subscriptionService as any,
      videoManager as any
    );

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test_billing-enabled';
  });

  afterAll(() => {
    if (originalStripeKey === undefined) {
      delete process.env.STRIPE_PUBLISHABLE_KEY;
    } else {
      process.env.STRIPE_PUBLISHABLE_KEY = originalStripeKey;
    }
  });

  it('rejects exhausted image balances before invoking the provider when billing is enabled', async () => {
    subscriptionService.useCreditWithinLimit.mockResolvedValue({
      allowed: false,
    });

    let rejection: any;
    try {
      await createService().generateImage('A grounded visual prompt', org);
    } catch (error) {
      rejection = error;
    }

    expect(rejection?.getResponse()).toEqual({
      action: AuthorizationActions.Create,
      section: Sections.AI,
    });
    expect(subscriptionService.useCreditWithinLimit).toHaveBeenCalledWith(
      org,
      'ai_images',
      expect.any(Function)
    );
    expect(subscriptionService.useCredit).not.toHaveBeenCalled();
    expect(openAi.generateImage).not.toHaveBeenCalled();
  });

  it('invokes the provider through the atomic reservation when credits remain', async () => {
    subscriptionService.useCreditWithinLimit.mockImplementation(
      async (_organization: unknown, _type: string, operation: () => Promise<any>) => ({
        allowed: true,
        value: await operation(),
      })
    );
    openAi.generateImage.mockResolvedValue('base64-image');

    await expect(
      createService().generateImage('A grounded visual prompt', org, false, true)
    ).resolves.toBe('base64-image');

    expect(subscriptionService.useCreditWithinLimit).toHaveBeenCalledWith(
      org,
      'ai_images',
      expect.any(Function)
    );
    expect(subscriptionService.useCredit).not.toHaveBeenCalled();
    expect(openAi.generateImage).toHaveBeenCalledWith(
      'A grounded visual prompt',
      false,
      true,
      false
    );
  });

  it('preserves image generation when billing is disabled', async () => {
    delete process.env.STRIPE_PUBLISHABLE_KEY;
    subscriptionService.useCredit.mockImplementation(
      async (_organization: unknown, _type: string, operation: () => Promise<any>) =>
        operation()
    );
    openAi.generateImage.mockResolvedValue('base64-image');

    await expect(
      createService().generateImage('A self-hosted visual prompt', {
        id: 'self-hosted-org',
      } as any)
    ).resolves.toBe('base64-image');

    expect(subscriptionService.useCreditWithinLimit).not.toHaveBeenCalled();
    expect(subscriptionService.useCredit).toHaveBeenCalledWith(
      { id: 'self-hosted-org' },
      'ai_images',
      expect.any(Function)
    );
    expect(openAi.generateImage).toHaveBeenCalledWith(
      'A self-hosted visual prompt',
      false,
      false,
      false
    );
  });
});
