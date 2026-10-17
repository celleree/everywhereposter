import React from 'react';
import { render, fireEvent } from '@testing-library/react';
import { InlineUploadProgress } from '../../apps/frontend/src/components/media/inline-upload-progress';

it('keeps legacy file progress and cancel without a percentage or unsafe automatic retry', () => {
  const cancel = jest.fn();
  const uppy = { on: jest.fn(), off: jest.fn(), getFiles: () => [{ id: 'image', name: 'photo.png', size: 100, progress: { bytesUploaded: 42 } }] } as any;
  const view = render(<InlineUploadProgress uppy={uppy} onCancel={cancel} />);
  expect(view.getByText('photo.png')).toBeTruthy();
  expect(view.getByRole('progressbar').getAttribute('value')).toBe('42');
  expect(view.queryByText(/%/)).toBeNull();
  expect(view.queryByRole('button', { name: /retry/i })).toBeNull();
  fireEvent.click(view.getByRole('button', { name: 'Cancel upload' }));
  expect(cancel).toHaveBeenCalledTimes(1);
  view.unmount();
  expect(uppy.off).toHaveBeenCalledWith('state-update', expect.any(Function));
});

it('shows no duplicate legacy progress for layout-owned video uploads', () => {
  const uppy = { on: jest.fn(), off: jest.fn(), getFiles: () => [] } as any;
  const view = render(<InlineUploadProgress uppy={uppy} onCancel={jest.fn()} />);
  expect(view.queryByRole('region')).toBeNull();
});

it('limits guidance to mobile during an active upload and removes it after completion', () => {
  const progress: any = { bytesUploaded: 42, uploadStarted: 1, uploadComplete: false };
  const upload: any = { id: 'image', name: 'photo.png', size: 100, progress };
  const uppy = { on: jest.fn(), off: jest.fn(), getFiles: () => [upload] } as any;
  const view = render(<InlineUploadProgress uppy={uppy} onCancel={jest.fn()} />);
  const message = 'Keep this browser open and on screen while uploading.';
  expect(view.getByText(message).className).toContain('hidden mobile:block');
  progress.uploadComplete = true;
  view.rerender(<InlineUploadProgress uppy={uppy} onCancel={jest.fn()} />);
  expect(view.queryByText(message)).toBeNull();
  progress.uploadComplete = false; upload.error = 'Synthetic upload failure';
  view.rerender(<InlineUploadProgress uppy={uppy} onCancel={jest.fn()} />);
  expect(view.queryByText(message)).toBeNull();
  upload.error = undefined; upload.isPaused = true;
  view.rerender(<InlineUploadProgress uppy={uppy} onCancel={jest.fn()} />);
  expect(view.queryByText(message)).toBeNull();
});
