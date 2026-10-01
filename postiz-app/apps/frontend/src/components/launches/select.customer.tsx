'use client';

import { uniqBy } from 'lodash';
import React, { FC, useCallback, useMemo, useRef, useState } from 'react';
import { Integrations } from '@gitroom/frontend/components/launches/calendar.context';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import clsx from 'clsx';
import { useClickOutside } from '@mantine/hooks';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useLaunchStore } from '@gitroom/frontend/components/new-launch/store';
import { useShallow } from 'zustand/react/shallow';
import {
  UserIcon,
  DropdownArrowIcon,
} from '@gitroom/frontend/components/ui/icons';

export const SelectCustomer: FC<{
  onChange: (value: string) => void;
  integrations: Integrations[];
  customer?: string;
}> = (props) => {
  const { onChange, integrations, customer: currentCustomer } = props;
  const { setCurrent } = useLaunchStore(
    useShallow((state) => ({
      setCurrent: state.setCurrent,
    }))
  );
  const toaster = useToaster();
  const t = useT();
  const [pos, setPos] = useState<any>({});
  const [open, setOpen] = useState(false);
  const ref = useClickOutside(() => {
    if (open) {
      setOpen(false);
    }
  });

  const openClose = useCallback(() => {
    if (open) {
      setOpen(false);
      return;
    }

    const { x, y, width, height } = ref.current?.getBoundingClientRect();
    setPos({ top: y + height, left: x });
    setOpen(true);
  }, [open]);

  const totalCustomers = useMemo(() => {
    return uniqBy(integrations, (i) => i?.customer?.id).length;
  }, [integrations]);
  const selectedName = integrations.find(
    (integration) => integration.customer?.id === currentCustomer
  )?.customer?.name;
  const allChannels = t('all_channels', 'All channels');
  const displayName =
    selectedName ||
    (currentCustomer
      ? t('filtered_channels', 'Filtered channels')
      : allChannels);
  if (totalCustomers <= 1 && !currentCustomer) {
    return null;
  }

  return (
    <div className="relative select-none z-[500]" ref={ref}>
      <button
        type="button"
        aria-label={
          t('select_customer_tooltip', 'Select Customer') + ': ' + displayName
        }
        aria-expanded={open}
        data-tooltip-id="tooltip"
        data-tooltip-content={t('select_customer_tooltip', 'Select Customer')}
        onClick={openClose}
        className={clsx(
          'relative z-[20] cursor-pointer min-h-[44px] rounded-[8px] pl-[16px] pr-[12px] gap-[8px] border flex items-center mobile:max-w-full',
          open || currentCustomer ? 'border-ai' : 'border-newColColor'
        )}
      >
        <div>
          <UserIcon />
        </div>
        <div>
          <DropdownArrowIcon rotated={open} />
        </div>
        <span className="hidden min-w-0 truncate text-[13px] mobile:block">
          {displayName}
        </span>
      </button>
      {open && (
        <div
          style={pos}
          className="flex flex-col fixed pt-[12px] bg-newBgColorInner menu-shadow min-w-[250px]"
        >
          <div className="text-[14px] font-[600] px-[12px] mb-[5px]">
            {t('customers', 'Customers')}
          </div>
          <button
            type="button"
            onClick={() => {
              onChange('');
              setOpen(false);
              setCurrent('global');
            }}
            className="px-[12px] text-start hover:bg-newBgColor text-[14px] font-[500] min-h-[44px]"
          >
            {allChannels}
          </button>
          {uniqBy(integrations, (u) => u?.customer?.name)
            .filter((f) => f.customer?.name)
            .map((p) => (
              <div
                onClick={() => {
                  toaster.show(
                    t('customer_socials_selected', 'Customer socials selected'),
                    'success'
                  );
                  onChange(p.customer?.id);
                  setOpen(false);
                  setCurrent('global');
                }}
                key={p.customer?.id}
                className="p-[12px] hover:bg-newBgColor text-[14px] font-[500] h-[32px] flex items-center"
              >
                {p.customer?.name}
              </div>
            ))}
        </div>
      )}
    </div>
  );
};
