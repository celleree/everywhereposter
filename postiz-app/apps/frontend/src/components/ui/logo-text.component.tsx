import React from 'react';

const BLACK_ICON = '/branding/everywhereposter-icon-black.svg';
const WHITE_ICON = '/branding/everywhereposter-icon-white.svg';

export const LogoTextComponent = ({
  tone = 'auto',
}: {
  tone?: 'auto' | 'black' | 'white';
}) => {
  return (
    <div
      aria-label="EverywherePoster"
      className="flex max-w-full items-center gap-[10px] whitespace-nowrap"
    >
      <span className="block size-[clamp(28px,8vw,34px)] shrink-0">
        {tone !== 'white' && (
          <img
            src={BLACK_ICON}
            alt=""
            aria-hidden="true"
            className={`size-full object-contain ${
              tone === 'auto' ? 'block dark:hidden' : 'block'
            }`}
          />
        )}
        {tone !== 'black' && (
          <img
            src={WHITE_ICON}
            alt=""
            aria-hidden="true"
            className={`size-full object-contain ${
              tone === 'auto' ? 'hidden dark:block' : 'block'
            }`}
          />
        )}
      </span>
      <span className="text-[clamp(16px,4vw,24px)] font-[600] leading-none">
        EverywherePoster
      </span>
    </div>
  );
};
