'use client';

import { forwardRef, useCallback } from 'react';
import clsx from 'clsx';
import { useFormContext } from 'react-hook-form';
export const Checkbox = forwardRef<
  null,
  {
    checked?: boolean;
    disabled?: boolean;
    disableForm?: boolean;
    name?: string;
    className?: string;
    label?: string;
    onChange?: (event: {
      target: {
        name?: string;
        value: boolean;
      };
    }) => void;
    variant?: 'default' | 'hollow';
  }
>((props, ref: any) => {
  const { checked, disabled, className, label, disableForm, variant } = props;
  const form = useFormContext();
  const register = disableForm ? {} : form.register(props.name!);
  const watch = disableForm ? false : form.watch(props.name!);
  const val = watch || checked;

  const changeStatus = useCallback(() => {
    if (disabled) {
      return;
    }

    props?.onChange?.({
      target: {
        name: props.name!,
        value: !val,
      },
    });
    if (!disableForm) {
      // @ts-ignore
      register?.onChange?.({
        target: {
          name: props.name!,
          value: !val,
        },
      });
    }
  }, [disabled, disableForm, props, register, val]);
  return (
    <div className="flex gap-[10px]">
      <div
        ref={ref}
        {...disableForm ? {} : form.register(props.name!)}
        role="checkbox"
        aria-label={label}
        aria-checked={Boolean(val)}
        aria-disabled={disabled || undefined}
        tabIndex={disabled ? -1 : 0}
        onClick={changeStatus}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            changeStatus();
          }
        }}
        className={clsx(
          'rounded-[4px] select-none w-[24px] h-[24px] justify-center items-center flex text-white',
          disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
          variant === 'default' || !variant
            ? 'bg-forth'
            : 'border-customColor1 border-2 bg-customColor2',
          className
        )}
      >
        {val && (
          <div>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              width="20"
              height="20"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
          </div>
        )}
      </div>
      {!!label && <div>{label}</div>}
    </div>
  );
});
