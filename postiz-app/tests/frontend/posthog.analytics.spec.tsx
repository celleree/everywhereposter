/** @jest-environment-options {"url":"http://analytics.test"} */
import React, { StrictMode } from 'react';
import { render, renderHook, act } from '@testing-library/react';
import posthog from 'posthog-js';
import { PHProvider } from '@gitroom/react/helpers/posthog';
import { useFireEvents } from '@gitroom/helpers/utils/use.fire.events';
import { analyticsUrl, initializePostHog } from '@gitroom/react/helpers/posthog.analytics';

let mockPath = '/auth';
let mockBilling = false;
const mockPlausible = jest.fn();
jest.mock('next/navigation', () => ({ usePathname: () => mockPath }));
jest.mock('posthog-js', () => ({
  __esModule: true,
  default: { __loaded: false, init: jest.fn(), capture: jest.fn(), identify: jest.fn() },
}));
jest.mock('posthog-js/react', () => ({
  PostHogProvider: ({ children }: any) => children,
  usePostHog: () => posthog,
}));
jest.mock('next-plausible', () => ({ usePlausible: () => mockPlausible }));
jest.mock('@gitroom/react/helpers/variable.context', () => ({
  useVariables: () => ({ billingEnabled: mockBilling }),
}));
jest.mock('@gitroom/frontend/components/layout/user.context', () => ({
  useUser: () => ({ id: 'user-1', email: 'test@example.test', name: 'Test' }),
}));

beforeEach(() => {
  posthog.__loaded = false;
  mockBilling = false;
  localStorage.clear();
  Object.defineProperty(navigator, 'webdriver', { value: false, configurable: true });
  (posthog.init as jest.Mock).mockImplementation(() => { posthog.__loaded = true; });
  initializePostHog(undefined, undefined, 'test');
});

it('fails closed for missing config, dev, automation, internal testing and invalid hosts', () => {
  expect(initializePostHog('', 'https://ingest.test', 'production')).toBe(false);
  expect(initializePostHog('key', '', 'production')).toBe(false);
  expect(initializePostHog('key', 'https://ingest.test', 'development')).toBe(false);
  expect(initializePostHog('key', 'invalid', 'production')).toBe(false);
  Object.defineProperty(navigator, 'webdriver', { value: true, configurable: true });
  expect(initializePostHog('key', 'https://ingest.test', 'production')).toBe(false);
  Object.defineProperty(navigator, 'webdriver', { value: false });
  localStorage.setItem('everywhereposter.analytics.disabled', 'true');
  expect(initializePostHog('key', 'https://ingest.test', 'production')).toBe(false);
  expect(posthog.init).not.toHaveBeenCalled();
});

it('captures initial and client navigation once, retains referrer and disables sensitive collection', () => {
  const props = { phkey: 'key', host: 'https://ingest.test', environment: 'production' };
  const view = render(<StrictMode><PHProvider {...props}>child</PHProvider></StrictMode>);
  expect(posthog.init).toHaveBeenCalledTimes(1);
  expect(posthog.capture).toHaveBeenCalledTimes(1);
  expect(posthog.capture).toHaveBeenLastCalledWith('$pageview', expect.objectContaining({
    $pathname: '/auth', $current_url: 'http://analytics.test/auth',
  }));
  mockPath = '/media';
  view.rerender(<StrictMode><PHProvider {...props}>changed</PHProvider></StrictMode>);
  expect(posthog.capture).toHaveBeenCalledTimes(2);
  expect(posthog.capture).toHaveBeenLastCalledWith('$pageview', expect.objectContaining({
    $pathname: '/media', $referrer: 'http://analytics.test/auth',
  }));
  view.unmount();
  render(<PHProvider {...props}>remount</PHProvider>);
  expect(posthog.capture).toHaveBeenCalledTimes(2);
  expect(posthog.init).toHaveBeenCalledWith('key', expect.objectContaining({
    advanced_disable_flags: true, disable_session_recording: true, autocapture: false, enable_heatmaps: false,
    enable_recording_console_log: false, capture_performance: false,
    session_recording: { maskAllInputs: true, maskTextSelector: '*', blockSelector: 'body' },
  }));
  const config = (posthog.init as jest.Mock).mock.calls[0][1];
  const sanitized = config.before_send({
    $set_once: { $initial_current_url: 'https://app.test/auth/forgot/private-token?code=secret' },
    $set: { $referrer: 'https://external.test/private-id?token=secret' },
    properties: {
    $current_url: 'https://app.test/auth?code=secret#token',
    $referrer: 'https://external.test/private-id?email=secret',
    $set_once: { $initial_current_url: 'https://app.test/auth/forgot/private-token' },
  } });
  expect(JSON.stringify(sanitized)).not.toMatch(/secret|private-token|private-id/);
});

it('preserves identification/custom events independently of billing and keeps Plausible gated', () => {
  initializePostHog('key', 'https://ingest.test', 'production');
  const hook = renderHook(useFireEvents);
  act(() => hook.result.current('register', { source: 'confirmed' }));
  expect(posthog.identify).toHaveBeenCalledWith('user-1', expect.objectContaining({ name: 'Test' }));
  expect(posthog.capture).toHaveBeenCalledWith('register', { source: 'confirmed' });
  expect(mockPlausible).not.toHaveBeenCalled();
  act(() => hook.result.current('purchase'));
  expect(posthog.capture).toHaveBeenLastCalledWith('checkout_returned', undefined);
  mockBilling = true;
  hook.rerender();
  act(() => hook.result.current('custom'));
  expect(mockPlausible).toHaveBeenCalledWith('custom', { props: undefined });
  initializePostHog(undefined, undefined, 'test');
  (posthog.capture as jest.Mock).mockClear();
  act(() => hook.result.current('disabled'));
  expect(posthog.capture).not.toHaveBeenCalled();
});

it('redacts private path segments and strips search/hash and credentials', () => {
  expect(analyticsUrl('https://user:password@app.test/auth?token=secret#secret')).toBe('https://app.test/auth');
  expect(analyticsUrl('https://app.test/auth/forgot/secret')).toBe('https://app.test/[private]');
  expect(analyticsUrl('javascript:secret')).toBe('');
});
