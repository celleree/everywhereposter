'use client';

import React, { FC } from 'react';
import { AddEditModal } from '@gitroom/frontend/components/new-launch/add.edit.modal';
import { ComposerDraftRecovery } from '@gitroom/frontend/components/new-launch/composer.draft.recovery';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import type { AddEditModalProps } from '@gitroom/frontend/components/new-launch/add.edit.modal';

export const isGuidedComposerShellEnabled = (
  value = process.env.NEXT_PUBLIC_GUIDED_COMPOSER_SHELL
) => value === 'true';

export const CreatePostComposer: FC<
  Omit<AddEditModalProps, 'enableGuidedComposerShell'>
> = (props) => {
  const user = useUser();
  const enabled = isGuidedComposerShellEnabled();
  const composer = (
    <AddEditModal
      {...props}
      enableGuidedComposerShell={enabled}
    />
  );
  return props.standaloneCreate && !props.set && !props.dummy && !props.addEditSets && !props.onlyValues?.length
    ? <ComposerDraftRecovery key={`${user?.id || ''}:${user?.orgId || ''}`} integrations={props.allIntegrations || []}>{composer}</ComposerDraftRecovery>
    : composer;
};
