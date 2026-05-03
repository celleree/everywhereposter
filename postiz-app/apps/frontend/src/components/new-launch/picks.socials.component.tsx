'use client';

import { FC } from 'react';
import clsx from 'clsx';
import SafeImage from '@gitroom/react/helpers/safe.image';
import { useLaunchStore } from '@gitroom/frontend/components/new-launch/store';
import { useShallow } from 'zustand/react/shallow';
import { useExistingData } from '@gitroom/frontend/components/launches/helpers/use.existing.data';
import ImageWithFallback from '@gitroom/react/helpers/image.with.fallback';

export const PicksSocialsComponent: FC<{ toolTip?: boolean }> = ({
  toolTip,
}) => {
  const existing = useExistingData();

  const {
    locked,
    addOrRemoveSelectedIntegration,
    integrations,
    selectedIntegrations,
  } = useLaunchStore(
    useShallow((state) => ({
      integrations: state.integrations,
      selectedIntegrations: state.selectedIntegrations,
      addOrRemoveSelectedIntegration: state.addOrRemoveSelectedIntegration,
      locked: state.locked,
    }))
  );

  return (
    <div className={clsx('flex', locked && 'opacity-50 pointer-events-none')}>
      <div className="innerComponent flex w-full flex-1">
        <div className="grid w-full grid-cols-1 gap-[12px] md:grid-cols-2 xl:grid-cols-3">
          {integrations
            .filter((integration) => {
              if (existing.integration) {
                return integration.id === existing.integration;
              }
              return !integration.inBetweenSteps && !integration.disabled;
            })
            .map((integration) => {
              const selected =
                selectedIntegrations.findIndex(
                  (item) => item.integration.id === integration.id
                ) > -1;

              return (
                <button
                  key={integration.id}
                  type="button"
                  {...(toolTip && {
                    'data-tooltip-id': 'tooltip',
                    'data-tooltip-content': integration.name,
                  })}
                  onClick={() => {
                    if (existing.integration) {
                      return;
                    }
                    addOrRemoveSelectedIntegration(integration, {});
                  }}
                  className={clsx(
                    'group relative flex min-h-[88px] w-full items-center gap-[14px] rounded-[16px] border bg-newBgColor px-[14px] py-[14px] text-start transition-all xs:flex-col xs:items-start xs:gap-[10px]',
                    existing.integration && 'cursor-default',
                    !existing.integration && 'hover:border-[#7C4DFF] hover:bg-newBgLineColor/70',
                    selected
                      ? 'border-[#7C4DFF] bg-[#22163B]'
                      : 'border-newBorder'
                  )}
                >
                  <div className="relative">
                    <ImageWithFallback
                      fallbackSrc="/no-picture.jpg"
                      src={integration.picture || '/no-picture.jpg'}
                      className={clsx(
                        'h-[52px] w-[52px] rounded-full border object-cover transition-all',
                        selected ? 'border-black' : 'border-transparent'
                      )}
                      alt={integration.identifier}
                      width={52}
                      height={52}
                    />
                    {integration.identifier === 'youtube' ? (
                      <img
                        src="/icons/platforms/youtube.svg"
                        className="absolute -bottom-[2px] -end-[4px] z-10 min-w-[18px]"
                        width={18}
                      />
                    ) : (
                      <SafeImage
                        src={`/icons/platforms/${integration.identifier}.png`}
                        className="absolute -bottom-[2px] -end-[4px] z-10 h-[18px] w-[18px] rounded-[5px]"
                        alt={integration.identifier}
                        width={18}
                        height={18}
                      />
                    )}
                  </div>
                  <div className="min-w-0 flex-1 xs:w-full">
                    <div className="truncate text-[15px] font-[700] text-white">
                      {integration.name}
                    </div>
                    <div className="mt-[2px] text-[13px] text-textColor/70">
                      {integration.display || integration.identifier}
                    </div>
                    {!!integration.customer?.name && (
                      <div className="mt-[6px] inline-flex max-w-full rounded-full bg-newBgLineColor px-[10px] py-[4px] text-[11px] font-[600] uppercase tracking-[0.04em] text-textColor/70">
                        {integration.customer.name}
                      </div>
                    )}
                  </div>
                  <div
                    className={clsx(
                      'flex h-[28px] min-w-[86px] items-center justify-center rounded-full border px-[12px] text-[12px] font-[700] uppercase tracking-[0.04em] xs:w-full',
                      selected
                        ? 'border-[#9F7AEA] bg-[#612BD3] text-white'
                        : 'border-newBorder text-textColor/65'
                    )}
                  >
                    {selected ? 'Selected' : 'Select'}
                  </div>
                </button>
              );
            })}
        </div>
      </div>
    </div>
  );
};
