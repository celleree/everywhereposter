import { connectionAvailable } from '../../libraries/nestjs-libraries/src/integrations/connection-availability';

const requirements = [
  ['x', 'X_API_KEY', 'X_API_SECRET'],
  ['linkedin', 'LINKEDIN_CLIENT_ID', 'LINKEDIN_CLIENT_SECRET'],
  ['linkedin-page', 'LINKEDIN_PAGE_CLIENT_ID', 'LINKEDIN_PAGE_CLIENT_SECRET'],
  ['instagram', 'FACEBOOK_APP_ID', 'FACEBOOK_APP_SECRET'],
  ['instagram-standalone', 'INSTAGRAM_APP_ID', 'INSTAGRAM_APP_SECRET'],
  ['facebook', 'FACEBOOK_APP_ID', 'FACEBOOK_APP_SECRET'],
  ['threads', 'THREADS_APP_ID', 'THREADS_APP_SECRET'],
  ['youtube', 'YOUTUBE_CLIENT_ID', 'YOUTUBE_CLIENT_SECRET'],
  ['tiktok', 'TIKTOK_CLIENT_ID', 'TIKTOK_CLIENT_SECRET'],
  ['pinterest', 'PINTEREST_CLIENT_ID', 'PINTEREST_CLIENT_SECRET'],
];

test.each(requirements)('%s needs both configured credential fields', (identifier, id, secret) => {
  expect(connectionAvailable(identifier, {})).toBe(false);
  expect(connectionAvailable(identifier, { [id]: 'synthetic' })).toBe(false);
  expect(connectionAvailable(identifier, { [secret]: 'synthetic' })).toBe(false);
  expect(connectionAvailable(identifier, { [id]: 'synthetic', [secret]: '  ' })).toBe(false);
  expect(connectionAvailable(identifier, { [id]: 'synthetic', [secret]: 'synthetic' })).toBe(true);
});

test('LinkedIn Page follows the existing independent credential fallbacks', () => {
  const env = { LINKEDIN_CLIENT_ID: 'synthetic-id', LINKEDIN_CLIENT_SECRET: 'synthetic-secret' };
  expect(connectionAvailable('linkedin-page', env)).toBe(true);
  expect(connectionAvailable('linkedin-page', { ...env, LINKEDIN_PAGE_CLIENT_ID: 'page-id' })).toBe(true);
  expect(connectionAvailable('linkedin-page', { LINKEDIN_CLIENT_ID: 'id', LINKEDIN_PAGE_CLIENT_SECRET: 'page-secret' })).toBe(true);
  expect(connectionAvailable('linkedin-page', { LINKEDIN_PAGE_CLIENT_ID: 'page-id' })).toBe(false);
});

test('Meta login variants require their own credential groups', () => {
  const facebook = { FACEBOOK_APP_ID: 'synthetic', FACEBOOK_APP_SECRET: 'synthetic' };
  const instagram = { INSTAGRAM_APP_ID: 'synthetic', INSTAGRAM_APP_SECRET: 'synthetic' };
  expect(connectionAvailable('facebook', facebook)).toBe(true);
  expect(connectionAvailable('instagram', facebook)).toBe(true);
  expect(connectionAvailable('instagram-standalone', facebook)).toBe(false);
  expect(connectionAvailable('instagram-standalone', instagram)).toBe(true);
  expect(connectionAvailable('instagram', instagram)).toBe(false);
});

test('unapproved, unknown and inherited identifiers fail closed even with configuration', () => {
  const env = Object.fromEntries(requirements.flatMap(([, id, secret]) => [[id, 'synthetic'], [secret, 'synthetic']]));
  for (const identifier of ['reddit', 'bluesky', 'wordpress', 'skool', 'telegram', 'gmb', 'unknown', '__proto__', 'constructor']) {
    expect(connectionAvailable(identifier, env)).toBe(false);
  }
});
