'use client';

import { Button } from '@gitroom/react/form/button';
import React, { FC } from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { PostComment } from '@gitroom/frontend/components/new-launch/providers/high.order.provider';
export const AddPostButton: FC<{
  onClick: () => void;
  num: number;
  postComment: PostComment;
  identifier?: string;
  disabled?: boolean;
}> = (props) => {
  const { onClick, num } = props;
  const t = useT();
  const isInstagram =
    props.identifier === 'instagram' ||
    props.identifier === 'instagram-standalone';
  const label =
    isInstagram && props.postComment === PostComment.COMMENT && num === 0
      ? t('add_instagram_first_comment', 'Add Instagram first comment')
      : props.postComment === PostComment.ALL
      ? t(
          'add_platform_comment_or_post',
          'Add platform comment or post'
        )
      : props.postComment === PostComment.POST
      ? t('add_post', 'Add post')
      : t('add_platform_comment', 'Add platform comment');

  return (
    <div className="flex max-w-full min-w-0">
      <div
        onClick={props.disabled ? undefined : onClick}
        aria-disabled={props.disabled}
        className={`select-none h-[34px] max-w-full min-w-0 rounded-[6px] flex bg-btnPrimary gap-[8px] justify-center items-center pl-[16px] pr-[20px] text-[13px] font-[600] mt-[12px] ${
          props.disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'
        }`}
      >
        <div className="shrink-0">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
          >
            <path
              d="M8.00065 3.33301V12.6663M3.33398 7.99967H12.6673"
              stroke="white"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <div className="min-w-0 truncate !text-white">
          {label}
        </div>
      </div>
    </div>
  );
};
