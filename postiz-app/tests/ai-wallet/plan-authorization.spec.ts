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
  prepareVideoMediaFile: jest.fn(async () => ({ inputPath: '/tmp/offline.mp4', cleanup: jest.fn() })),
}));

const enabledEnv = {
  BILLING_ENABLED: 'true', AI_WALLET_ENABLED: 'true', AI_WALLET_TRANSCRIPTION_ENABLED: 'true',
  STRIPE_SECRET_KEY: 'sk_test_synthetic_not_a_credential', FRONTEND_URL: 'http://localhost:4200',
  AI_WALLET_TEST_OFFERS: '[{"id":"synthetic","amountCents":500}]',
};
const originalEnv = Object.fromEntries(Object.keys(enabledEnv).map(key => [key, process.env[key]]));
const checkoutRequest = ['org-1', 'synthetic', 'request-1'] as const;

describe('per-plan prepaid AI authorization', () => {
  beforeEach(() => { Object.assign(process.env, enabledEnv); jest.clearAllMocks(); });
  afterAll(() => Object.entries(originalEnv).forEach(([key, value]) => {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }));

  const checkoutHarness = (tiers: Array<string | null>) => {
    const findFirst = jest.fn();
    tiers.forEach(tier => findFirst.mockResolvedValueOnce(tier ? { subscriptionTier: tier } : null));
    const db = { subscription: { findFirst }, organization: { findUnique: jest.fn(async () => ({ paymentId: 'cus_synthetic' })) } };
    const wallet = { createTopup: jest.fn(async () => ({ id: 'topup-1', customerId: 'cus_synthetic',
      amountCents: 500, sessionId: null, fundedAt: null })), bindTopupSession: jest.fn() };
    const create = jest.fn(async (params: any) => ({ id: 'cs_test_synthetic', livemode: false, mode: params.mode,
      customer: params.customer, client_reference_id: params.client_reference_id, metadata: params.metadata,
      currency: 'usd', amount_total: 500, payment_status: 'unpaid', status: 'open',
      url: 'https://checkout.stripe.com/c/pay/synthetic' }));
    const sdk = { checkout: { sessions: { create, retrieve: jest.fn() } } };
    const service = new AiWalletCheckoutService(db as any, wallet as any);
    jest.spyOn(service as any, 'client').mockReturnValue(sdk);
    return { service, wallet, create, findFirst };
  };

  it.each([
    ['rejects wallet reads and purchases for a fresh non-prepaid plan', ['STANDARD', 'STANDARD'], 'offers', false, 0],
    ['rechecks the launch plan immediately before Stripe Checkout', ['LAUNCH_V1', 'LAUNCH_V1'], 'success', true, 1],
    ['stops before Stripe when the plan changes after intent creation', ['LAUNCH_V1', 'STANDARD'], 'changed', false, 1],
  ] as const)('%s', async (_name, tiers, outcome, stripeCalled, topupCalls) => {
    const { service, wallet, create, findFirst } = checkoutHarness([...tiers]);
    if (outcome === 'offers') {
      await expect(service.offers('org-1')).rejects.toThrow('not included in this plan');
      await expect(service.createCheckout(...checkoutRequest)).rejects.toThrow('not included in this plan');
    } else if (outcome === 'success') {
      await expect(service.createCheckout(...checkoutRequest)).resolves.toMatchObject({ topupId: 'topup-1', status: 'open' });
    } else {
      await expect(service.createCheckout(...checkoutRequest)).rejects.toThrow('not included in this plan');
    }
    expect(findFirst).toHaveBeenCalledTimes(2);
    expect(wallet.createTopup).toHaveBeenCalledTimes(topupCalls);
    stripeCalled ? expect(create).toHaveBeenCalledTimes(1) : expect(create).not.toHaveBeenCalled();
  });

  const lifecycleHarness = (tier: string | null, prepaid?: { run: jest.Mock }) => {
    const repository = { claimForProcessing: jest.fn(async () => true), completeIfActive: jest.fn(async () => true),
      getActiveWorkerInput: jest.fn(async () => ({ media: { organizationId: 'org-1', path: '/offline/input.mp4',
        name: 'input.mp4', originalName: 'input.mp4',
        organization: { subscription: tier ? { subscriptionTier: tier } : null } } })) };
    const model = { preparePrepaidTranscription: jest.fn(),
      transcribeVideo: jest.fn(async () => ({ text: 'legacy transcript' })) };
    return { service: new MediaTranscriptionService(repository as any, {} as any, model as any, prepaid as any), model };
  };

  it.each([
    ['uses prepaid for LAUNCH and never reaches the legacy model', 'LAUNCH_V1', 'UNKNOWN', true, 'PROCESSING', 0],
    ['keeps legacy bundled transcription unmetered without opening a wallet reservation', 'STANDARD', undefined, false, 'READY', 1],
    ['lets existing accounting win after a plan changes to legacy', 'STANDARD', 'SETTLED', false, 'READY', 0],
  ] as const)('%s', async (_name, tier, accountingState, allowNew, status, legacyCalls) => {
    const prepaid = { run: jest.fn(async () => accountingState ? { state: accountingState } : undefined) };
    const { service, model } = lifecycleHarness(tier, prepaid);
    await expect(service.processTranscription('job-1', 1)).resolves.toEqual({ discarded: false, status });
    expect(prepaid.run).toHaveBeenCalledWith('org-1', 'job-1', 1, allowNew, expect.any(Function));
    expect(model.transcribeVideo).toHaveBeenCalledTimes(legacyCalls);
  });

  it('fails LAUNCH and non-AI plans closed before any provider call', async () => {
    const launch = lifecycleHarness('LAUNCH_V1');
    await expect(launch.service.processTranscription('job-launch', 1)).rejects.toThrow('adapter is unavailable');
    expect(launch.model.transcribeVideo).not.toHaveBeenCalled();
    const free = lifecycleHarness(null);
    await expect(free.service.processTranscription('job-free', 1)).rejects.toThrow('not included in this plan');
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

  it('denies a held reservation after revocation without falling through to legacy execution', async () => {
    process.env.AI_WALLET_ENABLED = process.env.AI_WALLET_TRANSCRIPTION_ENABLED = process.env.BILLING_ENABLED = 'false';
    const audioSha256 = 'a'.repeat(64);
    const requestFingerprint = snapshotFingerprint({ organizationId: 'org-1', transcriptionId: 'job-1', generation: 1,
      model: PREPAID_TRANSCRIPTION_MODEL, audioSha256 });
    const reservation = { id: 'reservation-1', state: 'RESERVED', quoteSnapshot: {
      policyVersion: PREPAID_AI_POLICY.version, provider: 'openai', model: PREPAID_TRANSCRIPTION_MODEL,
      currency: 'usd', markupPercent: 20, requestFingerprint, rateVersion: 'stored-v1', per: '1000000',
      rates: { inputText: '1', inputAudio: '1', outputText: '1' },
      limits: { inputText: '16000', inputAudio: '16000', outputText: '2000' },
    } };
    const wallet = { quotedOperation: jest.fn(async () => reservation), reserve: jest.fn(),
      dispatchTranscription: jest.fn(async () => ({ dispatch: false, reservation })) };
    const model = { transcribePrepaidAudio: jest.fn() };
    const service = new AiWalletTranscriptionService(wallet as any, model as any);
    await expect(service.run('org-1', 'job-1', 1, false, async () => ({ file: {} as any, audioSha256 } as any)))
      .rejects.toThrow('disabled');
    expect(wallet.reserve).not.toHaveBeenCalled();
    expect(wallet.dispatchTranscription).not.toHaveBeenCalled();
    const lifecycle = lifecycleHarness('STANDARD', { run: jest.fn((org, job, generation, allow, prepare) =>
      service.run(org, job, generation, allow, prepare)) });
    await expect(lifecycle.service.processTranscription('job-1', 1)).rejects.toThrow('disabled');
    expect(lifecycle.model.transcribeVideo).not.toHaveBeenCalled();
    expect(model.transcribePrepaidAudio).not.toHaveBeenCalled();
  });

  it('requires an administrator for every subscription mutation', () => {
    const stripe = { embedded: jest.fn(() => 'embedded'), subscribe: jest.fn(() => 'subscribe'),
      prorate: jest.fn(() => 'prorate') };
    const controller = new BillingController({} as any, stripe as any, {} as any, {} as any, {} as any);
    const userOrg = { id: 'org-1', allowTrial: true, users: [{ role: 'USER' }] };
    const user = { id: 'user-1' }, body = { billing: 'STANDARD', period: 'MONTHLY' } as any;
    const request = { cookies: { track: 'track-1' } };
    const attempts = [
      () => controller.embedded(userOrg as any, user as any, body, request as any),
      () => controller.subscribe(userOrg as any, user as any, { ...body, billing: 'LAUNCH_V1' }, request as any),
      () => controller.prorate({ ...userOrg, users: [] } as any, { ...body, billing: 'TEAM' }),
    ];
    attempts.forEach(invoke => expect(invoke).toThrow('administrator'));
    expect(stripe.embedded).not.toHaveBeenCalled();
    expect(stripe.subscribe).not.toHaveBeenCalled();
    expect(stripe.prorate).not.toHaveBeenCalled();
    expect(controller.subscribe({ ...userOrg, users: [{ role: 'ADMIN' }] } as any,
      user as any, body, request as any)).toBe('subscribe');
  });
});
