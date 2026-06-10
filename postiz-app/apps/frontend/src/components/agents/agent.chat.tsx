'use client';

import React, {
  FC,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { CopilotChat, CopilotKitCSSProperties } from '@copilotkit/react-ui';
import {
  InputProps,
  UserMessageProps,
} from '@copilotkit/react-ui/dist/components/chat/props';
import { Input } from '@gitroom/frontend/components/agents/agent.input';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import {
  CopilotKit,
  useCopilotAction,
  useCopilotMessagesContext,
} from '@copilotkit/react-core';
import {
  MediaPortal,
  PropertiesContext,
} from '@gitroom/frontend/components/agents/agent';
import { useVariables } from '@gitroom/react/helpers/variable.context';
import { useParams } from 'next/navigation';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { MessageRole, TextMessage } from '@copilotkit/runtime-client-gql';
import { AddEditModal } from '@gitroom/frontend/components/new-launch/add.edit.modal';
import dayjs from 'dayjs';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import { ExistingDataContextProvider } from '@gitroom/frontend/components/launches/helpers/use.existing.data';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

export const AgentChat: FC = () => {
  const { backendUrl } = useVariables();
  const params = useParams<{ id: string }>();
  const { properties } = useContext(PropertiesContext);
  const t = useT();

  return (
    <CopilotKit
      key={params.id}
      {...(params.id === 'new' ? {} : { threadId: params.id })}
      credentials="include"
      runtimeUrl={backendUrl + '/copilot/agent'}
      showDevConsole={false}
      agent="postiz"
      properties={{
        integrations: properties,
      }}
    >
      <Hooks />
      <LoadMessages id={params.id} />
      <div
        style={
          {
            '--copilot-kit-primary-color': 'var(--new-btn-text)',
            '--copilot-kit-background-color': 'var(--new-bg-color)',
          } as CopilotKitCSSProperties
        }
        className="trz agent bg-newBgColorInner flex flex-col gap-[15px] transition-all flex-1 items-center relative"
      >
        <div className="absolute left-0 w-full h-full pb-[20px]">
          <CopilotChat
            className="w-full h-full"
            labels={{
              title: t('your_assistant', 'Your Assistant'),
              initial: t('agent_welcome_message', `Hello, I am your Postiz agent 🙌🏻.
              
I can schedule a post or multiple posts to multiple channels and generate pictures and videos.

You can select the channels you want to use from the left menu.

You can see your previous conversations from the right menu.

You can also use me as an MCP Server, check Settings >> Public API
`),
            }}
            UserMessage={Message}
            Input={NewInput}
          />
        </div>
      </div>
    </CopilotKit>
  );
};

const LoadMessages: FC<{ id: string }> = ({ id }) => {
  const { setMessages } = useCopilotMessagesContext();
  const fetch = useFetch();

  const loadMessages = useCallback(async (idToSet: string) => {
    const data = await (await fetch(`/copilot/${idToSet}/list`)).json();
    const uiMessages = Array.isArray(data?.uiMessages) ? data.uiMessages : [];
    const rawMessages = Array.isArray(data?.messages) ? data.messages : [];
    const sourceMessages = uiMessages.length > 0 ? uiMessages : rawMessages;

    setMessages(toTextMessages(sourceMessages));
  }, []);

  useEffect(() => {
    if (id === 'new') {
      setMessages([]);
      return;
    }
    loadMessages(id);
  }, [id]);

  return null;
};

const normalizeRole = (role: any): MessageRole | null => {
  if (typeof role !== 'string') {
    return null;
  }

  const normalizedRole = role.trim().toLowerCase();
  if (normalizedRole === 'user') {
    return MessageRole.User;
  }

  if (normalizedRole === 'assistant') {
    return MessageRole.Assistant;
  }

  return null;
};

const extractMessageText = (message: any): string | null => {
  if (typeof message?.content === 'string') {
    return message.content;
  }

  if (typeof message?.text === 'string') {
    return message.text;
  }

  if (Array.isArray(message?.content)) {
    const textParts = message.content
      .map((part: any) => part?.text)
      .filter((text: any) => typeof text === 'string');

    return textParts.length > 0 ? textParts.join('\n') : null;
  }

  if (typeof message?.content?.text === 'string') {
    return message.content.text;
  }

  return null;
};

const toTextMessages = (messages: any[]): TextMessage[] => {
  return messages.flatMap((message: any) => {
    const role = normalizeRole(message?.role);
    const content = extractMessageText(message);

    if (!role || content === null) {
      return [];
    }

    return [
      new TextMessage({
        content,
        role,
      }),
    ];
  });
};

const Message: FC<UserMessageProps> = (props) => {
  const convertContentToImagesAndVideo = useMemo(() => {
    const content =
      typeof props.message?.content === 'string' ? props.message.content : '';

    return content
      .replace(/Video: (http.*mp4\n)/g, (match, p1) => {
        return `<video controls class="h-[150px] w-[150px] rounded-[8px] mb-[10px]"><source src="${p1.trim()}" type="video/mp4">Your browser does not support the video tag.</video>`;
      })
      .replace(/Image: (http.*\n)/g, (match, p1) => {
        return `<img src="${p1.trim()}" class="h-[150px] w-[150px] max-w-full border border-newBgColorInner" />`;
      })
      .replace(/\[\-\-Media\-\-\](.*)\[\-\-Media\-\-\]/g, (match, p1) => {
        return `<div class="flex justify-center mt-[20px]">${p1}</div>`;
      })
      .replace(
        /(\[--integrations--\][\s\S]*?\[--integrations--\])/g,
        () => {
          return ``;
        }
      );
  }, [props.message?.content]);
  return (
    <div
      className="copilotKitMessage copilotKitUserMessage min-w-[300px]"
      dangerouslySetInnerHTML={{ __html: convertContentToImagesAndVideo }}
    />
  );
};
const NewInput: FC<InputProps> = (props) => {
  const [media, setMedia] = useState([] as { path: string; id: string }[]);
  const [value, setValue] = useState('');
  const { properties, allProperties } = useContext(PropertiesContext);
  return (
    <>
      <MediaPortal
        value={value}
        media={media}
        setMedia={(e) => setMedia(e.target.value)}
      />
      <Input
        {...props}
        onChange={setValue}
        onSend={(text) => {
          const integrations = properties.length ? properties : allProperties;
          const browserTimeZone =
            Intl.DateTimeFormat().resolvedOptions().timeZone;
          const browserCurrentDateTime = dayjs().format(
            'YYYY-MM-DD HH:mm:ss Z'
          );
          const channels = integrations.map((p, index) => {
            const platform = String(p.identifier || p.platform || '');
            const platformLabel = (platform.split('-')[0] || 'Channel')
              .split(/[\s_]+/)
              .filter(Boolean)
              .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
              .join(' ');
            const accountName = p.name || p.display || '';

            return {
              number: index + 1,
              id: p.id,
              platform,
              platformLabel,
              channel: accountName || platform,
              accountName,
              profilePicture: p.picture,
              additionalSettings: p.additionalSettings,
            };
          });
          const channelList = channels
            .map(
              (channel) =>
                `${channel.number}. ${channel.platformLabel}${
                  channel.accountName ? `: ${channel.accountName}` : ''
                }`
            )
            .join('\n');
          const send = props.onSend(
            text +
              (media.length > 0
                ? '\n[--Media--]' +
                  media
                    .map((m) =>
                      m.path.indexOf('mp4') > -1
                        ? `Video: ${m.path}`
                        : `Image: ${m.path}`
                    )
                    .join('\n') +
                  '\n[--Media--]'
                : '') +
              `
${
  channels.length
    ? `[--integrations--]
Available channels:
${channelList}

Use the numbered list above as private channel lookup context. Show the full Available channels list only when asking the user to choose a channel or when the channel selection is missing or ambiguous. If the user selected valid number(s), platform(s), or account name(s), do not repeat the full list; confirmations should mention only the selected channel/account. If the user answers with numbers like "1", "1 and 3", or "2, 4", match those numbers to this list. Preserve name/platform matching too.

Browser timezone: ${browserTimeZone}
Browser-local current date/time: ${browserCurrentDateTime} (${browserTimeZone})
For this in-app browser chat, anchor relative/natural schedule dates like "today", "tomorrow", "next Tuesday", and "this Friday" to the browser-local current date/time above, not the server UTC date. Use the browser timezone above unless the user explicitly specifies another timezone. Convert the final scheduled date/time to UTC before using manualPosting.date. In confirmation text, show the local date/time and timezone used. Prefer ISO-style local dates like "2026-06-09 at 9:00 AM America/Los_Angeles"; do not invent or guess weekday labels. If you include a weekday, it must match the final local calendar date.

Structured channel data: ${JSON.stringify(channels)}
[--integrations--]`
    : ``
}`
          );
          setValue('');
          setMedia([]);
          return send;
        }}
      />
    </>
  );
};

export const Hooks: FC = () => {
  const modals = useModals();

  useCopilotAction({
    name: 'manualPosting',
    description:
      'This tool should be triggered when the user wants to manually add the generated post',
    parameters: [
      {
        name: 'list',
        type: 'object[]',
        description:
          'list of posts to schedule to different social media (integration ids)',
        attributes: [
          {
            name: 'integrationId',
            type: 'string',
            description: 'The integration id',
          },
          {
            name: 'date',
            type: 'string',
            description: 'UTC date of the scheduled post',
          },
          {
            name: 'settings',
            type: 'object',
            description: 'Settings for the integration [input:settings]',
          },
          {
            name: 'posts',
            type: 'object[]',
            description: 'list of posts / comments (one under another)',
            attributes: [
              {
                name: 'content',
                type: 'string',
                description: 'the content of the post',
              },
              {
                name: 'attachments',
                type: 'object[]',
                description: 'list of attachments',
                attributes: [
                  {
                    name: 'id',
                    type: 'string',
                    description: 'id of the attachment',
                  },
                  {
                    name: 'path',
                    type: 'string',
                    description: 'url of the attachment',
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
    renderAndWaitForResponse: ({ args, status, respond }) => {
      if (status === 'executing') {
        return <OpenModal args={args} respond={respond} />;
      }

      return null;
    },
  });
  return null;
};

const OpenModal: FC<{
  respond: (value: any) => void;
  args: {
    list: {
      integrationId: string;
      date: string;
      settings?: Record<string, any>;
      posts: { content: string; attachments: { id: string; path: string }[] }[];
    }[];
  };
}> = ({ args, respond }) => {
  const modals = useModals();
  const { properties } = useContext(PropertiesContext);
  const startModal = useCallback(async () => {
    for (const integration of args.list) {
      await new Promise((res) => {
        const group = makeId(10);
        modals.openModal({
          id: 'add-edit-modal',
          closeOnClickOutside: false,
          removeLayout: true,
          closeOnEscape: false,
          withCloseButton: false,
          askClose: true,
          size: '80%',
          title: ``,
          classNames: {
            modal: 'w-[100%] max-w-[1400px] text-textColor',
          },
          children: (
            <ExistingDataContextProvider
              value={{
                group,
                integration: integration.integrationId,
                integrationPicture:
                  properties.find((p) => p.id === integration.integrationId)
                    .picture || '',
                settings: integration.settings || {},
                posts: integration.posts.map((p) => ({
                  approvedSubmitForOrder: 'NO',
                  content: p.content,
                  createdAt: new Date().toISOString(),
                  state: 'DRAFT',
                  id: makeId(10),
                  settings: JSON.stringify(integration.settings || {}),
                  group,
                  integrationId: integration.integrationId,
                  integration: properties.find(
                    (p) => p.id === integration.integrationId
                  ),
                  publishDate: dayjs.utc(integration.date).toISOString(),
                  image: p.attachments.map((a) => ({
                    id: a.id,
                    path: a.path,
                  })),
                })),
              }}
            >
              <AddEditModal
                date={dayjs.utc(integration.date)}
                allIntegrations={properties}
                integrations={properties.filter(
                  (p) => p.id === integration.integrationId
                )}
                onlyValues={integration.posts.map((p) => ({
                  content: p.content,
                  id: makeId(10),
                  settings: integration.settings || {},
                  image: p.attachments.map((a) => ({
                    id: a.id,
                    path: a.path,
                  })),
                }))}
                reopenModal={() => {}}
                mutate={() => res(true)}
              />
            </ExistingDataContextProvider>
          ),
        });
      });
    }

    respond('User scheduled all the posts');
  }, [args, respond, properties]);

  useEffect(() => {
    startModal();
  }, []);
  return (
    <div onClick={() => respond('continue')}>
      Opening manually ${JSON.stringify(args)}
    </div>
  );
};
