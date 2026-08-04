'use client';

import 'reflect-metadata';

import { AddProviderButton } from '@gitroom/frontend/components/launches/add.provider.component';
import { LoadingComponent } from '@gitroom/frontend/components/layout/loading';
import {
  CreatePostComposer,
  isGuidedComposerShellEnabled,
} from '@gitroom/frontend/components/create/create.post.composer';
import { useIntegrationList } from '@gitroom/frontend/components/launches/helpers/use.integration.list';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import clsx from 'clsx';
import dayjs from 'dayjs';
import { useCallback, useMemo, useState } from 'react';
import useSWR from 'swr';

type CreateSet = {
  id: string;
  name: string;
  content: string;
};

const swrOptions = {
  revalidateOnFocus: false,
  revalidateOnReconnect: false,
  revalidateIfStale: false,
  revalidateOnMount: true,
  refreshWhenHidden: false,
  refreshWhenOffline: false,
};

export const CreateComponent = () => {
  const fetch = useFetch();
  const t = useT();
  const [selectedSetId, setSelectedSetId] = useState('');
  const [composerKey, setComposerKey] = useState(0);
  const guidedComposerEnabled = isGuidedComposerShellEnabled();

  const {
    data: integrations = [],
    isLoading: integrationsLoading,
    mutate: mutateIntegrations,
  } = useIntegrationList();

  const loadDate = useCallback(async () => {
    return (await (await fetch('/posts/find-slot')).json()).date;
  }, [fetch]);

  const loadSets = useCallback(async () => {
    return (await fetch('/sets')).json();
  }, [fetch]);

  const { data: nextSlot, isLoading: dateLoading } = useSWR(
    'create-find-slot',
    loadDate,
    swrOptions
  );

  const { data: sets = [], isLoading: setsLoading } = useSWR<CreateSet[]>(
    'create-sets',
    loadSets,
    swrOptions
  );

  const selectedSet = useMemo(
    () => sets.find((set) => set.id === selectedSetId),
    [sets, selectedSetId]
  );

  const parsedSet = useMemo(() => {
    if (!selectedSet?.content) {
      return undefined;
    }

    try {
      return JSON.parse(selectedSet.content);
    } catch {
      return undefined;
    }
  }, [selectedSet]);

  const activeIntegrations = useMemo(
    () =>
      integrations.filter(
        (integration: any) => !integration.disabled && !integration.inBetweenSteps
      ),
    [integrations]
  );

  const onComposerComplete = useCallback(() => {
    setSelectedSetId('');
    setComposerKey((key) => key + 1);
  }, []);

  if (integrationsLoading || dateLoading) {
    return (
      <div className="flex flex-1 items-center justify-center bg-newBgColorInner p-[20px]">
        <LoadingComponent />
      </div>
    );
  }

  if (!activeIntegrations.length && !guidedComposerEnabled) {
    return (
      <div className="flex flex-1 items-center justify-center bg-newBgColorInner p-[20px]">
        <div className="flex max-w-[520px] flex-col items-center rounded-[18px] border border-newBorder bg-newBgColor px-[24px] py-[28px] text-center">
          <div className="text-[22px] font-[700] text-white">
            {t('connect_a_channel_to_create', 'Connect a channel to create')}
          </div>
          <div className="mt-[8px] text-[14px] leading-[1.5] text-textColor/65">
            {t(
              'connect_a_channel_to_create_description',
              'Add at least one social channel, then come back here to upload media and create your post.'
            )}
          </div>
          <div className="mt-[20px] w-full max-w-[260px]">
            <AddProviderButton update={() => mutateIntegrations()} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-newBgColorInner mobile:overflow-y-auto">
      <div className="flex flex-wrap items-center justify-between gap-[12px] border-b border-newBorder bg-newBgColorInner px-[20px] py-[14px] mobile:px-[12px] mobile:py-[10px]">
        <div className="flex min-w-0 flex-col">
          <div className="text-[16px] font-[700] text-white mobile:text-[15px]">
            {t('create_post', 'Create Post')}
          </div>
          <div className="mt-[3px] text-[13px] text-textColor/65 mobile:hidden">
            {t(
              'create_post_inline_set_hint',
              'Start blank or preload a saved Set without leaving the composer.'
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-[12px] mobile:w-full mobile:flex-col mobile:items-stretch">
          <div className="w-[260px] mobile:w-full">
            <AddProviderButton update={() => mutateIntegrations()} />
          </div>
          {!!sets.length && (
            <label className="flex items-center gap-[10px] text-[13px] text-textColor/70 mobile:w-full mobile:flex-col mobile:items-start">
              <span>{t('saved_set', 'Saved Set')}</span>
              <select
                value={selectedSetId}
                onChange={(event) => setSelectedSetId(event.target.value)}
                disabled={setsLoading}
                className={clsx(
                  'h-[40px] min-w-[260px] rounded-[8px] border border-newBorder bg-newBgColor px-[12px] text-[14px] text-white outline-none mobile:w-full',
                  setsLoading && 'opacity-70'
                )}
              >
                <option value="">{t('blank_post', 'Blank post')}</option>
                {sets.map((set) => (
                  <option key={set.id} value={set.id}>
                    {set.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </div>
      <div className="flex min-h-0 flex-1 mobile:block mobile:flex-none">
        <CreatePostComposer
          key={`${selectedSetId || 'blank'}-${nextSlot}-${composerKey}`}
          allIntegrations={integrations.map((integration: any) => ({
            ...integration,
          }))}
          {...(parsedSet ? { set: parsedSet } : {})}
          reopenModal={() => {}}
          mutate={() => {}}
          customClose={onComposerComplete}
          standaloneCreate={true}
          integrations={integrations}
          date={dayjs.utc(nextSlot).local()}
        />
      </div>
    </div>
  );
};
