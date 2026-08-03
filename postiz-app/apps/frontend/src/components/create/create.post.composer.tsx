'use client';

import React, { FC } from 'react';
import { AddEditModal } from '@gitroom/frontend/components/new-launch/add.edit.modal';
import type { AddEditModalProps } from '@gitroom/frontend/components/new-launch/add.edit.modal';

export const isGuidedComposerShellEnabled = (
  value = process.env.NEXT_PUBLIC_GUIDED_COMPOSER_SHELL
) => value === 'true';

export const CreatePostComposer: FC<
  Omit<AddEditModalProps, 'enableGuidedComposerShell'>
> = (props) => {
  return (
    <AddEditModal
      {...props}
      enableGuidedComposerShell={isGuidedComposerShellEnabled()}
    />
  );
};
