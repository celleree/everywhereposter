import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import useSWR from 'swr';
import { StatisticsModal } from '@gitroom/frontend/components/launches/statistics';

jest.mock('swr', () => ({
  __esModule: true,
  default: jest.fn((key: string) => {
    if (key.startsWith('/posts/')) {
      return { data: { clicks: [] }, isLoading: false };
    }

    if (key.endsWith('/comments')) {
      return { data: { supported: false, comments: [] }, isLoading: false };
    }

    return { data: [], isLoading: false, mutate: jest.fn() };
  }),
}));

jest.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () => jest.fn(),
}));

jest.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}));

jest.mock('@gitroom/frontend/components/analytics/chart-social', () => ({
  ChartSocial: () => {
    const React = require('react');
    return React.createElement('div');
  },
}));

jest.mock('@gitroom/react/form/select', () => ({
  Select: ({ children, value, onChange }: any) => {
    const React = require('react');
    return React.createElement('select', { value, onChange }, children);
  },
}));

jest.mock('@gitroom/frontend/components/layout/loading', () => ({
  LoadingComponent: () => {
    const React = require('react');
    return React.createElement('div', null, 'Loading');
  },
}));

jest.mock('@gitroom/frontend/components/launches/missing-release.modal', () => ({
  MissingReleaseModal: () => {
    const React = require('react');
    return React.createElement('div', null, 'Missing release');
  },
}));

describe('StatisticsModal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders the shared post statistics panel path', () => {
    const html = renderToStaticMarkup(
      React.createElement(StatisticsModal, { postId: 'root-post-id' })
    );

    expect(useSWR).toHaveBeenCalledWith(
      '/posts/root-post-id/statistics',
      expect.any(Function)
    );
    expect(html).toContain('Post Analytics');
  });
});
