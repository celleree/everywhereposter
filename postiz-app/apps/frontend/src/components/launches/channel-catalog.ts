// Presentation only: preserve endpoint metadata and the existing connection dispatch.
const connectionLabels = [
  ['x', 'X'], ['linkedin', 'LinkedIn'], ['linkedin-page', 'LinkedIn Page'],
  ['instagram', 'Instagram Business'], ['instagram-standalone', 'Instagram Professional'],
  ['facebook', 'Facebook Page'], ['threads', 'Threads'], ['youtube', 'YouTube'],
  ['tiktok', 'TikTok'], ['pinterest', 'Pinterest'],
] as const;

export function availableChannels<T extends { identifier: string; name: string }>(social: T[]) {
  return connectionLabels.flatMap(([identifier, name]) => {
    const provider = social.find(item => item.identifier === identifier);
    return provider ? [{ ...provider, name }] : [];
  });
}

export const initialUpcomingChannels = ['Reddit', 'Discord', 'Twitch'];
export const additionalUpcomingChannels = [
  'Slack', 'Kick', 'Bluesky', 'Mastodon', 'Telegram', 'WordPress',
];
