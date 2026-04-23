'use client';

import { PlatformVideoGrid } from '@gitroom/frontend/components/platform-analytics/platform.video.grid';
import { useIntegrationList } from '@gitroom/frontend/components/launches/helpers/use.integration.list';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import clsx from 'clsx';
import { FC, useEffect, useMemo, useState } from 'react';

type MediaIntegration = {
  id: string;
  name: string;
  identifier: string;
  picture?: string;
  canListMedia?: boolean;
};

export const ConnectedPlatformMedia: FC = () => {
  const { data: integrations = [] } = useIntegrationList();
  const t = useT();

  const supportedIntegrations = useMemo(
    () =>
      (integrations as MediaIntegration[]).filter(
        (integration) => integration.canListMedia
      ),
    [integrations]
  );

  const [selectedId, setSelectedId] = useState<string>('');

  useEffect(() => {
    if (!supportedIntegrations.length) {
      setSelectedId('');
      return;
    }

    if (
      !selectedId ||
      !supportedIntegrations.some((integration) => integration.id === selectedId)
    ) {
      setSelectedId(supportedIntegrations[0].id);
    }
  }, [supportedIntegrations, selectedId]);

  const selectedIntegration = useMemo(
    () =>
      supportedIntegrations.find((integration) => integration.id === selectedId),
    [supportedIntegrations, selectedId]
  );

  if (!supportedIntegrations.length || !selectedIntegration) {
    return null;
  }

  return (
    <div className="rounded-[12px] border border-newTableBorder bg-newTableHeader p-[20px] flex flex-col gap-[18px]">
      <div className="flex flex-col gap-[4px]">
        <h2 className="text-[22px] font-[500] text-newTableText">
          {t('connected_platform_videos', 'Connected Platform Videos')}
        </h2>
        <div className="text-[13px] text-newTableText/60">
          {t(
            'connected_platform_videos_description',
            'Browse videos that were already published on your connected channels before they were linked here.'
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-[12px]">
        {supportedIntegrations.map((integration) => (
          <button
            key={integration.id}
            onClick={() => setSelectedId(integration.id)}
            className={clsx(
              'min-w-[180px] rounded-[12px] border p-[12px] flex items-center gap-[12px] text-left transition-all',
              selectedId === integration.id
                ? 'border-[#612bd3] bg-[#612bd3]/10'
                : 'border-newTableBorder bg-newBgColorInner hover:border-[#612bd3]/40'
            )}
          >
            <div className="relative shrink-0">
              <img
                src={integration.picture || '/no-picture.jpg'}
                alt={integration.name}
                className="w-[36px] h-[36px] rounded-[10px] object-cover"
              />
              <img
                src={`/icons/platforms/${integration.identifier}.png`}
                alt={integration.identifier}
                className="w-[18px] h-[18px] rounded-[6px] absolute -bottom-[4px] -right-[4px] border border-newTableHeader bg-newTableHeader"
              />
            </div>
            <div className="min-w-0">
              <div className="text-[14px] font-[500] text-newTableText truncate">
                {integration.name}
              </div>
              <div className="text-[12px] text-newTableText/55 truncate">
                {integration.identifier}
              </div>
            </div>
          </button>
        ))}
      </div>

      <PlatformVideoGrid integration={selectedIntegration} showHeader={false} />
    </div>
  );
};
