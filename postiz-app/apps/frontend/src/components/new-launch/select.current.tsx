'use client';

import { FC, useCallback } from 'react';
import { useLaunchStore } from '@gitroom/frontend/components/new-launch/store';
import clsx from 'clsx';
import SafeImage from '@gitroom/react/helpers/safe.image';
import { useShallow } from 'zustand/react/shallow';
import { GlobalIcon } from '@gitroom/frontend/components/ui/icons';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { Integrations } from '@gitroom/frontend/components/launches/calendar.context';
import { useDecisionModal } from '@gitroom/frontend/components/layout/new-modal';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';

export const SelectCurrent: FC = () => {
  const modals = useDecisionModal();
  const t = useT();
  const {
    selectedIntegrations,
    current,
    global,
    internal,
    setCurrent,
    locked,
    setHide,
    addInternalValue,
    setInternalValue,
    addOrRemoveSelectedIntegration,
  } = useLaunchStore(
    useShallow((state) => ({
      selectedIntegrations: state.selectedIntegrations,
      addOrRemoveSelectedIntegration: state.addOrRemoveSelectedIntegration,
      addInternalValue: state.addInternalValue,
      setInternalValue: state.setInternalValue,
      global: state.global,
      internal: state.internal,
      current: state.current,
      setCurrent: state.setCurrent,
      locked: state.locked,
      setHide: state.setHide,
    }))
  );

  const removeSocial = useCallback(
    (sIntegration: Integrations) => async (e: any) => {
      e.stopPropagation();
      e.preventDefault();
      const open = await modals.open({
        title: 'Remove Social Account',
        description:
          'Are you sure you want to remove this social from scheduling?',
      });

      if (!open) {
        return;
      }

      addOrRemoveSelectedIntegration(sIntegration, {});
    },
    [addOrRemoveSelectedIntegration, modals]
  );

  const addInstagramFirstComment = useCallback(
    (integration: Integrations) => (event: any) => {
      event.stopPropagation();
      event.preventDefault();

      const existingInternal = internal.find(
        (item) => item.integration.id === integration.id
      );
      const sourceValues = existingInternal?.integrationValue.length
        ? existingInternal.integrationValue
        : global;
      const mainPost = sourceValues[0] || {
        id: makeId(10),
        delay: 0,
        content: '',
        media: [],
      };
      const sanitizedValues = sourceValues.length
        ? sourceValues.map((value, index) => ({
            ...value,
            media: index > 0 ? [] : value.media || [],
          }))
        : [mainPost];

      if (!existingInternal) {
        addInternalValue(0, integration.id, [
          ...sanitizedValues,
          ...(sanitizedValues.length > 1
            ? []
            : [
                {
                  id: makeId(10),
                  delay: 0,
                  content: '',
                  media: [],
                },
              ]),
        ]);
      } else if (sanitizedValues.length > 1) {
        setInternalValue(integration.id, sanitizedValues);
      } else {
        addInternalValue(0, integration.id, [
          {
            id: makeId(10),
            delay: 0,
            content: '',
            media: [],
          },
        ]);
      }

      setHide(true);
      setCurrent(integration.id);
    },
    [addInternalValue, global, internal, setCurrent, setHide, setInternalValue]
  );

  return (
    <div
      className={clsx(
        'flex flex-col gap-[12px] select-none',
        locked && 'opacity-50 pointer-events-none'
      )}
    >
      <div className="text-[13px] font-[600] uppercase tracking-[0.04em] text-textColor/55">
        Review versions
      </div>
      <div className="flex gap-[12px] overflow-x-auto pb-[4px] scrollbar scrollbar-thumb-tableBorder scrollbar-track-secondary">
        <button
          type="button"
          onClick={() => {
            setHide(true);
            setCurrent('global');
          }}
          className={clsx(
            'flex min-w-[220px] items-center gap-[12px] rounded-[16px] border px-[14px] py-[14px] text-start transition-all',
            current === 'global'
              ? 'border-[#FC69FF] bg-[#24142F]'
              : 'border-newBorder bg-newBgColor hover:border-[#FC69FF]/60'
          )}
        >
          <div
            className={clsx(
              'flex h-[44px] w-[44px] items-center justify-center rounded-[14px] bg-newBgLineColor',
              current === 'global' ? 'text-[#FC69FF]' : 'text-textColor/70'
            )}
          >
            <GlobalIcon />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-[700] text-white">
              Global version
            </div>
            <div className="mt-[2px] text-[13px] text-textColor/65">
              Shared caption and media used unless you customize a platform.
            </div>
          </div>
        </button>
        {selectedIntegrations.map(({ integration }) => {
          const isInstagram =
            integration.identifier === 'instagram' ||
            integration.identifier === 'instagram-standalone';
          const existingInternal = internal.find(
            (item) => item.integration.id === integration.id
          );
          const hasInstagramFirstComment =
            (existingInternal?.integrationValue || global).length > 1;

          return (
            <div
              role="button"
              tabIndex={0}
              onClick={() => {
                setHide(true);
                setCurrent(integration.id);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  setHide(true);
                  setCurrent(integration.id);
                }
              }}
              key={integration.id}
              className={clsx(
                'group relative flex min-w-[250px] items-center gap-[12px] rounded-[16px] border px-[14px] py-[14px] text-start transition-all',
                current === integration.id
                  ? 'border-[#FC69FF] bg-[#24142F]'
                  : 'border-newBorder bg-newBgColor hover:border-[#FC69FF]/60'
              )}
            >
              <div className="relative">
                <SafeImage
                  src={integration.picture || '/no-picture.jpg'}
                  className="h-[44px] w-[44px] rounded-full object-cover"
                  alt={integration.identifier}
                  width={44}
                  height={44}
                  onError={(e) => {
                    e.currentTarget.src = '/no-picture.jpg';
                    e.currentTarget.srcset = '/no-picture.jpg';
                  }}
                />
                {integration.identifier === 'youtube' ? (
                  <img
                    src="/icons/platforms/youtube.svg"
                    className="absolute bottom-0 end-0 z-10 min-w-[14px]"
                    width={14}
                  />
                ) : (
                  <SafeImage
                    src={`/icons/platforms/${integration.identifier}.png`}
                    className="absolute bottom-0 end-0 z-10 h-[14px] w-[14px] rounded-[4px]"
                    alt={integration.identifier}
                    width={14}
                    height={14}
                  />
                )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[15px] font-[700] text-white">
                {integration.name}
              </div>
              <div className="mt-[2px] text-[13px] text-textColor/65">
                Platform review
              </div>
              <div className="mt-[8px] flex items-center gap-[8px]">
                <IsGlobal id={integration.id} />
                {current === integration.id && (
                  <span className="inline-flex rounded-full bg-[#612BD3] px-[10px] py-[4px] text-[11px] font-[700] uppercase tracking-[0.04em] text-white">
                    Active
                  </span>
                )}
              </div>
              {isInstagram && (
                <button
                  type="button"
                  onClick={addInstagramFirstComment(integration)}
                  className="mt-[10px] inline-flex max-w-full items-center rounded-[8px] border border-[#D82D7E]/70 bg-[#D82D7E]/15 px-[10px] py-[6px] text-[12px] font-[700] leading-[16px] text-white transition-colors hover:bg-[#D82D7E]/30"
                >
                  {hasInstagramFirstComment
                    ? t(
                        'edit_instagram_first_comment',
                        'Edit Instagram first comment'
                      )
                    : t(
                        'add_instagram_first_comment',
                        'Add Instagram first comment'
                      )}
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={removeSocial(integration)}
              className="flex h-[28px] w-[28px] items-center justify-center rounded-full border border-newBorder bg-newBgLineColor text-[11px] font-[700] text-textColor/70 opacity-0 transition-opacity group-hover:opacity-100"
            >
              X
            </button>
          </div>
          );
        })}
      </div>
    </div>
  );
};

export const IsGlobal: FC<{ id: string }> = ({ id }) => {
  const t = useT();
  const { isInternal } = useLaunchStore(
    useShallow((state) => ({
      isInternal: !!state.internal.find((p) => p.integration.id === id),
    }))
  );

  if (!isInternal) {
    return null;
  }

  return (
    <span
      data-tooltip-id="tooltip"
      data-tooltip-content={t(
        'no_longer_global_mode',
        'No longer in global mode'
      )}
      className="inline-flex rounded-full bg-[#FC69FF]/15 px-[10px] py-[4px] text-[11px] font-[700] uppercase tracking-[0.04em] text-[#FC69FF]"
    >
      Custom
    </span>
  );
};
