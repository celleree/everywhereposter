// Existing composer/account-selector read helpers only. Provider implementation
// methods are not an API: adding a public/private method cannot expose it here.
const exposed = new Set([
  'listMedia',
  'mention',
  'company',
  'companies',
  'pages',
  'groups',
  'label',
  'channels',
  'boards',
  'creatorInfo',
  'organizations',
  'tags',
  'publications',
  'teams',
  'postTypes',
  'list',
  'templates',
  'experiences',
  'restrictions',
  'subreddits',
]);
export const isExposedProviderFunction = (name: string) => exposed.has(name);
