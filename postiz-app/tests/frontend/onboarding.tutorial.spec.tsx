import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { OnboardingModal } from '../../apps/frontend/src/components/onboarding/onboarding.modal';
import { TutorialVideo } from '../../apps/frontend/src/components/onboarding/tutorial.video';

jest.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}));
jest.mock('@gitroom/helpers/utils/custom.fetch', () => ({ useFetch: () => jest.fn() }));
jest.mock('@gitroom/frontend/components/layout/new-modal', () => ({
  useModals: () => ({ closeAll: jest.fn() }),
}));
jest.mock('@gitroom/frontend/components/launches/add.provider.component', () => ({
  AddProviderComponent: () => null,
}));
jest.mock('@gitroom/react/helpers/safe.image', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('swr', () => ({
  __esModule: true,
  default: (key: string) => ({ data: key === '/integrations/list' ? [] : { social: [], article: [] } }),
}));

const pause = jest.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
afterAll(() => pause.mockRestore());

it('keeps Back and Finish usable around the captioned tutorial', () => {
  const finish = jest.fn();
  render(<OnboardingModal onClose={finish} />);
  fireEvent.click(screen.getByRole('button', { name: 'Continue without channels' }));
  const video = screen.getByLabelText('Learn How to Use EverywherePoster') as HTMLVideoElement;
  expect(video.controls).toBe(true);
  expect(video.playsInline).toBe(true);
  expect(video.autoplay).toBe(false);
  expect(video.querySelector('track')?.getAttribute('srclang')).toBe('en');
  expect(video.querySelector('track')?.hasAttribute('default')).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Back' }));
  expect(pause).toHaveBeenCalledTimes(1);
  expect(screen.queryByLabelText('Learn How to Use EverywherePoster')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Continue without channels' }));
  fireEvent.click(screen.getByRole('button', { name: 'Get Started' }));
  expect(finish).toHaveBeenCalledTimes(1);
});

it('offers the same video directly when browser playback fails', () => {
  render(<TutorialVideo />);
  fireEvent.error(screen.getByLabelText('Learn How to Use EverywherePoster'));
  const fallback = screen.getByRole('alert');
  expect(fallback.textContent).toContain('The video could not load.');
  expect(screen.getByRole('link', { name: 'Open the walkthrough' }).getAttribute('href')).toBe(
    '/videos/everywhereposter-onboarding.mp4'
  );
});
