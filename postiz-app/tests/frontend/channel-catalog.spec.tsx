import { availableChannels } from '../../apps/frontend/src/components/launches/channel-catalog';

it('renders only explicitly available providers, preserving names and dispatch metadata', () => {
  const configured = { identifier: 'instagram-standalone', name: 'Instagram\n(Standalone)',
    connectionAvailable: true, isExternal: false, customFields: [] };
  const catalog = [configured,
    { identifier: 'x', name: 'X', connectionAvailable: false },
    { identifier: 'facebook', name: 'Facebook' },
    { identifier: 'unverified', name: 'Unverified', connectionAvailable: undefined },
  ];
  expect(availableChannels(catalog)).toEqual([configured]);
  expect(availableChannels(catalog)[0]).toBe(configured);
  expect(availableChannels([])).toEqual([]);
  expect(catalog).toHaveLength(4);
});

it('requires boolean true rather than truthy legacy metadata', () => {
  expect(availableChannels([{ connectionAvailable: 'false' as any }])).toEqual([]);
});
