import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { internalFetch } from '@gitroom/helpers/utils/internal.fetch';
import { PostStatisticsPanel } from '@gitroom/frontend/components/launches/statistics';
import PreviewPage from '../../apps/frontend/src/app/(app)/(preview)/p/[id]/page';

jest.mock('@gitroom/helpers/utils/internal.fetch', () => ({
  internalFetch: jest.fn(),
}));

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: any) => {
    const React = require('react');
    return React.createElement('a', { href }, children);
  },
}));

jest.mock('@gitroom/react/helpers/safe.image', () => ({
  __esModule: true,
  default: (props: any) => {
    const React = require('react');
    return React.createElement('img', props);
  },
}));

jest.mock('@gitroom/frontend/components/preview/comments.components', () => ({
  CommentsComponents: ({ postId }: any) => {
    const React = require('react');
    return React.createElement('div', { 'data-post-id': postId });
  },
}));

jest.mock('@gitroom/react/helpers/video.or.image', () => ({
  VideoOrImage: ({ src }: any) => {
    const React = require('react');
    return React.createElement('div', { 'data-src': src });
  },
}));

jest.mock('@gitroom/frontend/components/preview/copy.client', () => ({
  CopyClient: () => {
    const React = require('react');
    return React.createElement('button', null, 'Copy');
  },
}));

jest.mock('@gitroom/react/translation/get.translation.service.backend', () => ({
  getT: jest.fn(async () => (_key: string, fallback: string) => fallback),
}));

jest.mock('@gitroom/frontend/components/preview/render.preview.date.client', () => ({
  RenderPreviewDateClient: ({ date }: any) => {
    const React = require('react');
    return React.createElement('time', null, date);
  },
}));

jest.mock('@gitroom/frontend/components/launches/statistics', () => ({
  PostStatisticsPanel: jest.fn((props: any) => {
    const React = require('react');
    return React.createElement(
      'div',
      { 'data-post-id': props.postId },
      'PostStatisticsPanel'
    );
  }),
}));

const mockInternalFetch = jest.mocked(internalFetch);
const mockPostStatisticsPanel = jest.mocked(PostStatisticsPanel);

const buildPosts = (viewerCanAccessAnalytics: boolean) => [
  {
    id: 'root-post-id',
    state: 'PUBLISHED',
    publishDate: '2026-01-01T00:00:00.000Z',
    content: 'Preview content',
    image: '[]',
    viewerCanAccessAnalytics,
    integration: {
      name: 'EverywherePoster',
      picture: '/avatar.png',
      providerIdentifier: 'x',
      profile: 'publish',
    },
  },
];

const renderPreview = async ({
  share,
  viewerCanAccessAnalytics,
}: {
  share?: string;
  viewerCanAccessAnalytics: boolean;
}) => {
  mockInternalFetch.mockResolvedValue({
    json: async () => buildPosts(viewerCanAccessAnalytics),
  } as any);

  const element = await PreviewPage({
    params: Promise.resolve({ id: 'preview-id' }),
    searchParams: Promise.resolve(share ? { share } : {}),
  });

  return renderToStaticMarkup(element);
};

describe('preview page insights panel permissions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('does not render post statistics for shared previews', async () => {
    const html = await renderPreview({
      share: 'true',
      viewerCanAccessAnalytics: true,
    });

    expect(mockPostStatisticsPanel).not.toHaveBeenCalled();
    expect(html).not.toContain('PostStatisticsPanel');
  });

  it('does not render post statistics when analytics access is denied', async () => {
    const html = await renderPreview({
      viewerCanAccessAnalytics: false,
    });

    expect(mockPostStatisticsPanel).not.toHaveBeenCalled();
    expect(html).not.toContain('PostStatisticsPanel');
  });

  it('renders post statistics for owner or team previews with analytics access', async () => {
    const html = await renderPreview({
      viewerCanAccessAnalytics: true,
    });

    expect(mockPostStatisticsPanel).toHaveBeenCalledTimes(1);
    expect(mockPostStatisticsPanel.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        postId: 'root-post-id',
        isPublished: true,
        hideWhenEmpty: true,
        compact: true,
      })
    );
    expect(html).toContain('PostStatisticsPanel');
  });
});
