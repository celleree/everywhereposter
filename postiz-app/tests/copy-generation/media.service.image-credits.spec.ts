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
    checkCredits: jest.fn(),
    useCredit: jest.fn(),
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
    subscriptionService.checkCredits.mockResolvedValue({ credits: 0 });

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
    expect(subscriptionService.checkCredits).toHaveBeenCalledWith(
      org,
      'ai_images'
    );
    expect(subscriptionService.useCredit).not.toHaveBeenCalled();
    expect(openAi.generateImage).not.toHaveBeenCalled();
  });

  it('records usage and invokes the provider when image credits remain', async () => {
    subscriptionService.checkCredits.mockResolvedValue({ credits: 2 });
    subscriptionService.useCredit.mockImplementation(
      async (_organization: unknown, _type: string, operation: () => Promise<any>) =>
        operation()
    );
    openAi.generateImage.mockResolvedValue('base64-image');

    await expect(
      createService().generateImage('A grounded visual prompt', org, false, true)
    ).resolves.toBe('base64-image');

    expect(subscriptionService.checkCredits).toHaveBeenCalledWith(
      org,
      'ai_images'
    );
    expect(subscriptionService.useCredit).toHaveBeenCalledWith(
      org,
      'ai_images',
      expect.any(Function)
    );
    expect(openAi.generateImage).toHaveBeenCalledWith(
      'A grounded visual prompt',
      false,
      true
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

    expect(subscriptionService.checkCredits).not.toHaveBeenCalled();
    expect(subscriptionService.useCredit).toHaveBeenCalledWith(
      { id: 'self-hosted-org' },
      'ai_images',
      expect.any(Function)
    );
    expect(openAi.generateImage).toHaveBeenCalledWith(
      'A self-hosted visual prompt',
      false,
      false
    );
  });
});
