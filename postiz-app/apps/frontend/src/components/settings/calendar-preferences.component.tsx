'use client';

import React, { useCallback, useState } from 'react';
import { Slider } from '@gitroom/react/form/slider';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import {
  getShowImportedPostsInCalendar,
  setShowImportedPostsInCalendar,
} from '@gitroom/frontend/components/launches/calendar-preferences';

const CalendarPreferencesComponent = () => {
  const t = useT();
  const toaster = useToaster();
  const [showImportedPosts, setShowImportedPosts] = useState(
    getShowImportedPostsInCalendar
  );

  const handleShowImportedPostsChange = useCallback(
    (value: 'on' | 'off') => {
      const enabled = value === 'on';
      setShowImportedPosts(enabled);
      setShowImportedPostsInCalendar(enabled);
      toaster.show(t('settings_updated', 'Settings updated'), 'success');
    },
    [toaster, t]
  );

  return (
    <div className="my-[16px] mt-[16px] bg-sixth border-fifth border rounded-[4px] p-[24px] flex flex-col gap-[24px]">
      <div className="mt-[4px]">
        {t('calendar_settings', 'Calendar Settings')}
      </div>
      <div className="flex items-center justify-between">
        <div className="flex flex-col">
          <div className="text-[14px]">
            {t(
              'show_imported_posts_in_calendar',
              'Show imported posts in Calendar'
            )}
          </div>
        </div>
        <Slider
          value={showImportedPosts ? 'on' : 'off'}
          onChange={handleShowImportedPostsChange}
          fill={true}
        />
      </div>
    </div>
  );
};

export default CalendarPreferencesComponent;
