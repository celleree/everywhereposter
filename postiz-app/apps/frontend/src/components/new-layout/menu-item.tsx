'use client';
import { FC, ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import clsx from 'clsx';
import Link from 'next/link';

export const MenuItem: FC<{
  label: string;
  icon: ReactNode;
  path: string;
  onClick?: () => void;
  mobileNav?: boolean;
}> = ({ label, icon, path, onClick, mobileNav }) => {
  const currentPath = usePathname();
  const isActive = currentPath.indexOf(path) === 0;

  const className = clsx(
    mobileNav
      ? 'min-w-[72px] max-w-[72px] py-[8px] px-[8px] gap-[6px] flex shrink-0 flex-col text-[10px] font-[600] items-center justify-center rounded-[12px] hover:text-textItemFocused hover:bg-boxFocused'
      : 'w-full minCustom:h-[54px] custom:h-[30px] py-[8px] px-[6px] gap-[4px] flex flex-col custom:flex-row text-[10px] font-[600] items-center minCustom:justify-center rounded-[12px] hover:text-textItemFocused hover:bg-boxFocused',
    isActive ? 'text-textItemFocused bg-boxFocused' : 'text-textItemBlur'
  );

  const content = (
    <>
      <div className={clsx(!mobileNav && 'custom:hidden')}>{icon}</div>
      <div
        className={clsx(
          'text-[10px] leading-[1.1]',
          mobileNav ? 'text-center whitespace-normal' : 'text-center'
        )}
      >
        {label}
      </div>
    </>
  );

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={className}>
        {content}
      </button>
    );
  }

  return (
    <Link
      prefetch={true}
      href={path}
      {...path.indexOf('http') === 0 && { target: '_blank' }}
      className={className}
    >
      {content}
    </Link>
  );
};
