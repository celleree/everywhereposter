import { render, screen } from '@testing-library/react';
import { FacebookPublishedManagement } from '../../apps/frontend/src/components/new-launch/facebook.published.management';

const mockFetch = jest.fn();
jest.mock('@gitroom/helpers/utils/custom.fetch', () => ({ useFetch: () => mockFetch }));

it('offers a manual Facebook link without enabling mutations on an older copy', async () => {
  const permalink = 'https://www.facebook.com/123_456';
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => ({
      eligible: false,
      pageName: 'California Home Services',
      reason: 'Open the exact post on its Facebook Page and use the post menu.',
      permalink,
    }),
  });
  render(<FacebookPublishedManagement postId="older-post" deleteOnly />);
  await screen.findByRole('heading', { name: 'California Home Services' });
  expect(screen.getByRole('link', { name: 'Open this post on Facebook' }).getAttribute('href')).toBe(permalink);
  expect(screen.queryByRole('button')).toBeNull();
  expect(mockFetch).toHaveBeenCalledTimes(1);
  expect(mockFetch).toHaveBeenCalledWith('/posts/older-post/facebook-published', { method: 'GET' });
});
