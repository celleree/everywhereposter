import React from 'react';
import { render, screen } from '@testing-library/react';
import { PlatformVideoGrid } from '../../apps/frontend/src/components/platform-analytics/platform.video.grid';
const mockItems = [
  { id: 'photo', name: 'Cover photo', type: 'image', thumbnail: '/photo.jpg', url: 'https://example.test/photo' },
  { id: 'text', name: 'Text update', type: 'text', url: 'https://example.test/update' },
  { id: 'reel', name: 'A reel', type: 'video', thumbnail: '/reel.jpg', url: 'https://example.test/reel' },
];
jest.mock('swr', () => ({ __esModule: true, default: () => ({ data: { results: mockItems, pages: 1 }, isLoading: false }) }));
jest.mock('@gitroom/helpers/utils/custom.fetch', () => ({ useFetch: () => jest.fn() }));
jest.mock('@gitroom/react/translation/get.transation.service.client', () => ({ useT: () => (_key: string, fallback: string) => fallback }));
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('@gitroom/frontend/components/media/media.component', () => ({ Pagination: () => null }));
it('describes mixed published media honestly and marks only videos with a play overlay', () => {
  render(<PlatformVideoGrid integration={{ id: 'fb', identifier: 'facebook', name: 'Page', canListMedia: true }} />);
  expect(screen.getByRole('heading', { name: 'Recent Posts' })).toBeTruthy();
  expect(screen.getByAltText('Cover photo')).toBeTruthy();
  const overlays = screen.getAllByLabelText('Video');
  expect(overlays).toHaveLength(1);
  expect(overlays[0].parentElement?.querySelector('img')?.getAttribute('alt')).toBe('A reel');
  expect(screen.getAllByRole('link', { name: 'Open on platform' })).toHaveLength(3);
});
