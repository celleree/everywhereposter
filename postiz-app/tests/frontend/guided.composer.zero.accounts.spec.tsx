import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
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

import {
  AddEditModal,
  canRenderEmptyGuidedComposer,
} from '../../apps/frontend/src/components/new-launch/add.edit.modal';
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

describe('guided composer zero-account AddEditModal path', () => {
  beforeEach(() => {
    useLaunchStore.getState().reset();
  });

  it('allows only the eligible standalone guided flow to bypass the empty integration guard', () => {
    expect(
      canRenderEmptyGuidedComposer({
        enableGuidedComposerShell: true,
        standaloneCreate: true,
      })
    ).toBe(true);
    expect(
      canRenderEmptyGuidedComposer({
        enableGuidedComposerShell: false,
        standaloneCreate: true,
      })
    ).toBe(false);
    expect(
      canRenderEmptyGuidedComposer({
        enableGuidedComposerShell: true,
        standaloneCreate: false,
      })
    ).toBe(false);
    expect(
      canRenderEmptyGuidedComposer({
        enableGuidedComposerShell: true,
        standaloneCreate: true,
        dummy: true,
      })
    ).toBe(false);
    expect(
      canRenderEmptyGuidedComposer({
        enableGuidedComposerShell: true,
        standaloneCreate: true,
        set: { posts: [{}] },
      })
    ).toBe(false);
  });

  it('mounts the guided composer when allIntegrations is empty', async () => {
    render(
      <AddEditModal
        date={dayjs('2026-08-04T12:00:00Z')}
        integrations={[]}
        allIntegrations={[]}
        reopenModal={() => {}}
        mutate={() => {}}
        standaloneCreate
        enableGuidedComposerShell
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('guided-composer-shell')).toBeTruthy();
    });

    expect(screen.getByTestId('manage-modal')).toBeTruthy();
    expect(useLaunchStore.getState().integrations).toEqual([]);
  });

  it('reseeds destinations after an account connects without resetting the draft', async () => {
    const { rerender } = render(
      <AddEditModal
        date={dayjs('2026-08-04T12:00:00Z')}
        integrations={[]}
        allIntegrations={[]}
        reopenModal={() => {}}
        mutate={() => {}}
        standaloneCreate
        enableGuidedComposerShell
      />
    );

    await waitFor(() => {
      expect(useLaunchStore.getState().global).toHaveLength(1);
    });

    useLaunchStore.getState().setGlobalValueText(0, 'Draft caption');
    useLaunchStore.getState().setGlobalValueMedia(0, [
      {
        id: 'video-1',
        path: 'https://media.example.com/video.mp4',
      },
    ]);

    rerender(
      <AddEditModal
        date={dayjs('2026-08-04T12:00:00Z')}
        integrations={[connectedInstagram]}
        allIntegrations={[connectedInstagram]}
        reopenModal={() => {}}
        mutate={() => {}}
        standaloneCreate
        enableGuidedComposerShell
      />
    );

    await waitFor(() => {
      expect(
        useLaunchStore.getState().integrations.map((integration) => integration.id)
      ).toEqual(['instagram-account']);
    });

    expect(useLaunchStore.getState().global[0]).toMatchObject({
      id: 'generated-post-id',
      content: 'Draft caption',
      media: [
        {
          id: 'video-1',
          path: 'https://media.example.com/video.mp4',
        },
      ],
    });
    expect(screen.getByTestId('guided-composer-shell')).toBeTruthy();
  });

  it('keeps the previous empty guard for the normal composer', () => {
    render(
      <AddEditModal
        date={dayjs('2026-08-04T12:00:00Z')}
        integrations={[]}
        allIntegrations={[]}
        reopenModal={() => {}}
        mutate={() => {}}
        standaloneCreate
        enableGuidedComposerShell={false}
      />
    );

    expect(screen.queryByTestId('guided-composer-shell')).toBeNull();
    expect(screen.queryByTestId('manage-modal')).toBeNull();
  });
});
