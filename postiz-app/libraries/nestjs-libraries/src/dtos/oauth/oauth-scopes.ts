export const ACCOUNTS_READ_SCOPE = 'accounts:read';
export const POSTS_WRITE_SCOPE = 'posts:write';
export const ANALYTICS_READ_SCOPE = 'analytics:read';
export const OAUTH_SCOPES = [ACCOUNTS_READ_SCOPE, POSTS_WRITE_SCOPE, ANALYTICS_READ_SCOPE];
export const parseOAuthScopes = (scope: unknown): string[] => {
  if (typeof scope !== 'string') return [];
  const scopes = scope.split(' ');
  return scopes.length > 0 && scopes.every((value) => OAUTH_SCOPES.includes(value)) &&
    new Set(scopes).size === scopes.length ? scopes : [];
};
