import React, { FC, useCallback, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import { IntegrationContext } from '@gitroom/frontend/components/launches/helpers/use.integration';
import { useIntegrationList } from '@gitroom/frontend/components/launches/helpers/use.integration.list';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { continueProviderList } from '@gitroom/frontend/components/new-launch/providers/continue-provider/list';
import type { ContinueProviderProps } from '@gitroom/frontend/components/new-launch/providers/continue-provider/with-continue-provider';
import { newDayjs } from '@gitroom/frontend/components/layout/set.timezone';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
export const Null: FC<{
  onSave: (data: any) => Promise<void>;
  existingId: string[];
}> = () => null;
export const ContinueProvider: FC = () => {
  const { data: integrations } = useIntegrationList();
  const searchParams = useSearchParams();
  const added = searchParams.get('added');
  const continueId = searchParams.get('continue');
  const router = useRouter();
  const { openModal, closeById } = useModals();
  const hasList = !!integrations;

  useEffect(() => {
    if (!added || !continueId || !hasList) return;
    const id = makeId(20);
    let active = true;
    const provider = continueProviderList[added as keyof typeof continueProviderList] || Null;
    openModal({
      id,
      title: 'Configure Channel',
      onClose: () => {
        if (!active) return;
        active = false;
        const url = new URL(window.location.href);
        if (url.searchParams.get('added') !== added || url.searchParams.get('continue') !== continueId) return;
        url.searchParams.delete('added');
        url.searchParams.delete('continue');
        router.replace(`${url.pathname}${url.search}${url.hash}`, { scroll: false });
      },
      children: (close) => <ModalContent added={added} continueId={continueId} provider={provider} closeModal={close} />,
    });
    return () => {
      active = false;
      closeById(id);
    };
  }, [added, continueId, hasList, openModal, closeById, router]);

  return null;
};

const ModalContent: FC<{
  continueId: string;
  added: string;
  provider: FC<ContinueProviderProps>;
  closeModal: () => void;
}> = ({ continueId, added, provider: Provider, closeModal }) => {
  const fetch = useFetch();
  const { data: integrations, mutate } = useIntegrationList();

  const onSave = useCallback(
    async (data: any) => {
      await fetch(`/integrations/provider/${continueId}/connect`, {
        method: 'POST',
        body: JSON.stringify(data),
      });
      void mutate();
      closeModal();
    },
    [continueId, closeModal, fetch, mutate]
  );

  return (
    <IntegrationContext.Provider
      value={{
        date: newDayjs(),
        value: [],
        allIntegrations: [],
        integration: {
          editor: 'normal',
          additionalSettings: '',
          display: '',
          time: [
            {
              time: 0,
            },
          ],
          id: continueId,
          type: '',
          name: '',
          picture: '',
          inBetweenSteps: true,
          changeNickName: false,
          changeProfilePicture: false,
          identifier: added,
        },
      }}
    >
      <Provider onSave={onSave} existingId={(integrations || []).map((channel: { internalId: string }) => channel.internalId)} />
    </IntegrationContext.Provider>
  );
};
