import { AiWalletCheckoutService } from '@gitroom/nestjs-libraries/services/ai-wallet-checkout.service';
import { MediaTranscriptionService } from '@gitroom/nestjs-libraries/database/prisma/media-transcription/media-transcription.service';
import { AiWalletTranscriptionService, PREPAID_TRANSCRIPTION_MODEL } from '@gitroom/nestjs-libraries/services/ai-wallet-transcription.service';
import { PREPAID_AI_POLICY, snapshotFingerprint } from '@gitroom/nestjs-libraries/services/ai-wallet-pricing';
import { BillingController } from '../../apps/backend/src/api/routes/billing.controller';

jest.mock('@gitroom/nestjs-libraries/services/stripe.service', () => ({ StripeService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service', () => ({ SubscriptionService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/notifications/notification.service', () => ({ NotificationService: class {} }));
jest.mock('@gitroom/nestjs-libraries/crypto/nowpayments', () => ({ Nowpayments: class {} }));
jest.mock('@gitroom/helpers/auth/auth.service', () => ({ AuthService: class {} }));
jest.mock('@gitroom/nestjs-libraries/copy-generation/video-media-file', () => ({
  prepareVideoMediaFile: jest.fn(async () => ({
    inputPath: '/tmp/offline.mp4',
    cleanup: jest.fn(async () => undefined),
  })),
}));

const enabledEnv = {
  BILLING_ENABLED: 'true',
  AI_WALLET_ENABLED: 'true',
  AI_WALLET_TRANSCRIPTION_ENABLED: 'true',
  STRIPE_SECRET_KEY: 'sk_test_synthetic_not_a_credential',
  FRONTEND_URL: 'http://localhost:4200',
  AI_WALLET_TEST_OFFERS: '[{"id":"synthetic","amountCents":500}]',
};
const originalEnv = Object.fromEntries(
  Object.keys(enabledEnv).map((key) => [key, process.env[key]])
);

describe('per-plan prepaid AI authorization', () => {
  beforeEach(() => {
    Object.assign(process.env, enabledEnv);
    jest.clearAllMocks();
  });

  afterAll(() => {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const checkoutHarness = (tiers: Array<string | null>) => {
    const findFirst = jest.fn();
    for (const tier of tiers) {
      findFirst.mockResolvedValueOnce(
        tier ? { subscriptionTier: tier } : null
      );
    }
    const db = {
      subscription: { findFirst },
      organization: {
        findUnique: jest.fn(async () => ({ paymentId: 'cus_synthetic' })),
      },
    };
    const wallet = {
      createTopup: jest.fn(async () => ({
        id: 'topup-1',
        customerId: 'cus_synthetic',
        amountCents: 500,
        sessionId: null,
        fundedAt: null,
      })),
      bindTopupSession: jest.fn(async () => undefined),
    };
    const sdk = {
      checkout: {
        sessions: {
          create: jest.fn(async (params: any) => ({
            id: 'cs_test_synthetic',
            livemode: false,
            mode: params.mode,
            customer: params.customer,
            client_reference_id: params.client_reference_id,
            metadata: params.metadata,
            currency: 'usd',
            amount_total: 500,
            payment_status: 'unpaid',
            status: 'open',
            url: 'https://checkout.stripe.com/c/pay/synthetic',
          })),
          retrieve: jest.fn(),
        },
      },
    };
    const service = new AiWalletCheckoutService(db as any, wallet as any);
    jest.spyOn(service as any, 'client').mockReturnValue(sdk);
    return { service, db, wallet, sdk, findFirst };
  };

  it('rejects wallet reads and purchases for a fresh non-prepaid plan', async () => {
    const { service, sdk, wallet, findFirst } = checkoutHarness([
      'STANDARD',
      'STANDARD',
    ]);

    await expect(service.offers('org-1')).rejects.toThrow(
      'not included in this plan'
    );
    await expect(
      service.createCheckout('org-1', 'synthetic', 'request-1')
    ).rejects.toThrow('not included in this plan');

    expect(findFirst).toHaveBeenCalledTimes(2);
    expect(wallet.createTopup).not.toHaveBeenCalled();
    expect(sdk.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it('rechecks the launch plan immediately before Stripe Checkout', async () => {
    const { service, sdk, wallet, findFirst } = checkoutHarness([
      'LAUNCH_V1',
      'LAUNCH_V1',
    ]);

    await expect(
      service.createCheckout('org-1', 'synthetic', 'request-1')
    ).resolves.toMatchObject({ topupId: 'topup-1', status: 'open' });

    expect(findFirst).toHaveBeenCalledTimes(2);
    expect(wallet.createTopup).toHaveBeenCalledTimes(1);
    expect(sdk.checkout.sessions.create).toHaveBeenCalledTimes(1);
  });

  it('stops before Stripe when the plan changes after intent creation', async () => {
    const { service, sdk, wallet, findFirst } = checkoutHarness([
      'LAUNCH_V1',
      'STANDARD',
    ]);

    await expect(
      service.createCheckout('org-1', 'synthetic', 'request-1')
    ).rejects.toThrow('not included in this plan');

    expect(findFirst).toHaveBeenCalledTimes(2);
    expect(wallet.createTopup).toHaveBeenCalledTimes(1);
    expect(sdk.checkout.sessions.create).not.toHaveBeenCalled();
  });

  const lifecycleHarness = (
    tier: string | null,
    prepaid?: { run: jest.Mock }
  ) => {
    const repository = {
      claimForProcessing: jest.fn(async () => true),
      getActiveWorkerInput: jest.fn(async () => ({
        media: {
          organizationId: 'org-1',
          path: '/offline/input.mp4',
          name: 'input.mp4',
          originalName: 'input.mp4',
          organization: {
            subscription: tier ? { subscriptionTier: tier } : null,
          },
        },
      })),
      completeIfActive: jest.fn(async () => true),
    };
    const model = {
      preparePrepaidTranscription: jest.fn(),
      transcribeVideo: jest.fn(async () => ({ text: 'legacy transcript' })),
    };
    const service = new MediaTranscriptionService(
      repository as any,
      {} as any,
      model as any,
      prepaid as any
    );
    return { service, repository, model, prepaid };
  };

  it('uses prepaid for LAUNCH and never reaches the legacy model', async () => {
    const prepaid = { run: jest.fn(async () => ({ state: 'UNKNOWN' })) };
    const { service, model } = lifecycleHarness('LAUNCH_V1', prepaid);

    await expect(service.processTranscription('job-1', 1)).resolves.toEqual({
      discarded: false,
      status: 'PROCESSING',
    });

    expect(prepaid.run).toHaveBeenCalledWith(
      'org-1',
      'job-1',
      1,
      true,
      expect.any(Function)
    );
    expect(model.transcribeVideo).not.toHaveBeenCalled();
  });

  it('keeps legacy bundled transcription unmetered without opening a wallet reservation', async () => {
    const prepaid = { run: jest.fn(async () => undefined) };
    const { service, model } = lifecycleHarness('STANDARD', prepaid);

    await expect(service.processTranscription('job-1', 1)).resolves.toEqual({
      discarded: false,
      status: 'READY',
    });

    expect(prepaid.run).toHaveBeenCalledWith(
      'org-1',
      'job-1',
      1,
      false,
      expect.any(Function)
    );
    expect(model.transcribeVideo).toHaveBeenCalledTimes(1);
  });

  it('lets existing accounting win after a plan changes to legacy', async () => {
    const prepaid = { run: jest.fn(async () => ({ state: 'SETTLED' })) };
    const { service, model } = lifecycleHarness('STANDARD', prepaid);

    await expect(service.processTranscription('job-1', 1)).resolves.toEqual({
      discarded: false,
      status: 'READY',
    });

    expect(prepaid.run).toHaveBeenCalledWith(
      'org-1',
      'job-1',
      1,
      false,
      expect.any(Function)
    );
    expect(model.transcribeVideo).not.toHaveBeenCalled();
  });

  it('fails LAUNCH and non-AI plans closed before any provider call', async () => {
    const launch = lifecycleHarness('LAUNCH_V1');
    await expect(
      launch.service.processTranscription('job-launch', 1)
    ).rejects.toThrow('adapter is unavailable');
    expect(launch.model.transcribeVideo).not.toHaveBeenCalled();

    const free = lifecycleHarness(null);
    await expect(
      free.service.processTranscription('job-free', 1)
    ).rejects.toThrow('not included in this plan');
    expect(free.model.transcribeVideo).not.toHaveBeenCalled();
  });

  it('preserves billing-disabled legacy transcription for FREE and no subscription', async () => {
    process.env.BILLING_ENABLED = 'false';
    for (const tier of ['FREE', null]) {
      const { service, model } = lifecycleHarness(tier);
      await expect(service.processTranscription(`job-${tier || 'none'}`, 1)).resolves.toMatchObject({ status: 'READY' });
      expect(model.transcribeVideo).toHaveBeenCalledTimes(1);
    }
  });

  it('resumes a verified held reservation despite plan and flag changes', async () => {
    process.env.AI_WALLET_ENABLED = 'false';
    process.env.AI_WALLET_TRANSCRIPTION_ENABLED = 'false';
    process.env.BILLING_ENABLED = 'false';
    const audioSha256 = 'a'.repeat(64);
    const requestFingerprint = snapshotFingerprint({ organizationId: 'org-1', transcriptionId: 'job-1',
      generation: 1, model: PREPAID_TRANSCRIPTION_MODEL, audioSha256 });
    const quoteSnapshot = { policyVersion: PREPAID_AI_POLICY.version, provider: 'openai',
      model: PREPAID_TRANSCRIPTION_MODEL, currency: 'usd', markupPercent: 20,
      requestFingerprint, rateVersion: 'stored-v1', per: '1000000',
      rates: { inputText: '1', inputAudio: '1', outputText: '1' },
      limits: { inputText: '16000', inputAudio: '16000', outputText: '2000' } };
    const reservation = { id: 'reservation-1', state: 'RESERVED', quoteSnapshot };
    const wallet = {
      quotedOperation: jest.fn(async () => reservation),
      reserve: jest.fn(),
      dispatchTranscription: jest.fn(async () => ({ dispatch: false, reservation })),
    };
    const model = { transcribePrepaidAudio: jest.fn() };
    const service = new AiWalletTranscriptionService(wallet as any, model as any);

    await expect(service.run('org-1', 'job-1', 1, false, async () => ({
      file: {} as any, audioSha256, cleanup: jest.fn(),
    } as any))).resolves.toBe(reservation);

    expect(wallet.reserve).not.toHaveBeenCalled();
    expect(wallet.dispatchTranscription).toHaveBeenCalledWith('org-1', 'reservation-1', 'job-1', 1, true);
    expect(model.transcribePrepaidAudio).not.toHaveBeenCalled();
  });

  it('requires an administrator for every subscription mutation', () => {
    const stripe = {
      embedded: jest.fn(() => 'embedded'),
      subscribe: jest.fn(() => 'subscribe'),
      prorate: jest.fn(() => 'prorate'),
    };
    const controller = new BillingController(
      {} as any,
      stripe as any,
      {} as any,
      {} as any,
      {} as any
    );
    const userOrg = { id: 'org-1', allowTrial: true, users: [{ role: 'USER' }] };
    const user = { id: 'user-1' };
    const request = { cookies: { track: 'track-1' } };

    for (const invoke of [
      () => controller.embedded(userOrg as any, user as any, { billing: 'STANDARD', period: 'MONTHLY' } as any, request as any),
      () => controller.subscribe(userOrg as any, user as any, { billing: 'LAUNCH_V1', period: 'MONTHLY' } as any, request as any),
      () => controller.prorate({ ...userOrg, users: [] } as any, { billing: 'TEAM', period: 'MONTHLY' } as any),
    ]) {
      expect(invoke).toThrow('administrator');
    }
    expect(stripe.embedded).not.toHaveBeenCalled();
    expect(stripe.subscribe).not.toHaveBeenCalled();
    expect(stripe.prorate).not.toHaveBeenCalled();

    expect(
      controller.subscribe(
        { ...userOrg, users: [{ role: 'ADMIN' }] } as any,
        user as any,
        { billing: 'STANDARD', period: 'MONTHLY' } as any,
        request as any
      )
    ).toBe('subscribe');
  });
});
