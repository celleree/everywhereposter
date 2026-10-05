'use client';

import { PlatformVideoGrid } from '@gitroom/frontend/components/platform-analytics/platform.video.grid';
import { useIntegrationList } from '@gitroom/frontend/components/launches/helpers/use.integration.list';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
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
    <div className="rounded-[12px] border border-newTableBorder bg-newTableHeader p-[20px] mobile:p-[12px] flex flex-col gap-[14px]">
      <div className="flex flex-col gap-[10px]">
        <h2 className="text-[22px] font-[500] text-newTableText">
          {t('connected_platform_videos', 'Connected Platform Videos')}
        </h2>
        <label className="flex max-w-[440px] flex-col gap-[6px] text-[12px] font-[500] text-newTableText/70">
          {t('connected_account', 'Connected account')}
          <select
            value={selectedId}
            onChange={(event) => setSelectedId(event.target.value)}
            className="min-h-[44px] w-full rounded-[8px] border border-newTableBorder bg-newBgColorInner px-[12px] text-[14px] text-newTableText"
          >
            {supportedIntegrations.map((integration) => (
              <option key={integration.id} value={integration.id}>
                {integration.name} — {integration.identifier}
              </option>
            ))}
          </select>
        </label>
      </div>

      <PlatformVideoGrid integration={selectedIntegration} showHeader={false} />
    </div>
  );
};
