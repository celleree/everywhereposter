import { createHash, createHmac, randomUUID, timingSafeEqual } from 'crypto';
import { z } from 'zod';

const confirmation = z.object({
  id: z.string().uuid(), grantId: z.string(), organizationId: z.string(),
  expiresAt: z.number().int().positive(),
  previewHash: z.string().regex(/^[a-f0-9]{64}$/),
  destinationsHash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export const previewHash = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
const signature = (payload: string) => {
  if (!process.env.JWT_SECRET) throw new Error('Publishing preview signing is unavailable');
  // Domain separation prevents interchange with login tokens using the same
  // existing server secret. Key rotation invalidates outstanding previews.
  return createHmac('sha256', process.env.JWT_SECRET)
    .update(`oauth-publishing-preview:v1:${payload}`).digest();
};
export function createPublishingConfirmation(
  principal: { grantId: string; organizationId: string }, preview: unknown, destinations: unknown
) {
  const payload = Buffer.from(JSON.stringify({ ...principal, id: randomUUID(),
    expiresAt: Date.now() + 900_000, previewHash: previewHash(preview),
    destinationsHash: previewHash(destinations),
  })).toString('base64url');
  return `${payload}.${signature(payload).toString('base64url')}`;
}
export function readPublishingConfirmation(
  token: string, principal: { grantId: string; organizationId: string }, preview: unknown
) {
  try {
    if (token.length > 1024 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(token)) throw new Error();
    const [payload, supplied] = token.split('.');
    if (!timingSafeEqual(signature(payload), Buffer.from(supplied, 'base64url'))) throw new Error();
    const value = confirmation.parse(JSON.parse(Buffer.from(payload, 'base64url').toString()));
    if (value.grantId !== principal.grantId || value.organizationId !== principal.organizationId ||
        value.previewHash !== previewHash(preview)) throw new Error();
    return value;
  } catch {
    throw new Error('Preview expired or changed; prepare and confirm the complete batch again');
  }
}
