'use client';

import { FC, useEffect, useRef, useState } from 'react';
export const VideoFrame: FC<{
  url: string;
  autoplay?: boolean;
  lazy?: boolean;
}> = (props) => {
  const { url, lazy = false } = props;
  const ref = useRef<HTMLVideoElement>(null);
  const [visible, setVisible] = useState(!lazy);
  useEffect(() => {
    if (!lazy || !('IntersectionObserver' in window)) {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setVisible(true);
        observer.disconnect();
      }
    }, { rootMargin: '200px' });
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, [lazy]);
  return (
    <video
      ref={ref}
      className="w-full h-full object-cover rounded-[4px]"
      src={visible ? url + '#t=0.1' : undefined}
      preload="metadata"
      autoPlay={!!props?.autoplay}
    />
  );
};
