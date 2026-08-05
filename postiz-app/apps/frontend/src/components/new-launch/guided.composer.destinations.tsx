'use client';

import React, { FC, useMemo, useState } from 'react';
import clsx from 'clsx';
import { useShallow } from 'zustand/react/shallow';
import ImageWithFallback from '@gitroom/react/helpers/image.with.fallback';
import { Integrations } from '@gitroom/frontend/components/launches/calendar.context';
import { useLaunchStore } from '@gitroom/frontend/components/new-launch/store';

type GuidedPlatformIdentity = {
  key: string;
  label: string;
};

const GUIDED_PLATFORM_IDENTITIES: Record<string, GuidedPlatformIdentity> = {
  devto: { key: 'devto', label: 'Dev.to' },
  x: { key: 'x', label: 'X' },
  linkedin: { key: 'linkedin', label: 'LinkedIn' },
  'linkedin-page': { key: 'linkedin', label: 'LinkedIn' },
  reddit: { key: 'reddit', label: 'Reddit' },
  medium: { key: 'medium', label: 'Medium' },
  hashnode: { key: 'hashnode', label: 'Hashnode' },
  facebook: { key: 'facebook', label: 'Facebook' },
  instagram: { key: 'instagram', label: 'Instagram' },
  'instagram-standalone': { key: 'instagram', label: 'Instagram' },
  youtube: { key: 'youtube', label: 'YouTube' },
  tiktok: { key: 'tiktok', label: 'TikTok' },
  pinterest: { key: 'pinterest', label: 'Pinterest' },
  dribbble: { key: 'dribbble', label: 'Dribbble' },
  threads: { key: 'threads', label: 'Threads' },
  discord: { key: 'discord', label: 'Discord' },
  slack: { key: 'slack', label: 'Slack' },
  kick: { key: 'kick', label: 'Kick' },
  twitch: { key: 'twitch', label: 'Twitch' },
  mastodon: { key: 'mastodon', label: 'Mastodon' },
  bluesky: { key: 'bluesky', label: 'Bluesky' },
  lemmy: { key: 'lemmy', label: 'Lemmy' },
  wrapcast: { key: 'wrapcast', label: 'Warpcast' },
  telegram: { key: 'telegram', label: 'Telegram' },
  nostr: { key: 'nostr', label: 'Nostr' },
  vk: { key: 'vk', label: 'VK' },
  wordpress: { key: 'wordpress', label: 'WordPress' },
  listmonk: { key: 'listmonk', label: 'Listmonk' },
  gmb: { key: 'gmb', label: 'Google Business' },
  moltbook: { key: 'moltbook', label: 'Moltbook' },
  skool: { key: 'skool', label: 'Skool' },
  whop: { key: 'whop', label: 'Whop' },
  mewe: { key: 'mewe', label: 'MeWe' },
};

const formatUnknownPlatformName = (identifier: string) =>
  identifier
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());

export const getGuidedPlatformIdentity = (
  identifier?: string
): GuidedPlatformIdentity => {
  const normalizedIdentifier = identifier || 'other';

  return (
    GUIDED_PLATFORM_IDENTITIES[normalizedIdentifier] || {
      key: normalizedIdentifier,
      label: formatUnknownPlatformName(normalizedIdentifier),
    }
  );
};

export const getGuidedAvailableIntegrations = (
  integrations: Integrations[]
) =>
  integrations.filter(
    (integration) => !integration.disabled && !integration.inBetweenSteps
  );

const GuidedPlatformIcon: FC<{
  identifier?: string;
  platformName: string;
}> = ({ identifier, platformName }) => {
  const [failed, setFailed] = useState(false);
  const iconSource =
    identifier === 'youtube'
      ? '/icons/platforms/youtube.svg'
      : `/icons/platforms/${identifier || 'other'}.png`;

  if (failed) {
    return (
      <span
        role="img"
        aria-label={`${platformName} icon unavailable`}
        data-testid={`platform-icon-fallback-${platformName}`}
        className="absolute -bottom-[2px] -end-[4px] z-10 flex h-[18px] w-[18px] items-center justify-center rounded-[5px] border border-newBorder bg-newSettings text-[9px] font-[800] uppercase text-textColor/75"
      >
        {platformName.slice(0, 1) || '?'}
      </span>
    );
  }

  return (
    <img
      src={iconSource}
      alt={platformName}
      width={18}
      height={18}
      data-testid={`platform-icon-${platformName}`}
      onError={() => setFailed(true)}
      className="absolute -bottom-[2px] -end-[4px] z-10 h-[18px] w-[18px] rounded-[5px]"
    />
  );
};

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
    const groups = new Map<
      string,
      { identity: GuidedPlatformIdentity; integrations: Integrations[] }
    >();

    availableIntegrations.forEach((integration) => {
      const identity = getGuidedPlatformIdentity(integration.identifier);
      const existingGroup = groups.get(identity.key);

      groups.set(identity.key, {
        identity,
        integrations: [
          ...(existingGroup?.integrations || []),
          integration,
        ],
      });
    });

    return Array.from(groups.values()).sort((left, right) =>
      left.identity.label.localeCompare(right.identity.label)
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
            {groupedIntegrations.map(
              ({ identity, integrations: platformIntegrations }) => (
                <section key={identity.key}>
                  <div className="mb-[10px] flex items-center justify-between gap-[12px]">
                    <h3 className="text-[14px] font-[700] text-white">
                      {identity.label}
                    </h3>
                    <span className="text-[11px] text-textColor/50">
                      {platformIntegrations.length}{' '}
                      {platformIntegrations.length === 1
                        ? 'account'
                        : 'accounts'}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 gap-[12px] md:grid-cols-2 xl:grid-cols-3">
                    {platformIntegrations.map((integration) => {
                      const selected = selectedIds.has(integration.id);
                      const existingSettings = selectedIntegrations.find(
                        (item) => item.integration.id === integration.id
                      )?.settings;
                      const platformName = getGuidedPlatformIdentity(
                        integration.identifier
                      ).label;

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
                            <ImageWithFallback
                              fallbackSrc="/no-picture.jpg"
                              src={integration.picture || '/no-picture.jpg'}
                              alt={integration.name}
                              width={52}
                              height={52}
                              className={clsx(
                                'h-[52px] w-[52px] rounded-full border object-cover',
                                selected
                                  ? 'border-black'
                                  : 'border-transparent'
                              )}
                            />
                            <GuidedPlatformIcon
                              key={integration.identifier || 'other'}
                              identifier={integration.identifier}
                              platformName={platformName}
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
              )
            )}
          </div>
        )}
      </section>
    </div>
  );
};
