'use client';

const BLACK_ICON = '/branding/everywhereposter-icon-black.svg';
const WHITE_ICON = '/branding/everywhereposter-icon-white.svg';

export const Logo = () => {
  return (
    <span
      role="img"
      aria-label="EverywherePoster"
      className="mt-[8px] block size-[60px] min-h-[60px] min-w-[60px]"
    >
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
  );
};
