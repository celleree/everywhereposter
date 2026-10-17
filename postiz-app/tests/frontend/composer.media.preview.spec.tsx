import React from 'react';
import { render, fireEvent } from '@testing-library/react';
import { ComposerMediaPreview } from '../../apps/frontend/src/components/new-launch/composer.media.preview';

it('keeps an attached video playable with its filename and a retryable preview failure', () => {
  const media = { id: 'saved', type: 'video', name: 'server-uuid.mov', originalName: 'Original phone video.mov' };
  const view = render(<ComposerMediaPreview media={media} src="/saved/path?token=fixture" />);
  const video = view.getByLabelText('Preview Original phone video.mov') as HTMLVideoElement;
  expect(video.controls).toBe(true);
  expect(video.playsInline).toBe(true);
  expect(video.autoplay).toBe(false);
  expect(video.className).toContain('object-contain');
  fireEvent.loadedData(video);
  expect(view.queryByRole('status')).toBeNull();
  fireEvent.error(video);
  expect(view.getByRole('status').textContent).toContain('Your file is still attached');
  fireEvent.click(view.getByRole('button', { name: 'Retry preview' }));
  expect(view.getByRole('status').textContent).toContain('Loading video preview');
  expect(view.getByText(media.originalName)).toBeTruthy();
  expect(view.getByLabelText('Preview Original phone video.mov')).not.toBe(video);
});

it('renders uncropped images and retains their filename on decode failure', () => {
  const view = render(<ComposerMediaPreview media={{ id: 'image', path: '/portrait.png' }} src="/portrait.png" />);
  const image = view.getByRole('img', { name: 'portrait.png' });
  expect(image.className).toContain('object-contain');
  fireEvent.error(image);
  expect(view.getByRole('status').textContent).toContain('still attached');
});
