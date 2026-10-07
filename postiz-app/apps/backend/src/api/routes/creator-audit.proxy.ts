import { createHash, createHmac } from 'crypto';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function creatorAuditConfig() {
  const secret = process.env.CREATOR_AUDIT_SERVICE_SECRET || '';
  if (process.env.CREATOR_AUDIT_ENABLED !== 'true' || Buffer.byteLength(secret) < 32 || secret === process.env.JWT_SECRET) return null;
  try {
    const url = new URL(process.env.CREATOR_AUDIT_SERVICE_URL || '');
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') return null;
    return { origin: url.origin, secret };
  } catch { return null; }
}

export function auditRouteAllowed(method: string, path: string) {
  if (method === 'GET') return ['/audit', '/static/audit-results.js', '/api/audit/config', '/api/audit/tasks/current', '/api/me'].includes(path) ||
    /^\/api\/audit\/tasks\/[a-f0-9]{32}$/.test(path) || /^\/api\/me\/reels\/[A-Za-z0-9_-]{1,100}\/results$/.test(path);
  return method === 'POST' && ['/api/audit/tasks', '/api/audit/retry'].includes(path);
}

export function auditAssertion(secret: string, org: string, actor: string, method: string, path: string, body: string, writable: boolean) {
  if (!uuid.test(org) || !uuid.test(actor)) throw new Error('Invalid authenticated identity');
  const iat = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ iss: 'everywhereposter', aud: 'creator-audit', org, sub: actor, iat, exp: iat + 30,
    method, path, writable, body_sha256: createHash('sha256').update(body).digest('hex') })).toString('base64url');
  const signature = createHmac('sha256', secret).update(header + '.' + payload).digest('base64url');
  return header + '.' + payload + '.' + signature;
}
