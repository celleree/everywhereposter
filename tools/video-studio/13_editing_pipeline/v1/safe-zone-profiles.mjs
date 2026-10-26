// Reference measurements supplied by the official-source research on 2026-10-24.
// Confidence describes the evidence, not a guarantee about every device/UI state.
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
const profile = (id, platform, placement, confidence, size, points, sources, note = '') => ({
  id, version: 1, platform, placement, aspect: '9:16', targetUse: 'organic', confidence,
  checkedAt: '2026-10-24', referenceSize: size, referencePoints: points,
  polygon: points.map(([x, y]) => [x / size[0], y / size[1]]), sources, note,
});
const common = [[120,288],[870,288],[870,840],[780,840],[780,1248],[120,1248]];
const provisional = (platform, placement, sources, note) => profile(
  `${platform}-provisional-v1`, platform, placement, 'provisional', [1080,1920], common,
  sources, `Product-selected fallback derived from LinkedIn/TikTok/YouTube masks; not verified organic geometry. ${note}`,
);
export const SAFE_ZONE_PROFILES = freeze([
  profile('linkedin-organic-v1', 'linkedin', 'vertical-video', 'official', [1080,1920],
    [[112,260],[870,260],[870,1360],[112,1360]],
    ['https://www.linkedin.com/help/linkedin/answer/a551346']),
  profile('pinterest-organic-v1', 'pinterest', 'full-bleed-video', 'official', [1080,1920],
    [[65,270],[885,270],[885,1130],[65,1130]],
    ['https://help.pinterest.com/en/article/review-pin-specs'], 'Portrait only; other ratios need their own profiles.'),
  profile('tiktok-ad-derived-v1', 'tiktok', 'vertical-video', 'ad-derived', [720,1280],
    [[80,160],[640,160],[640,560],[520,560],[520,840],[80,840]],
    ['https://ads.tiktok.com/resources/help/article/tiktok-auction-in-feed-ads?lang=en',
      'https://lf-tt4b.tiktokcdn.com/obj/i18nblog/tt4b_cms/en-US/5jqet0ab9qci-10e7f5Vig4uhAscNP8XPB0.zip'],
    'Standard LTR ad template, not an organic guarantee. Caption/anchor/RTL/device variants are not modeled.'),
  profile('youtube-ad-derived-v1', 'youtube', 'shorts', 'ad-derived', [1080,1920],
    [[48,288],[888,288],[888,1248],[48,1248]],
    ['https://services.google.com/fh/files/misc/universalsafezones-youtube.pdf',
      'https://support.google.com/youtube/answer/16215842'], 'Organic Shorts uses dynamic UI guides; this mask is ad-derived.'),
  provisional('instagram', 'reels', ['https://www.facebook.com/business/ads/facebook-instagram-reels-ads'], 'Exact current organic margins unverified.'),
  provisional('facebook', 'reels', ['https://www.facebook.com/business/ads/facebook-instagram-reels-ads'], 'Separate Facebook profile; exact current organic margins unverified.'),
  provisional('threads', 'vertical-video', [], 'Exact official geometry not established; blocked research paths were not retried.'),
  provisional('x', 'vertical-video', ['https://business.x.com/en/products/vertical-video-ads'], 'Ad diagram canvas reference unclear; its pixel labels were not converted.'),
  provisional('reddit', 'vertical-video', ['https://support.reddithelp.com/hc/en-us/articles/360060422572-How-do-I-post-and-comment-on-Reddit'], 'Posting help supplies no exact organic mask.'),
  provisional('dribbble', 'video-shot', ['https://help.dribbble.com/en/articles/11062601-creating-dribbble-shots', 'https://dribbble.com/guidelines'],
    'Recommended video width is at least 1600; no required ratio/height. Thumbnail crop and design-work eligibility are separate. Promotional videos/commercials/tutorials are not eligible merely because this profile exists.'),
]);
export const ALL_ADVERTISED_PRESET = 'all-advertised-provisional-v1';
export function selectProfiles(config) {
  const known = new Map(SAFE_ZONE_PROFILES.map(p => [p.id, p]));
  let ids;
  if (config.preset !== undefined) {
    if (config.preset !== ALL_ADVERTISED_PRESET || config.profiles !== undefined) throw Error('Choose explicit profiles OR the named provisional all-advertised preset');
    ids = [...known.keys()];
  } else {
    ids = config.profiles;
    if (!Array.isArray(ids) || !ids.length || ids.length > known.size || new Set(ids).size !== ids.length) throw Error('Safe-zone destination profiles must be explicit and unique');
  }
  if (ids.some(id => typeof id !== 'string' || !known.has(id))) throw Error('Unknown or unversioned safe-zone profile; destination was not ignored');
  return [...ids].sort().map(id => known.get(id));
}
