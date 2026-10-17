import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { RegisterAfter } from '@gitroom/frontend/components/auth/register';
const mockEvents = jest.fn();
const mockFetch = jest.fn();
jest.mock('@gitroom/helpers/utils/use.fire.events', () => ({ useFireEvents: () => mockEvents }));
jest.mock('@gitroom/helpers/utils/custom.fetch', () => ({ useFetch: () => mockFetch }));
jest.mock('@gitroom/react/helpers/use.track', () => ({ useTrack: () => async () => {} }));
jest.mock('@gitroom/react/helpers/variable.context', () => ({ useVariables: () => ({}) }));
jest.mock('@gitroom/react/translation/get.transation.service.client', () => ({ useT: () => (_: string, text: string) => text }));
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }), useSearchParams: () => new URLSearchParams() }));
jest.mock('next/dynamic', () => ({ __esModule: true, default: () => () => null }));
jest.mock('react-use-cookie', () => ({ __esModule: true, default: () => [''] }));
jest.mock('@gitroom/nestjs-libraries/dtos/auth/create.org.user.dto', () => ({ CreateOrgUserDto: class {} }));
jest.mock('@hookform/resolvers/class-validator', () => ({ classValidatorResolver: () => undefined }));
jest.mock('@gitroom/frontend/components/auth/providers/github.provider', () => ({ GithubProvider: () => null }));
jest.mock('@gitroom/frontend/components/auth/providers/google.provider', () => ({ GoogleProvider: () => null }));
jest.mock('@gitroom/frontend/components/auth/providers/oauth.provider', () => ({ OauthProvider: () => null }));
jest.mock('@gitroom/frontend/components/auth/providers/farcaster.provider', () => ({ FarcasterProvider: () => null }));
jest.mock('@gitroom/frontend/components/auth/providers/placeholder/wallet.ui.provider', () => ({ WalletUiProvider: () => null }));
jest.mock('@gitroom/frontend/components/layout/loading', () => ({ LoadingComponent: () => null }));
jest.mock('@gitroom/react/form/input', () => ({ Input: () => null }));
jest.mock('@gitroom/react/form/button', () => ({ Button: ({ children, type }: any) => <button type={type}>{children}</button> }));
jest.mock('react-hook-form', () => ({
  FormProvider: ({ children }: any) => children,
  useForm: () => ({ register: () => ({}), setError: jest.fn(), handleSubmit: (submit: any) => (event: any) => { event.preventDefault(); return submit({}); } }),
}));

it('does not count rendering or a rejected request as completed registration; starts once across retry', async () => {
  mockFetch.mockResolvedValueOnce({ status: 400, text: async () => 'Rejected' });
  mockFetch.mockResolvedValueOnce({ status: 200, headers: new Headers() });
  render(<RegisterAfter token="" provider="LOCAL" />);
  expect(mockEvents).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Create Account' }));
  await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
  expect(mockEvents.mock.calls.map(call => call[0])).toEqual(['signup_started']);
  fireEvent.click(screen.getByRole('button', { name: 'Create Account' }));
  await waitFor(() => expect(mockEvents).toHaveBeenCalledWith('register'));
  expect(mockEvents.mock.calls.map(call => call[0])).toEqual(['signup_started', 'register']);
});
