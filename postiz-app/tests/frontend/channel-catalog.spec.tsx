import {
  availableChannels, initialUpcomingChannels, additionalUpcomingChannels,
} from '../../apps/frontend/src/components/launches/channel-catalog';

it('only shows requested identifiers advertised by the current endpoint and preserves dispatch metadata', () => {
  const providers = [
    { identifier: 'instagram-standalone', name: 'Old standalone label', isExternal: false, customFields: [] },
    { identifier: 'x', name: 'X', isExternal: false, customFields: undefined },
    { identifier: 'reddit', name: 'Reddit', isExternal: false },
    { identifier: 'unknown', name: 'Unsupported platform', isExternal: false },
  ];
  expect(availableChannels(providers)).toEqual([
    providers[1], { ...providers[0], name: 'Instagram Professional' },
  ]);
  expect(availableChannels([])).toEqual([]);
});

it('orders and labels the ten supported connection choices without duplicates', () => {
  const identifiers = ['x', 'linkedin', 'linkedin-page', 'instagram', 'instagram-standalone', 'facebook', 'threads', 'youtube', 'tiktok', 'pinterest'];
  const result = availableChannels(identifiers.flatMap(identifier => [
    { identifier, name: 'Original' }, { identifier, name: 'Duplicate' },
  ]).reverse());
  expect(result.map(item => item.identifier)).toEqual(identifiers);
  expect(result.map(item => item.name)).toEqual([
    'X', 'LinkedIn', 'LinkedIn Page', 'Instagram Business', 'Instagram Professional',
    'Facebook Page', 'Threads', 'YouTube', 'TikTok', 'Pinterest',
  ]);
});

it('keeps upcoming entries separate from connectable providers', () => {
  const upcoming = [...initialUpcomingChannels, ...additionalUpcomingChannels];
  expect(initialUpcomingChannels).toEqual(['Reddit', 'Discord', 'Twitch']);
  expect(new Set(upcoming).size).toBe(upcoming.length);
  expect(availableChannels(upcoming.map(name => ({ identifier: name.toLowerCase(), name })))).toEqual([]);
});
