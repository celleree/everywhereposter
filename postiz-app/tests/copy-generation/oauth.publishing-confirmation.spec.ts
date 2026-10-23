import { createPublishingConfirmation, readPublishingConfirmation } from '../../libraries/nestjs-libraries/src/chat/oauth-publishing-confirmation';
const principal = { organizationId: 'org', grantId: 'grant' };
const preview = { content: 'Example', destinations: ['one', 'two'] };
describe('stateless publishing confirmation integrity', () => {
  beforeEach(() => { process.env.JWT_SECRET = 'preview-test-secret'; });
  it('binds the full preview and principal without embedding content or provider credentials', () => {
    const token = createPublishingConfirmation(principal, preview, { providerAccount: 'private-account' });
    expect(readPublishingConfirmation(token, principal, preview)).toMatchObject(principal);
    expect(Buffer.from(token.split('.')[0], 'base64url').toString()).not.toMatch(/Example|private-account/);
    expect(() => readPublishingConfirmation(token, { ...principal, organizationId: 'other' }, preview)).toThrow();
    expect(() => readPublishingConfirmation(token, { ...principal, grantId: 'other' }, preview)).toThrow();
    expect(() => readPublishingConfirmation(token, principal, { ...preview, content: 'Changed' })).toThrow();
  });
  it('rejects tampering, malformed tokens, wrong keys, and legacy confirmation UUIDs', () => {
    const token = createPublishingConfirmation(principal, preview, {});
    const [payload, signature] = token.split('.');
    const changed = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url').toString()), expiresAt: Date.now() + 86400000 })).toString('base64url');
    for (const invalid of ['x'.repeat(1025), 'a.b', token + '.extra', `${changed}.${signature}`, 'a1a03eab-c509-4bde-bb44-ad78b8cbb084']) {
      expect(() => readPublishingConfirmation(invalid, principal, preview)).toThrow('expired or changed');
    }
    process.env.JWT_SECRET = 'rotated-key';
    expect(() => readPublishingConfirmation(token, principal, preview)).toThrow();
    delete process.env.JWT_SECRET;
    expect(() => createPublishingConfirmation(principal, preview, {})).toThrow('unavailable');
  });
});
