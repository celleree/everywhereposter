import { SentryComponent } from '@gitroom/frontend/components/layout/sentry.component';

export const dynamic = 'force-dynamic';
import '../global.scss';
import 'react-tooltip/dist/react-tooltip.css';
import '@copilotkit/react-ui/styles.css';
import LayoutContext from '@gitroom/frontend/components/layout/layout.context';
import { ReactNode } from 'react';
import { Plus_Jakarta_Sans } from 'next/font/google';
import PlausibleProvider from 'next-plausible';
import clsx from 'clsx';
import { VariableContextComponent } from '@gitroom/react/helpers/variable.context';
import { Fragment } from 'react';
import { PHProvider } from '@gitroom/react/helpers/posthog';
import UtmSaver from '@gitroom/helpers/utils/utm.saver';
import { DubAnalytics } from '@gitroom/frontend/components/layout/dubAnalytics';
import { FacebookComponent } from '@gitroom/frontend/components/layout/facebook.component';
import { cookies } from 'next/headers';
import {
  cookieName,
  fallbackLng,
} from '@gitroom/react/translation/i18n.config';
import { HtmlComponent } from '@gitroom/frontend/components/layout/html.component';
import Script from 'next/script';
import { ChangeDirClient } from '@gitroom/frontend/components/new-layout/change.dir.client';
import { Metadata } from 'next';

const jakartaSans = Plus_Jakarta_Sans({
  weight: ['600', '500'],
  style: ['normal', 'italic'],
  subsets: ['latin'],
});

const BRAND_NAME = 'Publish Everywhere';
const BRAND_DESCRIPTION =
  'Publish Everywhere helps you plan, schedule, and publish social media content from one place.';
const SITE_URL = (
  process.env.FRONTEND_URL ||
  process.env.PUBLIC_BASE_URL ||
  process.env.MAIN_URL ||
  'https://publisheverywhere.halowebsites.com'
).replace(/\/$/, '');
const SOCIAL_IMAGE_URL = `${SITE_URL}/branding/pe-logo.png`;
const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  (process.env.NODE_ENV === 'development' && process.env.BACKEND_INTERNAL_URL
    ? '/backend-api'
    : '') ||
  process.env.PUBLIC_BACKEND_URL ||
  '';
const UPLOAD_DIRECTORY =
  process.env.NEXT_PUBLIC_UPLOAD_STATIC_DIRECTORY ||
  process.env.NEXT_PUBLIC_UPLOAD_DIRECTORY ||
  '/uploads';
const parseBooleanEnv = (value?: string) => {
  const normalized = value?.trim().toLowerCase();

  if (!normalized || ['false', '0', 'no'].includes(normalized)) {
    return false;
  }

  return true;
};

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  applicationName: BRAND_NAME,
  description: BRAND_DESCRIPTION,
  openGraph: {
    type: 'website',
    siteName: BRAND_NAME,
    description: BRAND_DESCRIPTION,
    images: [
      {
        url: SOCIAL_IMAGE_URL,
        alt: `${BRAND_NAME} logo`,
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    description: BRAND_DESCRIPTION,
    images: [
      {
        url: SOCIAL_IMAGE_URL,
        alt: `${BRAND_NAME} logo`,
      },
    ],
  },
};

export default async function AppLayout({ children }: { children: ReactNode }) {
  const cookieStore = await cookies();
  const language = cookieStore.get(cookieName)?.value || fallbackLng;
  const Plausible = !!process.env.STRIPE_PUBLISHABLE_KEY
    ? PlausibleProvider
    : Fragment;
  return (
    <html suppressHydrationWarning>
      <head>
        <link rel="icon" type="image/png" href="/branding/favicon.png" />
        <Script
          id="strip-extension-hydration-attributes"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{
            __html: `
              (function () {
                var extensionAttributePattern = /^(data-new-gr-|data-gr-)/;

                function stripExtensionAttributes() {
                  [document.documentElement, document.body].forEach(function (element) {
                    if (!element) {
                      return;
                    }

                    Array.prototype.slice.call(element.attributes).forEach(function (attribute) {
                      if (extensionAttributePattern.test(attribute.name)) {
                        element.removeAttribute(attribute.name);
                      }
                    });
                  });
                }

                stripExtensionAttributes();

                if (typeof MutationObserver === 'undefined') {
                  document.addEventListener('DOMContentLoaded', stripExtensionAttributes, { once: true });
                  return;
                }

                var observer = new MutationObserver(stripExtensionAttributes);
                observer.observe(document.documentElement, {
                  attributes: true,
                  childList: true,
                  subtree: true
                });

                window.addEventListener('load', function () {
                  stripExtensionAttributes();
                  window.setTimeout(function () {
                    observer.disconnect();
                  }, 2000);
                }, { once: true });
              })();
            `,
          }}
        />
        {!!process.env.DATAFAST_WEBSITE_ID && (
          <Script
            data-website-id={process.env.DATAFAST_WEBSITE_ID}
            data-domain="postiz.com"
            src="https://datafa.st/js/script.js"
            strategy="afterInteractive"
          />
        )}
      </head>
      <ChangeDirClient />
      <body
        suppressHydrationWarning
        className={clsx(jakartaSans.className, 'dark text-primary !bg-primary')}
      >
        <VariableContextComponent
          storageProvider={
            process.env.STORAGE_PROVIDER! as 'local' | 'cloudflare'
          }
          environment={process.env.NODE_ENV!}
          backendUrl={BACKEND_URL}
          plontoKey={process.env.NEXT_PUBLIC_POLOTNO!}
          stripeClient={process.env.STRIPE_PUBLISHABLE_KEY!}
          billingEnabled={!!process.env.STRIPE_PUBLISHABLE_KEY}
          discordUrl={process.env.NEXT_PUBLIC_DISCORD_SUPPORT!}
          frontEndUrl={process.env.FRONTEND_URL || process.env.PUBLIC_BASE_URL || ''}
          isGeneral={parseBooleanEnv(process.env.IS_GENERAL)}
          genericOauth={parseBooleanEnv(process.env.POSTIZ_GENERIC_OAUTH)}
          oauthLogoUrl={process.env.NEXT_PUBLIC_POSTIZ_OAUTH_LOGO_URL!}
          oauthDisplayName={process.env.NEXT_PUBLIC_POSTIZ_OAUTH_DISPLAY_NAME!}
          uploadDirectory={UPLOAD_DIRECTORY}
          cloudflareUrl={process.env.CLOUDFLARE_BUCKET_URL || ''}
          mainUrl={process.env.MAIN_URL || process.env.PUBLIC_BASE_URL || ''}
          mcpUrl={process.env.MCP_URL || process.env.PUBLIC_BASE_URL}
          dub={!!process.env.STRIPE_PUBLISHABLE_KEY}
          facebookPixel={process.env.NEXT_PUBLIC_FACEBOOK_PIXEL!}
          telegramBotName={process.env.TELEGRAM_BOT_NAME!}
          neynarClientId={process.env.NEYNAR_CLIENT_ID!}
          isSecured={!parseBooleanEnv(process.env.NOT_SECURED)}
          disableImageCompression={parseBooleanEnv(process.env.DISABLE_IMAGE_COMPRESSION)}
          disableXAnalytics={parseBooleanEnv(process.env.DISABLE_X_ANALYTICS)}
          sentryDsn={process.env.NEXT_PUBLIC_SENTRY_DSN!}
          extensionId={process.env.EXTENSION_ID || ''}
          language={language}
          transloadit={
            process.env.TRANSLOADIT_AUTH && process.env.TRANSLOADIT_TEMPLATE
              ? [
                  process.env.TRANSLOADIT_AUTH!,
                  process.env.TRANSLOADIT_TEMPLATE!,
                ]
              : []
          }
        >
          <SentryComponent>
            {/*<SetTimezone />*/}
            <HtmlComponent />
            <DubAnalytics />
            <FacebookComponent />
            <Plausible
              domain={!!process.env.IS_GENERAL ? 'postiz.com' : 'gitroom.com'}
            >
              <PHProvider
                phkey={process.env.NEXT_PUBLIC_POSTHOG_KEY}
                host={process.env.NEXT_PUBLIC_POSTHOG_HOST}
              >
                <LayoutContext>
                  <UtmSaver />
                  {children}
                </LayoutContext>
              </PHProvider>
            </Plausible>
          </SentryComponent>
        </VariableContextComponent>
      </body>
    </html>
  );
}
