import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { PlatformAnalytics } from '../../apps/frontend/src/components/platform-analytics/platform.analytics';

const mockChannels = [
  { id: 'ready', name: 'Ready account', identifier: 'facebook', type: 'social', picture: '' },
  { id: 'stale', name: 'Stale account', identifier: 'instagram', type: 'social', picture: '', refreshNeeded: true },
];
jest.mock('swr', () => ({ __esModule: true, default: () => ({ data: mockChannels, isLoading: false }) }));
jest.mock('@gitroom/helpers/utils/custom.fetch', () => ({ useFetch: () => jest.fn() }));
jest.mock('@gitroom/react/helpers/variable.context', () => ({ useVariables: () => ({ disableXAnalytics: false }) }));
jest.mock('@gitroom/react/translation/get.transation.service.client', () => ({ useT: () => (key: string, fallback?: string) => fallback || key }));
jest.mock('react-use-cookie', () => ({ __esModule: true, default: () => ['0', jest.fn()] }));
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('@gitroom/frontend/components/platform-analytics/render.analytics', () => ({
  RenderAnalytics: ({ integration }: any) => <div>Metrics for {integration.name}</div>,
}));
jest.mock('../../apps/frontend/src/components/platform-analytics/business.discovery', () => ({ BusinessDiscovery: () => <div>Discovery</div> }));
jest.mock('@gitroom/react/helpers/image.with.fallback', () => ({ __esModule: true, default: () => null }));
jest.mock('@gitroom/react/helpers/safe.image', () => ({ __esModule: true, default: () => null }));
jest.mock('@gitroom/frontend/components/layout/loading', () => ({ LoadingComponent: () => null }));
jest.mock('@gitroom/react/form/select', () => ({
  Select: ({ children, value, onChange }: any) => <select value={value} onChange={onChange}>{children}</select>,
}));
jest.mock('@gitroom/react/form/button', () => ({ Button: ({ children, onClick }: any) => <button onClick={onClick}>{children}</button> }));

it('replaces previous account metrics with a persistent management prompt for a disconnected selection', () => {
  render(<PlatformAnalytics />);
  expect(screen.getByText('Metrics for Ready account')).toBeTruthy();
  fireEvent.click(screen.getByText('Stale account', { exact: true }));
  expect(screen.getByRole('alert').textContent).toContain('Stale account');
  expect(screen.queryByText('Metrics for Ready account')).toBeNull();
  expect(screen.queryByText('Metrics for Stale account')).toBeNull();
  expect(screen.queryByText('Discovery')).toBeNull();
  expect(screen.getByRole('link', { name: 'Manage channels' }).getAttribute('href')).toBe('/channels');
  fireEvent.click(screen.getByText('Ready account', { exact: true }));
  expect(screen.getByText('Metrics for Ready account')).toBeTruthy();
});
