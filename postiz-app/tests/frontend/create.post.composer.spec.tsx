import React from 'react';
import { render, screen } from '@testing-library/react';
import dayjs from 'dayjs';
import {
  CreatePostComposer,
  isGuidedComposerShellEnabled,
} from '../../apps/frontend/src/components/create/create.post.composer';

jest.mock(
  '@gitroom/frontend/components/new-launch/add.edit.modal',
  () => {
    const React = require('react');

    return {
      AddEditModal: ({
        enableGuidedComposerShell,
      }: {
        enableGuidedComposerShell?: boolean;
      }) =>
        React.createElement('div', {
          'data-testid': 'add-edit-modal',
          'data-guided-enabled':
            enableGuidedComposerShell === true ? 'true' : 'false',
        }),
    };
  }
);

const renderCreatePostComposer = () =>
  render(
    <CreatePostComposer
      date={dayjs()}
      integrations={[]}
      reopenModal={() => {}}
      mutate={() => {}}
    />
  );

describe('standalone create guided composer entry point', () => {
  const originalFlag = process.env.NEXT_PUBLIC_GUIDED_COMPOSER_SHELL;

  afterEach(() => {
    if (originalFlag === undefined) {
      delete process.env.NEXT_PUBLIC_GUIDED_COMPOSER_SHELL;
    } else {
      process.env.NEXT_PUBLIC_GUIDED_COMPOSER_SHELL = originalFlag;
    }
  });

  it('keeps the complete composer active when the feature flag is absent', () => {
    delete process.env.NEXT_PUBLIC_GUIDED_COMPOSER_SHELL;

    renderCreatePostComposer();

    expect(
      screen.getByTestId('add-edit-modal').getAttribute('data-guided-enabled')
    ).toBe('false');
  });

  it('deliberately enables the shell from the standalone create flow', () => {
    process.env.NEXT_PUBLIC_GUIDED_COMPOSER_SHELL = 'true';

    renderCreatePostComposer();

    expect(
      screen.getByTestId('add-edit-modal').getAttribute('data-guided-enabled')
    ).toBe('true');
  });

  it('accepts only the exact true value', () => {
    expect(isGuidedComposerShellEnabled('true')).toBe(true);
    expect(isGuidedComposerShellEnabled('false')).toBe(false);
    expect(isGuidedComposerShellEnabled('TRUE')).toBe(false);
    expect(isGuidedComposerShellEnabled(undefined)).toBe(false);
  });
});
