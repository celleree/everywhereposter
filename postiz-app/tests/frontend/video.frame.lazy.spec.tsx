import React from 'react';
import { act, render } from '@testing-library/react';
import { VideoFrame } from '../../libraries/react-shared-libraries/src/helpers/video.frame';

it('defers grid video requests until near the viewport and disconnects on unmount', () => {
  let notify: (entries: any[]) => void = () => {};
  const disconnect = jest.fn();
  const observe = jest.fn();
  const original = window.IntersectionObserver;
  window.IntersectionObserver = jest.fn((callback) => {
    notify = callback;
    return { observe, disconnect };
  }) as any;
  try {
    const { container, unmount } = render(<VideoFrame lazy url="/synthetic.mp4" />);
    const video = container.querySelector('video')!;
    expect(video.getAttribute('src')).toBeNull();
    expect(observe).toHaveBeenCalledWith(video);
    act(() => notify([{ isIntersecting: false }]));
    expect(video.getAttribute('src')).toBeNull();
    act(() => notify([{ isIntersecting: true }]));
    expect(video.getAttribute('src')).toBe('/synthetic.mp4#t=0.1');
    expect(video.autoplay).toBe(false);
    unmount();
    expect(disconnect).toHaveBeenCalled();
  } finally { window.IntersectionObserver = original; }
});

it('retains immediate loading outside grids and falls back when observers are unavailable', () => {
  const original = window.IntersectionObserver;
  delete (window as any).IntersectionObserver;
  try {
    const { container } = render(<><VideoFrame url="/preview.mp4" autoplay /><VideoFrame lazy url="/grid.mp4" /></>);
    expect([...container.querySelectorAll('video')].map(video => video.getAttribute('src'))).toEqual(['/preview.mp4#t=0.1', '/grid.mp4#t=0.1']);
    expect(container.querySelector('video')!.autoplay).toBe(true);
  } finally { window.IntersectionObserver = original; }
});
