'use client';

import { ConnectedPlatformMedia } from '@gitroom/frontend/components/media/connected-platform-media';
import { MediaBox } from '@gitroom/frontend/components/media/media.component';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import clsx from 'clsx';
import { useState } from 'react';

export const MediaLayoutComponent = () => {
  const [source, setSource] = useState<'library' | 'posted'>('library');
  const t = useT();

  return (
    <div className="bg-newBgColorInner p-[20px] mobile:p-[12px] flex flex-1 flex-col gap-[15px] transition-all">
      <div className="flex rounded-[8px] border border-newTableBorder p-[4px]">
        {(['library', 'posted'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            aria-pressed={source === tab}
            onClick={() => setSource(tab)}
            className={clsx(
              'min-h-[44px] flex-1 rounded-[6px] px-[12px] text-[14px] font-[600] text-textColor',
              source === tab && 'bg-boxFocused text-textItemFocused'
            )}
          >
            {tab === 'library'
              ? t('media_library', 'Media Library')
              : t('posted_media', 'Posted Media')}
          </button>
        ))}
      </div>
      <MediaBox
        setMedia={() => {}}
        closeModal={() => {}}
        standalone={true}
        source={source}
        onSourceChange={setSource}
        hideSourceTabs={true}
      />
      {source === 'posted' && <ConnectedPlatformMedia />}
    </div>
  );
};
