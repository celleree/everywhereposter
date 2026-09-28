import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import {
  consolidateMobileAllPosts,
  MobilePostList,
} from '@gitroom/frontend/components/launches/mobile-posts';

jest.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}));
jest.mock('@gitroom/helpers/utils/strip.html.validation', () => ({
  stripHtmlValidation: (_editor: string, content: string) => content,
}));
jest.mock('@gitroom/frontend/components/launches/calendar.context', () => ({
  isHistoricalCalendarPost: (post: any) =>
    post.readOnly || post.source === 'historical',
}));

const row = (id: string, overrides: Record<string, any> = {}) => ({
  id,
  group: `group-${id}`,
  state: 'QUEUE',
  publishDate: '2026-09-28T18:00:00.000Z',
  content: `${id} content`,
  intervalInDays: null,
  tags: [],
  integration: {
    id: 'account-1',
    name: 'Account',
    providerIdentifier: 'x',
    picture: '',
  },
  ...overrides,
});

const callbacks = () => ({
  onDetails: jest.fn(),
  onEdit: jest.fn(),
  onDelete: jest.fn(),
  retry: jest.fn(),
});

it('keeps draft, error, published and imported records accessible with supported actions', () => {
  const actions = callbacks();
  render(
    <MobilePostList
      {...actions}
      scheduled={false}
      loading={false}
      error={null}
      posts={
        [
          row('draft', { state: 'DRAFT' }),
          row('error', { state: 'ERROR' }),
          row('published', { state: 'PUBLISHED' }),
          row('imported', {
            state: 'PUBLISHED',
            source: 'historical',
            readOnly: true,
          }),
        ] as any
      }
    />
  );
  for (const id of ['draft', 'error', 'published', 'imported']) {
    expect(screen.getByText(`${id} content`)).toBeTruthy();
  }
  expect(
    screen.getAllByRole('button', { name: /Details: Account/ })
  ).toHaveLength(4);
  expect(
    screen.getAllByRole('button', { name: /Edit \/ Reschedule: Account/ })
  ).toHaveLength(3);
  expect(
    screen.getAllByRole('button', { name: /Delete post: Account/ })
  ).toHaveLength(2);
  expect(
    screen.getAllByRole('button', { name: /Delete on platform: Account/ })
  ).toHaveLength(1);
  fireEvent.click(
    within(screen.getByText('imported content').closest('article')!).getByRole(
      'button',
      { name: /Details: Account/ }
    )
  );
  expect(actions.onDetails).toHaveBeenCalledWith(
    expect.objectContaining({ id: 'imported' })
  );
  fireEvent.click(
    within(screen.getByText('draft content').closest('article')!).getByRole(
      'button',
      { name: /Edit \/ Reschedule: Account/ }
    )
  );
  expect(actions.onEdit).toHaveBeenCalledWith(
    expect.objectContaining({ id: 'draft' })
  );
});

it('deduplicates recurring occurrences and shows original date without next-run claims', () => {
  const repeat = row('repeat', {
    intervalInDays: 7,
    actualDate: '2026-01-01T09:00:00.000Z',
  });
  const posts = [
    repeat,
    { ...repeat, publishDate: '2026-09-29T18:00:00.000Z' },
  ];
  expect(consolidateMobileAllPosts(posts as any).recurring).toHaveLength(1);
  render(
    <MobilePostList
      {...callbacks()}
      scheduled={false}
      loading={false}
      error={null}
      posts={posts as any}
    />
  );
  expect(screen.getAllByText('repeat content')).toHaveLength(1);
  expect(screen.getByText(/Original date: Jan 1, 2026/)).toBeTruthy();
  expect(
    screen.queryByText(/next run|next execution|active repeat/i)
  ).toBeNull();
});

it('separates loading, failure/retry, and empty scheduled state', () => {
  const actions = callbacks();
  const { rerender } = render(
    <MobilePostList {...actions} scheduled loading error={null} posts={[]} />
  );
  expect(screen.getByRole('status')).toBeTruthy();
  rerender(
    <MobilePostList
      {...actions}
      scheduled
      loading={false}
      error={new Error('network')}
      posts={[]}
    />
  );
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(actions.retry).toHaveBeenCalledTimes(1);
  rerender(
    <MobilePostList
      {...actions}
      scheduled
      loading={false}
      error={null}
      posts={[]}
    />
  );
  expect(screen.getByText('No one-time scheduled posts yet.')).toBeTruthy();
  expect(
    screen.getByRole('link', { name: 'Create post' }).getAttribute('href')
  ).toBe('/create');
});
