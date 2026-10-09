import { createContext, FC, useContext } from 'react';
import { clsx } from 'clsx';
export const MediaAutoplayContext = createContext(true);
export const VideoOrImage: FC<{
  src: string;
  autoplay: boolean;
  isContain?: boolean;
  imageClassName?: string;
  videoClassName?: string;
}> = (props) => {
  const { src, autoplay, isContain, imageClassName, videoClassName } = props;
  const allowAutoplay = useContext(MediaAutoplayContext);
  if (/\.(mp4|mov)(?:$|[?#])/i.test(src || '')) {
    return (
      <video
        src={src}
        autoPlay={autoplay && allowAutoplay}
        className={clsx('w-full h-full', videoClassName)}
        muted={true}
        loop={true}
      />
    );
  }
  return (
    <img
      className={clsx(
        isContain ? 'object-contain' : 'object-cover',
        'w-full h-full',
        imageClassName
      )}
      src={src}
    />
  );
};
