'use client';

import React, { ReactNode, useCallback } from 'react';
import { Logo } from '@gitroom/frontend/components/new-layout/logo';
import { Plus_Jakarta_Sans } from 'next/font/google';
const ModeComponent = dynamic(
  () => import('@gitroom/frontend/components/layout/mode.component'),
  {
    ssr: false,
  }
);

import clsx from 'clsx';
import dynamic from 'next/dynamic';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useVariables } from '@gitroom/react/helpers/variable.context';
import { useSearchParams } from 'next/navigation';
import useSWR from 'swr';
import { CheckPayment } from '@gitroom/frontend/components/layout/check.payment';
import { ToolTip } from '@gitroom/frontend/components/layout/top.tip';
import { ShowMediaBoxModal } from '@gitroom/frontend/components/media/media.component';
import { ShowLinkedinCompany } from '@gitroom/frontend/components/launches/helpers/linkedin.component';
import { MediaSettingsLayout } from '@gitroom/frontend/components/launches/helpers/media.settings.component';
import { Toaster } from '@gitroom/react/toaster/toaster';
import { ShowPostSelector } from '@gitroom/frontend/components/post-url-selector/post.url.selector';
import { NewSubscription } from '@gitroom/frontend/components/layout/new.subscription';
import { Support } from '@gitroom/frontend/components/layout/support';
import { ContinueProvider } from '@gitroom/frontend/components/layout/continue.provider';
import { ContextWrapper } from '@gitroom/frontend/components/layout/user.context';
import { CopilotKit } from '@copilotkit/react-core';
import { MantineWrapper } from '@gitroom/react/helpers/mantine.wrapper';
import { Impersonate } from '@gitroom/frontend/components/layout/impersonate';
import { AnnouncementBanner } from '@gitroom/frontend/components/layout/announcement.banner';
import { Title } from '@gitroom/frontend/components/layout/title';
import { TopMenu } from '@gitroom/frontend/components/layout/top.menu';
import { LanguageComponent } from '@gitroom/frontend/components/layout/language.component';
import { ChromeExtensionComponent } from '@gitroom/frontend/components/layout/chrome.extension.component';
import NotificationComponent from '@gitroom/frontend/components/notifications/notification.component';
import { OrganizationSelector } from '@gitroom/frontend/components/layout/organization.selector';
import { StreakComponent } from '@gitroom/frontend/components/layout/streak.component';
import { PreConditionComponent } from '@gitroom/frontend/components/layout/pre-condition.component';
import { AttachToFeedbackIcon } from '@gitroom/frontend/components/new-layout/sentry.feedback.component';
import { FirstBillingComponent } from '@gitroom/frontend/components/billing/first.billing.component';

const jakartaSans = Plus_Jakarta_Sans({
  weight: ['600', '500', '700'],
  style: ['normal', 'italic'],
  subsets: ['latin'],
});

export const LayoutComponent = ({ children }: { children: ReactNode }) => {
  const fetch = useFetch();

  const { backendUrl, billingEnabled, isGeneral } = useVariables();

  // Feedback icon component attaches Sentry feedback to a top-bar icon when DSN is present
  const searchParams = useSearchParams();
  const load = useCallback(async (path: string) => {
    return await (await fetch(path)).json();
  }, []);
  const { data: user, mutate } = useSWR('/user/self', load, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    revalidateIfStale: false,
    refreshWhenOffline: false,
    refreshWhenHidden: false,
  });

  if (!user) return null;

  return (
    <ContextWrapper user={user}>
      <CopilotKit
        credentials="include"
        runtimeUrl={backendUrl + '/copilot/chat'}
        showDevConsole={false}
      >
        <MantineWrapper>
          <ToolTip />
          <Toaster />
          <CheckPayment check={searchParams.get('check') || ''} mutate={mutate}>
            <ShowMediaBoxModal />
            <ShowLinkedinCompany />
            <MediaSettingsLayout />
            <ShowPostSelector />
            <PreConditionComponent />
            <NewSubscription />
            <ContinueProvider />
            <div
              className={clsx(
                'flex min-h-screen w-full flex-col text-newTextColor p-[12px] mobile:px-[8px] mobile:pt-[8px] mobile:pb-[92px] mobile-app-shell',
                jakartaSans.className
              )}
            >
              <div>{user?.admin ? <Impersonate /> : <div />}</div>
              {user.tier === 'FREE' && isGeneral && billingEnabled ? (
                <FirstBillingComponent />
              ) : (
                <>
                  <AnnouncementBanner />
                  <div className="flex flex-1 gap-[8px] mobile:flex-col">
                    <Support />
                    <div className="flex flex-col bg-newBgColorInner w-[80px] rounded-[12px] mobile:hidden">
                      <div
                        id="left-menu"
                        className={clsx(
                          'fixed h-full w-[64px] start-[17px] flex flex-1 top-0',
                          user?.admin && 'pt-[60px] max-h-[1000px]:w-[500px]'
                        )}
                      >
                        <div className="flex flex-col h-full gap-[32px] flex-1 py-[12px]">
                          <Logo />
                          <TopMenu />
                        </div>
                      </div>
                    </div>
                    <div className="mobile-app-panel flex min-w-0 flex-1 flex-col gap-[1px] overflow-hidden rounded-[12px] bg-newBgLineColor blurMe">
                      <div className="mobile-app-header flex h-[80px] items-center bg-newBgColorInner px-[20px] mobile:grid mobile:h-auto mobile:grid-cols-[minmax(0,1fr)_88px_44px] mobile:gap-x-[2px] mobile:gap-y-[4px] mobile:px-[8px] mobile:py-[8px]">
                        <div className="flex min-w-0 flex-1 items-center gap-[6px] mobile:col-start-1 mobile:row-start-1 mobile:overflow-hidden">
                          <div className="mobile-app-logo hidden origin-left scale-[0.72] mobile:flex">
                            <Logo />
                          </div>
                          <div className="min-w-0 flex-1 overflow-hidden text-[24px] font-[600] mobile:text-[18px] mobile-app-title">
                            <Title />
                          </div>
                        </div>
                        <div className="flex items-center gap-[20px] text-textItemBlur mobile:col-start-1 mobile:row-start-2 mobile:min-w-0 mobile:gap-[8px] mobile-header-secondary">
                          <StreakComponent />
                          <div className="h-[20px] w-[1px] bg-blockSeparator mobile:hidden" />
                          <OrganizationSelector />
                        </div>
                        <div className="flex items-center gap-[20px] text-textItemBlur mobile:col-start-2 mobile:row-start-1 mobile:gap-0">
                          <div className="flex items-center justify-center hover:text-newTextColor mobile:h-[44px] mobile:w-[44px]">
                            <ModeComponent />
                          </div>
                          <div className="h-[20px] w-[1px] bg-blockSeparator mobile:hidden" />
                          <LanguageComponent />
                        </div>
                        <div className="flex items-center gap-[20px] text-textItemBlur mobile:col-span-2 mobile:col-start-2 mobile:row-start-2 mobile:justify-end mobile:gap-[8px] mobile-header-secondary">
                          <ChromeExtensionComponent />
                          <div className="h-[20px] w-[1px] bg-blockSeparator mobile:hidden" />
                          <AttachToFeedbackIcon />
                        </div>
                        <div className="text-textItemBlur mobile:col-start-3 mobile:row-start-1">
                          <NotificationComponent />
                        </div>
                      </div>
                      <div className="flex min-h-0 flex-1 gap-[1px] mobile:flex-col">
                        {children}
                      </div>
                    </div>
                  </div>
                  <div className="mobile-bottom-nav fixed inset-x-[8px] bottom-[8px] z-[90] hidden mobile:block">
                    <div className="rounded-[16px] border border-newBorder bg-newBgColorInner/95 p-[8px] shadow-menu backdrop-blur">
                      <TopMenu mobileNav={true} />
                    </div>
                  </div>
                </>
              )}
            </div>
          </CheckPayment>
        </MantineWrapper>
      </CopilotKit>
    </ContextWrapper>
  );
};
