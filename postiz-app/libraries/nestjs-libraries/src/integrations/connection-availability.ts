// Deployment-approved connection candidates. Registration alone does not enable a provider.
// This checks local prerequisites only; it does not assert external app approval.
const connectionRequirements: Record<string, readonly string[]> = {
  x: ['X_API_KEY', 'X_API_SECRET'],
  linkedin: ['LINKEDIN_CLIENT_ID', 'LINKEDIN_CLIENT_SECRET'],
  'linkedin-page': ['LINKEDIN_PAGE_CLIENT_ID', 'LINKEDIN_PAGE_CLIENT_SECRET'],
  instagram: ['FACEBOOK_APP_ID', 'FACEBOOK_APP_SECRET'],
  'instagram-standalone': ['INSTAGRAM_APP_ID', 'INSTAGRAM_APP_SECRET'],
  facebook: ['FACEBOOK_APP_ID', 'FACEBOOK_APP_SECRET'],
  threads: ['THREADS_APP_ID', 'THREADS_APP_SECRET'],
  youtube: ['YOUTUBE_CLIENT_ID', 'YOUTUBE_CLIENT_SECRET'],
  tiktok: ['TIKTOK_CLIENT_ID', 'TIKTOK_CLIENT_SECRET'],
  pinterest: ['PINTEREST_CLIENT_ID', 'PINTEREST_CLIENT_SECRET'],
};

export function connectionAvailable(
  identifier: string,
  env: Record<string, string | undefined> = process.env
): boolean {
  if (!Object.prototype.hasOwnProperty.call(connectionRequirements, identifier)) return false;
  return connectionRequirements[identifier].every(key => {
    // Match LinkedinPageProvider's existing per-field credential fallback.
    const value = key.startsWith('LINKEDIN_PAGE_')
      ? env[key] || env[key.replace('LINKEDIN_PAGE_', 'LINKEDIN_')]
      : env[key];
    return !!value?.trim();
  });
}
