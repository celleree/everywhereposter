import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

jest.mock('@copilotkit/react-core', () => ({
  CopilotKit: ({ children }: { children: React.ReactNode }) => children,
  useCopilotAction: () => undefined,
  useCopilotContext: () => ({
    copilotApiConfig: { publicApiKey: 'test-key' },
    langGraphInterruptAction: null,
  }),
  useCopilotMessagesContext: () => ({
    setMessages: jest.fn(),
  }),
  useCopilotReadable: () => undefined,
}));

jest.mock('@copilotkit/react-ui', () => ({
  CopilotChat: () => null,
  useChatContext: () => ({
    icons: {
      sendIcon: <span>Send icon</span>,
      stopIcon: <span>Stop icon</span>,
      uploadIcon: <span>Upload icon</span>,
    },
    labels: {
      placeholder: 'Type a message',
      stopGenerating: 'Stop generating',
    },
  }),
}));

jest.mock('@copilotkit/runtime-client-gql', () => ({
  MessageRole: {
    Assistant: 'assistant',
    User: 'user',
  },
  TextMessage: class TextMessage {
    constructor(value: unknown) {
      Object.assign(this, value);
    }
  },
}));

jest.mock('@gitroom/frontend/components/agents/agent', () => {
  const React = require('react');

  return {
    PropertiesContext: React.createContext({
      properties: [],
      allProperties: [],
    }),
  };
});

jest.mock('@gitroom/frontend/components/layout/new-modal', () => ({
  useModals: () => ({ openModal: jest.fn() }),
}));

jest.mock('@gitroom/react/helpers/variable.context', () => ({
  useVariables: () => ({ backendUrl: 'http://blocked.test' }),
}));

jest.mock('next/navigation', () => ({
  useParams: () => ({ id: 'new' }),
}));

jest.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () => jest.fn(),
}));

jest.mock('@gitroom/frontend/components/new-launch/add.edit.modal', () => ({
  AddEditModal: () => null,
}));

jest.mock(
  '@gitroom/frontend/components/launches/helpers/use.existing.data',
  () => ({ ExistingDataContextProvider: ({ children }: any) => children })
);

jest.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}));

import { PropertiesContext } from '@gitroom/frontend/components/agents/agent';
import { NewInput } from '../../apps/frontend/src/components/agents/agent.chat';
import { Input } from '../../apps/frontend/src/components/agents/agent.input';

const inputProps = () => ({
  inProgress: false,
  isVisible: true,
  onSend: jest.fn(),
  onStop: jest.fn(),
  onChange: jest.fn(),
});

describe('Agent chat input', () => {
  it('keeps Enter, Shift+Enter, and composition semantics', () => {
    const props = inputProps();
    render(<Input {...props} />);

    const textarea = screen.getByPlaceholderText('Type a message');
    fireEvent.change(textarea, { target: { value: 'hello' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });
    expect(props.onSend).not.toHaveBeenCalled();

    fireEvent.compositionStart(textarea);
    fireEvent.keyDown(textarea, { key: 'Enter' });
    expect(props.onSend).not.toHaveBeenCalled();

    fireEvent.compositionEnd(textarea);
    fireEvent.keyDown(textarea, { key: 'Enter' });
    expect(props.onSend).toHaveBeenCalledWith('hello');
  });

  it('keeps stop separate from send and labels both controls', () => {
    const sendProps = inputProps();
    const view = render(<Input {...sendProps} />);
    expect(
      (
        screen.getByRole('button', {
          name: 'Send message',
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);

    view.rerender(<Input {...sendProps} inProgress />);
    fireEvent.click(screen.getByRole('button', { name: 'Stop generating' }));
    expect(sendProps.onStop).toHaveBeenCalledTimes(1);
    expect(sendProps.onSend).not.toHaveBeenCalled();
  });

  it('preserves private channel and browser-time context without media controls', () => {
    const onSend = jest.fn();
    render(
      <PropertiesContext.Provider
        value={{
          properties: [
            {
              id: 'channel-1',
              identifier: 'linkedin-page',
              name: 'Acme',
              picture: 'avatar.png',
              additionalSettings: { visibility: 'PUBLIC' },
            },
          ],
          allProperties: [],
        }}
      >
        <NewInput {...inputProps()} onSend={onSend} />
      </PropertiesContext.Provider>
    );

    const textarea = screen.getByPlaceholderText('Type a message');
    fireEvent.change(textarea, { target: { value: 'Post tomorrow' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    expect(onSend).toHaveBeenCalledTimes(1);
    const outgoing = onSend.mock.calls[0][0];
    expect(outgoing).toContain('Available channels:\n1. Linkedin: Acme');
    expect(outgoing).toContain('Browser timezone:');
    expect(outgoing).toContain('Browser-local current date/time:');
    expect(outgoing).toContain('"id":"channel-1"');
    expect(outgoing).not.toContain('[--Media--]');
    expect(screen.queryByText('Insert Media')).toBeNull();
    expect(screen.queryByText('Design Media')).toBeNull();
  });
});
