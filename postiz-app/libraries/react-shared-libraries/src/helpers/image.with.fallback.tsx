import { FC, useEffect, useState } from 'react';
import SafeImage from './safe.image';
interface ImageSrc {
  src: string;
  fallbackSrc: string;
  width: number;
  height: number;
  [key: string]: any;
}
const ImageWithFallback: FC<ImageSrc> = (props) => {
  const { src, fallbackSrc, ...rest } = props;
  const [imgSrc, setImgSrc] = useState(src);
  useEffect(() => {
    setImgSrc(src);
  }, [src]);
  return (
    <SafeImage
      alt=""
      {...rest}
      src={imgSrc}
      onError={() => {
        if (imgSrc !== fallbackSrc) {
          setImgSrc(fallbackSrc);
        }
      }}
    />
  );
};
export default ImageWithFallback;
