'use client';

import React from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import dynamic from 'next/dynamic';
import EmailNotificationsComponent from '@gitroom/frontend/components/settings/email-notifications.component';
import ShortlinkPreferenceComponent from '@gitroom/frontend/components/settings/shortlink-preference.component';
import CalendarPreferencesComponent from '@gitroom/frontend/components/settings/calendar-preferences.component';

const MetricComponent = dynamic(
  () => import('@gitroom/frontend/components/settings/metric.component'),
  {
    ssr: false,
  }
);

export const GlobalSettings = () => {
  const t = useT();
  return (
    <div className="flex flex-col">
      <h3 className="text-[20px]">{t('global_settings', 'Global Settings')}</h3>
      <section className="my-[16px] flex flex-col gap-[16px] rounded-[4px] border border-fifth bg-sixth p-[24px]">
        <h4>{t('appearance', 'Appearance')}</h4>
        <label className="flex items-center gap-[8px] text-[14px]">
          <input type="checkbox" disabled />
          {t('use_device_theme_unavailable', 'Use device theme (currently unavailable)')}
        </label>
      </section>
      <MetricComponent />
      <CalendarPreferencesComponent />
      <EmailNotificationsComponent />
      <ShortlinkPreferenceComponent />
    </div>
  );
};
