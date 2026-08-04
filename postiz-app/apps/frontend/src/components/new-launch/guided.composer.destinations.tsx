'use client';

import React, { FC, useMemo } from 'react';
import clsx from 'clsx';
import { useShallow } from 'zustand/react/shallow';
import { Integrations } from '@gitroom/frontend/components/launches/calendar.context';
import { useLaunchStore } from '@gitroom/frontend/components/new-launch/store';

const formatPlatformName = (identifier: string) =>
  identifier
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());

export const getGuidedAvailableIntegrations = (
  integrations: Integrations[]
) =>
  integrations.filter(
    (integration) => !integration.disabled && !integration.inBetweenSteps
  );

export const GuidedComposerDestinations: FC<{
  disabled?: boolean;
}> = ({ disabled = false }) => {
  const {
    integrations,
    selectedIntegrations,
    addOrRemoveSelectedIntegration,
    setSelectedIntegrations,
  } = useLaunchStore(
    useShallow((state) => ({
      integrations: state.integrations,
      selectedIntegrations: state.selectedIntegrations,
      addOrRemoveSelectedIntegration: state.addOrRemoveSelectedIntegration,
      setSelectedIntegrations: state.setSelectedIntegrations,
    }))
  );

  const availableIntegrations = useMemo(
    () => getGuidedAvailableIntegrations(integrations),
    [integrations]
  );
  const selectedIds = useMemo(
    () =>
      new Set(
        selectedIntegrations.map((selected) => selected.integration.id)
      ),
    [selectedIntegrations]
  );
  const selectedCount = availableIntegrations.filter((integration) =>
    selectedIds.has(integration.id)
  ).length;
  const groupedIntegrations = useMemo(() => {
    const groups = new Map<string, Integrations[]>();

    availableIntegrations.forEach((integration) => {
      const platform = integration.identifier || 'other';
      groups.set(platform, [...(groups.get(platform) || []), integration]);
    });

    return Array.from(groups.entries()).sort(([left], [right]) =>
      left.localeCompare(right)
    );
  }, [availableIntegrations]);

  const selectAll = () => {
    const currentSettings = new Map(
      selectedIntegrations.map((selected) => [
        selected.integration.id,
        selected.settings,
      ])
    );

    setSelectedIntegrations(
      availableIntegrations.map((integration) => ({
        selectedIntegrations: integration,
        settings: currentSettings.get(integration.id) || {},
      }))
    );
  };

  return (
    <div className="mx-auto w-full max-w-[1600px] px-[40px] py-[40px] mobile:px-[12px] mobile:py-[18px]">
      <section className="rounded-[20px] border border-newBorder bg-newBgColorInner p-[24px] mobile:rounded-[16px] mobile:p-[16px]">
        <div className="flex items-start justify-between gap-[18px] mobile:flex-col">
          <div>
            <h2 className="text-[18px] font-[700] text-white">
              Choose accounts
            </h2>
            <p className="mt-[6px] text-[13px] leading-[1.5] text-textColor/65">
              Choose the platforms and connected accounts for this post.
            </p>
            <p className="mt-[6px] text-[12px] text-textColor/50">
              {selectedCount} of {availableIntegrations.length}{' '}
              {availableIntegrations.length === 1 ? 'account' : 'accounts'} selected
            </p>
          </div>

          <div className="flex gap-[8px] mobile:w-full">
            <button
              type="button"
              disabled={
                disabled ||
                availableIntegrations.length === 0 ||
                selectedCount === availableIntegrations.length
              }
              onClick={selectAll}
              className="rounded-[9px] border border-newBorder bg-newBgColor px-[14px] py-[9px] text-[12px] font-[700] text-white disabled:cursor-not-allowed disabled:opacity-45 mobile:flex-1"
            >
              Select all
            </button>
            <button
              type="button"
              disabled={disabled || selectedCount === 0}
              onClick={() => setSelectedIntegrations([])}
              className="rounded-[9px] border border-newBorder bg-newBgColor px-[14px] py-[9px] text-[12px] font-[700] text-white disabled:cursor-not-allowed disabled:opacity-45 mobile:flex-1"
            >
              Deselect all
            </button>
          </div>
        </div>

        {availableIntegrations.length === 0 ? (
          <div className="mt-[20px] rounded-[14px] border border-dashed border-newBorder bg-newBgColor px-[18px] py-[34px] text-center">
            <div className="text-[14px] font-[700] text-white">
              No connected accounts available
            </div>
            <p className="mx-auto mt-[6px] max-w-[480px] text-[12px] leading-[1.5] text-textColor/55">
              Connect at least one supported social account before continuing.
            </p>
          </div>
        ) : (
          <div className="mt-[24px] flex flex-col gap-[26px]">
            {groupedIntegrations.map(([platform, platformIntegrations]) => (
              <section key={platform}>
                <div className="mb-[10px] flex items-center justify-between gap-[12px]">
                  <h3 className="text-[14px] font-[700] text-white">
                    {formatPlatformName(platform)}
                  </h3>
                  <span className="text-[11px] text-textColor/50">
                    {platformIntegrations.length}{' '}
                    {platformIntegrations.length === 1 ? 'account' : 'accounts'}
                  </span>
                </div>

                <div className="grid grid-cols-1 gap-[12px] md:grid-cols-2 xl:grid-cols-3">
                  {platformIntegrations.map((integration) => {
                    const selected = selectedIds.has(integration.id);
                    const existingSettings = selectedIntegrations.find(
                      (item) => item.integration.id === integration.id
                    )?.settings;
                    const platformName = formatPlatformName(
                      integration.identifier || 'other'
                    );

                    return (
                      <button
                        key={integration.id}
                        type="button"
                        aria-pressed={selected}
                        aria-label={`${selected ? 'Deselect' : 'Select'} ${
                          integration.name
                        } on ${platformName}`}
                        disabled={disabled}
                        onClick={() =>
                          addOrRemoveSelectedIntegration(
                            integration,
                            existingSettings || {}
                          )
                        }
                        className={clsx(
                          'group flex min-h-[88px] w-full items-center gap-[14px] rounded-[16px] border bg-newBgColor px-[14px] py-[14px] text-start transition-all disabled:cursor-not-allowed disabled:opacity-55 xs:flex-col xs:items-start xs:gap-[10px]',
                          !disabled && 'hover:border-ai hover:bg-boxHover',
                          selected
                            ? 'border-ai bg-newBgLineColor'
                            : 'border-newBorder'
                        )}
                      >
                        <div className="relative h-[52px] w-[52px] min-w-[52px]">
                          <img
                            src={integration.picture || '/no-picture.jpg'}
                            alt=""
                            width={52}
                            height={52}
                            className={clsx(
                              'h-[52px] w-[52px] rounded-full border object-cover',
                              selected ? 'border-black' : 'border-transparent'
                            )}
                          />
                          <img
                            src={
                              integration.identifier === 'youtube'
                                ? '/icons/platforms/youtube.svg'
                                : `/icons/platforms/${integration.identifier}.png`
                            }
                            alt={platformName}
                            width={18}
                            height={18}
                            className="absolute -bottom-[2px] -end-[4px] z-10 h-[18px] w-[18px] rounded-[5px]"
                          />
                        </div>

                        <div className="min-w-0 flex-1 xs:w-full">
                          <div className="truncate text-[15px] font-[700] text-white">
                            {integration.name}
                          </div>
                          <div className="mt-[2px] text-[13px] text-textColor/70">
                            {integration.display || platformName}
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
                              ? 'border-ai bg-newBgLineColor text-textColor'
                              : 'border-newBorder text-textColor/65'
                          )}
                        >
                          {selected ? 'Selected' : 'Select'}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};
