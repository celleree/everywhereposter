import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { TopMenu } from '../../apps/frontend/src/components/layout/top.menu';

let mockRole = 'ADMIN';
let mockPath = '/create';
let mockBilling = false;
let mockTier = 'STANDARD';
let mockOrganizations = [{ id: 'org-1', name: 'Current workspace' }, { id: 'org-2', name: 'Other workspace' }];
const mockFetch = jest.fn(async () => ({ ok: true, json: async () => mockOrganizations }));
jest.mock('next/navigation', () => ({ usePathname: () => mockPath }));
jest.mock('next/link', () => ({ __esModule: true, default: ({ children, prefetch, ...props }: any) => <a {...props}>{children}</a> }));
jest.mock('@gitroom/frontend/components/layout/user.context', () => ({ useUser: () => ({ role: mockRole, orgId: 'org-1', tier: { current: mockTier } }) }));
jest.mock('@gitroom/react/helpers/variable.context', () => ({ useVariables: () => ({ isGeneral: true, billingEnabled: mockBilling }) }));
jest.mock('@gitroom/react/translation/get.transation.service.client', () => ({ useT: () => (_key: string, fallback: string) => fallback }));
jest.mock('@gitroom/helpers/utils/custom.fetch', () => ({ useFetch: () => mockFetch }));
jest.mock('@gitroom/frontend/components/launches/helpers/use.integration.list', () => ({ useIntegrationList: () => ({ mutate: jest.fn() }) }));
jest.mock('swr', () => ({ __esModule: true, default: () => ({ data: mockOrganizations, isLoading: false }) }));
jest.mock('@gitroom/frontend/components/launches/add.provider.component', () => ({ AddProviderButton: () => <button>Add Channel</button> }));

beforeEach(() => { mockRole = 'ADMIN'; mockPath = '/create'; mockBilling = false; mockTier = 'STANDARD'; mockOrganizations = [{ id: 'org-1', name: 'Current workspace' }, { id: 'org-2', name: 'Other workspace' }]; mockFetch.mockClear(); });

it('has four mobile destinations and exposes the existing routes through More', () => {
  render(<TopMenu mobileNav />);
  const nav = screen.getByRole('navigation', { name: 'Mobile navigation' });
  expect(nav.querySelectorAll('a,button')).toHaveLength(4);
  expect(screen.getByRole('link', { name: 'Upload' }).getAttribute('aria-current')).toBe('page');
  expect(screen.getByRole('link', { name: 'Scheduled' }).getAttribute('href')).toBe('/launches');
  expect(screen.getByRole('link', { name: 'Media' }).getAttribute('href')).toBe('/media');
  fireEvent.click(screen.getByRole('button', { name: 'More' }));
  const moreDialog = screen.getByRole('dialog', { name: 'More menu' });
  expect(within(moreDialog).queryByText('More')).toBeNull();
  const dialog = getComputedStyle(moreDialog.querySelector('[tabindex="-1"]')!);
  expect(dialog.overflowY).toBe('auto');
  expect(dialog.overflowX).toBe('hidden');
  expect(dialog.maxHeight).toBe('calc(100dvh - env(safe-area-inset-top))');
  for (const [name, route] of [['Agent', '/agents'], ['Analytics', '/analytics'], ['Plugs', '/plugs'], ['Integrations', '/third-party'], ['Settings', '/settings']]) {
    expect(screen.getByRole('link', { name }).getAttribute('href')).toBe(route);
  }
  expect(screen.getByRole('button', { name: 'Add Channel' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Add Channel' }));
  expect(screen.getByRole('button', { name: 'More' }).getAttribute('aria-expanded')).toBe('false');
  fireEvent.click(screen.getByRole('button', { name: 'More' }));
  fireEvent.click(screen.getByRole('link', { name: 'Integrations' }));
  expect(screen.getByRole('button', { name: 'More' }).getAttribute('aria-expanded')).toBe('false');
});

it('keeps the More dialog named and closes it with the accessible close control or Escape', async () => {
  render(<TopMenu mobileNav />);
  const moreButton = screen.getByRole('button', { name: 'More' });
  fireEvent.click(moreButton);
  expect(screen.getByRole('dialog', { name: 'More menu' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Close More' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'More menu' })).toBeNull());
  expect(moreButton.getAttribute('aria-expanded')).toBe('false');

  moreButton.focus();
  fireEvent.click(moreButton);
  fireEvent.keyDown(
    screen.getByRole('dialog', { name: 'More menu' }).querySelector('[tabindex="-1"]')!,
    { key: 'Escape' }
  );
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'More menu' })).toBeNull());
  expect(moreButton.getAttribute('aria-expanded')).toBe('false');
  expect(document.activeElement).toBe(moreButton);
});

it('retains the existing role filter for Settings', () => {
  mockRole = 'GUEST';
  render(<TopMenu mobileNav />);
  fireEvent.click(screen.getByRole('button', { name: 'More' }));
  expect(screen.queryByRole('link', { name: 'Settings' })).toBeNull();
});

it('keeps desktop destinations directly available without a More control', () => {
  render(<TopMenu />);
  expect(screen.getByRole('link', { name: 'Agent' }).getAttribute('href')).toBe('/agents');
  expect(screen.getByRole('link', { name: 'Settings' }).getAttribute('href')).toBe('/settings');
  expect(screen.queryByRole('button', { name: 'More' })).toBeNull();
});


it('preserves optional hosted destinations under their existing billing and role gates', () => {
  mockBilling = true;
  render(<TopMenu mobileNav />);
  fireEvent.click(screen.getByRole('button', { name: 'More' }));
  expect(screen.getByRole('link', { name: 'Billing' }).getAttribute('href')).toBe('/billing');
  expect(screen.getByRole('link', { name: 'Affiliate' }).getAttribute('target')).toBe('_blank');
  expect(screen.getByRole('button', { name: 'UGC' })).toBeTruthy();
});


it('lets a FREE billed organization switch to another allowed organization without exposing Create', async () => {
  mockBilling = true;
  mockTier = 'FREE';
  render(<TopMenu mobileNav />);
  expect(screen.queryByRole('link', { name: 'Upload' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'More' }));
  expect(screen.queryByRole('button', { name: 'Add Channel' })).toBeNull();
  expect(screen.getByText('Select Organization')).toBeTruthy();
  // JSDOM cannot reload pages. Keep all unexpected errors visible.
  const originalError = console.error;
  const error = jest.spyOn(console, 'error').mockImplementation((...args) => {
    if (args[0]?.message?.includes('Not implemented: navigation')) return;
    originalError(...args);
  });
  try {
    fireEvent.click(screen.getByText('Other workspace'));
    await waitFor(() => expect(mockFetch).toHaveBeenCalledWith('/user/change-org', {
      method: 'POST', body: JSON.stringify({ id: 'org-2' }),
    }));
  } finally { error.mockRestore(); }
});

it('retains switching and Add Channel for paid organizations', () => {
  mockBilling = true;
  render(<TopMenu mobileNav />);
  fireEvent.click(screen.getByRole('button', { name: 'More' }));
  expect(screen.getByText('Other workspace')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Add Channel' })).toBeTruthy();
});

it('keeps the real selector hidden for a single organization', () => {
  mockOrganizations = [mockOrganizations[0]];
  render(<TopMenu mobileNav />);
  fireEvent.click(screen.getByRole('button', { name: 'More' }));
  expect(screen.queryByText('Select Organization')).toBeNull();
  expect(screen.queryByText('Current workspace')).toBeNull();
  expect(screen.getByRole('button', { name: 'Add Channel' })).toBeTruthy();
});

it('scopes a visible keyboard focus ring to More buttons and links', () => {
  const source = require('fs').readFileSync(require('path').resolve(__dirname, '../../apps/frontend/src/app/mobile-ui.scss'), 'utf8');
  const css = require('postcss').parse(require('sass').compileString(source + '\n@include styles;').css);
  let focusRule: any;
  css.walkRules((rule: any) => {
    if (rule.selector.includes('.mobile-more-drawer button:focus-visible')) focusRule = rule;
  });
  expect(focusRule.selector).toContain('.mobile-more-drawer a:focus-visible');
  expect(focusRule.parent.params).toBe('(max-width: 1025px)');
  expect(focusRule.nodes.find((node: any) => node.prop === 'box-shadow').value).toBe('0 0 0 2px var(--new-btn-text)');
});
