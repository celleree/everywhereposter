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
