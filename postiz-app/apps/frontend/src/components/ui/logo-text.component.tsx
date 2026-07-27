import React from 'react';

const BLACK_ICON = '/branding/everywhereposter-icon-black.svg';
const WHITE_ICON = '/branding/everywhereposter-icon-white.svg';

export const LogoTextComponent = () => {
  return (
    <div
      aria-label="EverywherePoster"
      className="flex max-w-full items-center gap-[10px] whitespace-nowrap"
    >
      <span className="block size-[clamp(28px,8vw,34px)] shrink-0">
        <img
          src={BLACK_ICON}
          alt=""
          aria-hidden="true"
          className="block size-full object-contain dark:hidden"
        />
        <img
          src={WHITE_ICON}
          alt=""
          aria-hidden="true"
          className="hidden size-full object-contain dark:block"
        />
      </span>
      <span className="text-[clamp(16px,4vw,24px)] font-[600] leading-none">
        EverywherePoster
      </span>
    </div>
  );
};
