'use client';

import { useCallback, useEffect } from 'react';
import { Slider } from '@gitroom/react/form/slider';
import clsx from 'clsx';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useIntegration } from '@gitroom/frontend/components/launches/helpers/use.integration';
import { useSettings } from '@gitroom/frontend/components/launches/helpers/use.values';
import { Textarea } from '@gitroom/react/form/textarea';

export const ThreadFinisher = () => {
  const integration = useIntegration();
  const { register, watch, setValue, getValues } = useSettings();
  const t = useT();

  const defaultThreadFinisher = t('that_a_wrap', {
    username:
      integration.integration?.display || integration.integration?.name,
  });

  useEffect(() => {
    register('active_thread_finisher');
    register('thread_finisher');

    if (typeof getValues('active_thread_finisher') === 'undefined') {
      setValue('active_thread_finisher', false, {
        shouldDirty: false,
        shouldTouch: false,
        shouldValidate: false,
      });
    }

    if (typeof getValues('thread_finisher') === 'undefined') {
      setValue('thread_finisher', defaultThreadFinisher, {
        shouldDirty: false,
        shouldTouch: false,
        shouldValidate: false,
      });
    }
  }, [defaultThreadFinisher, getValues, register, setValue]);

  const slider = !!watch('active_thread_finisher');
  const handleSliderChange = useCallback(
    (value: string) => {
      const nextValue = value === 'on';

      if (slider === nextValue) {
        return;
      }

      setValue('active_thread_finisher', nextValue);
    },
    [setValue, slider]
  );

  return (
    <div className="flex flex-col gap-[10px] border-tableBorder border p-[15px] rounded-lg mb-5">
      <div className="flex items-center">
        <div className="flex-1">Add a thread finisher</div>
        <div>
          <Slider
            value={slider ? 'on' : 'off'}
            onChange={handleSliderChange}
            fill={true}
          />
        </div>
      </div>
      <div className="w-full mt-[20px]">
        <div
          className={clsx(
            !slider && 'relative opacity-25 pointer-events-none editor'
          )}
        >
          <div>
            <div className="flex gap-[4px]">
              <div className="flex-1 editor text-textColor">
                <Textarea
                  name="thread_finisher"
                  label=""
                  className="min-h-[160px]"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
