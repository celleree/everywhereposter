import { createHash } from 'crypto';

// Observational only: failure must never change subscription or webhook outcomes.
export async function captureBillingConversion(
  event: 'trial_started' | 'subscription_payment_completed',
  userId: string | undefined,
  resourceId: string,
  created: number,
) {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  const host = process.env.NEXT_PUBLIC_POSTHOG_HOST;
  if (process.env.NODE_ENV !== 'production' || !key || !host || !userId) return;
  try {
    const endpoint = new URL('/i/v0/e/', host);
    if (endpoint.protocol !== 'https:') return;
    // Stable UUID + timestamp + identity make webhook redelivery idempotent in PostHog.
    const hash = createHash('sha256').update(`${event}:${resourceId}`).digest('hex');
    const uuid = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(2000),
      body: JSON.stringify({
        api_key: key,
        event,
        distinct_id: userId,
        uuid,
        timestamp: new Date(created * 1000).toISOString(),
        properties: { source: 'stripe_webhook', $process_person_profile: true },
      }),
    });
    if (!response.ok) console.warn('PostHog billing conversion was not accepted');
  } catch {
    console.warn('PostHog billing conversion could not be sent');
  }
}
