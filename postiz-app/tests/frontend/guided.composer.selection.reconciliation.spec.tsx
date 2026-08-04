import React from 'react';
import { act, render, waitFor } from '@testing-library/react';
import dayjs from 'dayjs';

jest.mock('@gitroom/frontend/components/media/media.component', () => ({
  MediaBox: () => null,
}));

jest.mock('@gitroom/frontend/components/layout/new-modal', () => ({
  useModals: () => ({
    openModal: jest.fn(),
    closeAll: jest.fn(),
    closeById: jest.fn(),
    closeCurrent: jest.fn(),
  }),
}));

jest.mock(
  '@gitroom/frontend/components/new-launch/providers/high.order.provider',
  () => ({
    PostComment: { ALL: 'ALL' },
  })
);

jest.mock('@gitroom/nestjs-libraries/services/make.is', () => ({
  makeId: () => 'generated-post-id',
}));

jest.mock(
  '@gitroom/frontend/components/launches/helpers/use.existing.data',
  () => ({
    useExistingData: () => ({}),
  })
);

jest.mock('@gitroom/frontend/components/layout/set.timezone', () => ({
  newDayjs: () => require('dayjs')('2026-08-04T12:00:00Z'),
}));

jest.mock('@gitroom/frontend/components/new-launch/manage.modal', () => {
  const ReactModule = require('react');

  return {
    ManageModal: () =>
      ReactModule.createElement(
        'div',
        { 'data-testid': 'manage-modal' },
        'Manage modal'
      ),
  };
});

jest.mock(
  '@gitroom/frontend/components/new-launch/guided.composer.shell',
  () => {
    const ReactModule = require('react');

    return {
      GuidedComposerShell: ({ children }: { children: React.ReactNode }) =>
        ReactModule.createElement(
          'div',
          { 'data-testid': 'guided-composer-shell' },
          children
        ),
      shouldUseGuidedComposerShell: ({ enabled }: { enabled?: boolean }) =>
        enabled === true,
    };
  }
);

import { AddEditModal } from '../../apps/frontend/src/components/new-launch/add.edit.modal';
import { useLaunchStore } from '../../apps/frontend/src/components/new-launch/store';

const connectedInstagram = {
  id: 'instagram-account',
  name: 'Founder Instagram',
  identifier: 'instagram',
  display: '@founder',
  picture: '',
  disabled: false,
  inBetweenSteps: false,
  editor: 'normal',
  type: 'social',
  changeProfilePicture: false,
  additionalSettings: '',
  changeNickName: false,
  time: [],
} as any;

const disabledInstagram = {
  ...connectedInstagram,
  disabled: true,
};

const modalProps = {
  date: dayjs('2026-08-04T12:00:00Z'),
  integrations: [connectedInstagram],
  reopenModal: () => {},
  mutate: () => {},
  standaloneCreate: true,
  enableGuidedComposerShell: true,
};

describe('guided composer selected destination reconciliation', () => {
  beforeEach(() => {
    useLaunchStore.getState().reset();
  });

  it('removes a selected account when it disappears from refreshed integrations', async () => {
    const { rerender } = render(
      <AddEditModal {...modalProps} allIntegrations={[connectedInstagram]} />
    );

    await waitFor(() => {
      expect(useLaunchStore.getState().integrations).toHaveLength(1);
    });

    act(() => {
      useLaunchStore.getState().setSelectedIntegrations([
        {
          selectedIntegrations: connectedInstagram,
          settings: { post_type: 'reel' },
        },
      ]);
    });

    rerender(
      <AddEditModal {...modalProps} integrations={[]} allIntegrations={[]} />
    );

    await waitFor(() => {
      expect(useLaunchStore.getState().selectedIntegrations).toEqual([]);
    });
  });

  it('removes a selected account when refreshed data marks it disabled', async () => {
    const { rerender } = render(
      <AddEditModal {...modalProps} allIntegrations={[connectedInstagram]} />
    );

    await waitFor(() => {
      expect(useLaunchStore.getState().integrations).toHaveLength(1);
    });

    act(() => {
      useLaunchStore.getState().setSelectedIntegrations([
        {
          selectedIntegrations: connectedInstagram,
          settings: {},
        },
      ]);
    });

    rerender(
      <AddEditModal
        {...modalProps}
        integrations={[disabledInstagram]}
        allIntegrations={[disabledInstagram]}
      />
    );

    await waitFor(() => {
      expect(useLaunchStore.getState().selectedIntegrations).toEqual([]);
    });
    expect(useLaunchStore.getState().integrations[0].disabled).toBe(true);
  });
});
