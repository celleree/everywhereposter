'use client';

const BLACK_ICON = '/branding/everywhereposter-icon-black.svg';
const WHITE_ICON = '/branding/everywhereposter-icon-white.svg';

export const Logo = ({
  tone = 'auto',
}: {
  tone?: 'auto' | 'black' | 'white';
}) => {
  return (
    <span
      role="img"
      aria-label="EverywherePoster"
      className="mt-[8px] block size-[60px] min-h-[60px] min-w-[60px]"
    >
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
  );
};
