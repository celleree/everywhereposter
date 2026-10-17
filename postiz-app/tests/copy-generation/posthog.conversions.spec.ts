import { captureBillingConversion } from '@gitroom/nestjs-libraries/track/posthog.conversions';

const mockFetch = jest.fn();
const originalFetch = global.fetch;
const originalEnv = { ...process.env };
beforeEach(() => {
  process.env.NODE_ENV = 'production';
  process.env.NEXT_PUBLIC_POSTHOG_KEY = 'project-key';
  process.env.NEXT_PUBLIC_POSTHOG_HOST = 'https://ingest.test';
  global.fetch = mockFetch;
  mockFetch.mockResolvedValue({ ok: true });
});
afterAll(() => { process.env = originalEnv; global.fetch = originalFetch; });

it('sends minimal stable conversion identity, timestamp and UUID across redelivery', async () => {
  await captureBillingConversion('trial_started', 'user-1', 'sub-1', 100);
  await captureBillingConversion('trial_started', 'user-1', 'sub-1', 100);
  expect(mockFetch).toHaveBeenCalledTimes(2);
  const first = mockFetch.mock.calls[0];
  expect(first[0].href).toBe('https://ingest.test/i/v0/e/');
  expect(first[1].body).toBe(mockFetch.mock.calls[1][1].body);
  expect(JSON.parse(first[1].body)).toEqual({
    api_key: 'project-key', distinct_id: 'user-1', event: 'trial_started',
    timestamp: '1970-01-01T00:01:40.000Z', uuid: expect.any(String),
    properties: { source: 'stripe_webhook', $process_person_profile: true },
  });
  await captureBillingConversion('subscription_payment_completed', 'user-1', 'invoice-1', 200);
  expect(mockFetch.mock.calls[2][1].body).not.toBe(first[1].body);
});

it('does not send missing configuration, identity or nonproduction events', async () => {
  process.env.NODE_ENV = 'test';
  await captureBillingConversion('trial_started', 'user', 'sub', 100);
  process.env.NODE_ENV = 'production';
  await captureBillingConversion('trial_started', undefined, 'sub', 100);
  process.env.NEXT_PUBLIC_POSTHOG_KEY = '';
  await captureBillingConversion('trial_started', 'user', 'sub', 100);
  expect(mockFetch).not.toHaveBeenCalled();
});

it('absorbs network failures and non-success responses without affecting billing', async () => {
  const warning = jest.spyOn(console, 'warn').mockImplementation(() => {});
  mockFetch.mockRejectedValueOnce(new Error('timeout'));
  await expect(captureBillingConversion('trial_started', 'user', 'sub', 100)).resolves.toBeUndefined();
  mockFetch.mockResolvedValueOnce({ ok: false });
  await expect(captureBillingConversion('trial_started', 'user', 'sub', 100)).resolves.toBeUndefined();
  expect(warning).toHaveBeenCalledTimes(2);
  warning.mockRestore();
});
