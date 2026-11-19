'use client';

import { FC, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { HttpStatusCode } from 'axios';
import { useRouter } from 'next/navigation';
import { Redirect } from '@gitroom/frontend/components/layout/redirect';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import dayjs from 'dayjs';
import { continueProviderList } from '@gitroom/frontend/components/new-launch/providers/continue-provider/list';
import { IntegrationContext } from '@gitroom/frontend/components/launches/helpers/use.integration';
import { newDayjs } from '@gitroom/frontend/components/layout/set.timezone';
import { useVariables } from '@gitroom/react/helpers/variable.context';
import {
  clearIntegrationReturnRoute,
  getIntegrationReturnRoute,
} from '@gitroom/frontend/components/launches/helpers/integration.return-route';

interface TwoStepState {
  integrationId: string;
  onboarding: boolean;
  pages: any[];
  returnURL?: string;
}

interface SuccessState {
  message: string;
}

function firstValue(value: unknown) {
  if (Array.isArray(value)) {
    return typeof value[0] === 'string' ? value[0] : '';
  }

  return typeof value === 'string' ? value : '';
}

function decodeProviderMessage(value: string) {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '));
  } catch {
    return value.replace(/\+/g, ' ');
  }
}

function getProviderErrorMessage(params: Record<string, unknown>) {
  const description =
    firstValue(params.error_description) ||
    firstValue(params.errorMessage) ||
    firstValue(params.message);
  const error = firstValue(params.error);

  if (!description && !error) {
    return '';
  }

  return decodeProviderMessage(description || error);
}

function appendFailureParams(route: string, path: string) {
  const params = path.includes('?') ? path.split('?')[1] : '';

  if (!params) {
    return route;
  }

  const [routeWithoutHash, hash] = route.split('#');
  const separator = routeWithoutHash.includes('?') ? '&' : '?';

  return `${routeWithoutHash}${separator}${params}${hash ? `#${hash}` : ''}`;
}

export const ContinueIntegration: FC<{
  provider: string;
  searchParams: any;
  logged: boolean;
}> = (props) => {
  const { provider, searchParams, logged } = props;
  const { push, replace } = useRouter();
  const t = useT();
  const fetch = useFetch();
  const { extensionId, backendUrl } = useVariables();
  const [error, setError] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [twoStepState, setTwoStepState] = useState<TwoStepState | null>(null);
  const [successState, setSuccessState] = useState<SuccessState | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [failureRedirectUrl, setFailureRedirectUrl] = useState('/launches');
  const flowVersion = useRef(0);
  const exited = useRef(false);
  const saving = useRef(false);
  const isMeta = provider === 'facebook' || provider === 'instagram';

  const getFailureFallback = useCallback(
    (onboarding?: boolean) =>
      onboarding || searchParams.onboarding === 'true'
        ? '/launches?onboarding=true'
        : '/launches',
    [searchParams.onboarding]
  );

  const completeFailure = useCallback(
    (message: string | null, path = '', fallback?: string) => {
      const returnRoute = getIntegrationReturnRoute(
        fallback || getFailureFallback()
      );
      setFailureRedirectUrl(appendFailureParams(returnRoute, path));
      clearIntegrationReturnRoute();
      setErrorMessage(message);
      setError(true);
    },
    [getFailureFallback]
  );

  const backToApp = useCallback(() => {
    if (exited.current) return;
    exited.current = true;
    flowVersion.current += 1;
    const returnRoute = error
      ? failureRedirectUrl
      : getIntegrationReturnRoute(getFailureFallback(twoStepState?.onboarding));
    clearIntegrationReturnRoute();
    replace(returnRoute);
  }, [error, failureRedirectUrl, getFailureFallback, replace, twoStepState]);

  // Helper to handle navigation - redirects if logged or returnURL exists, otherwise shows inline
  const navigateOrShow = useCallback(
    (path: string, returnURL: string | undefined, successMessage: string) => {
      clearIntegrationReturnRoute();

      if (returnURL) {
        // If returnURL exists, always redirect to it with the path params
        const params = path.includes('?') ? path.split('?')[1] : '';
        push(params ? `${returnURL}?${params}` : returnURL);
      } else if (logged) {
        // If logged in without returnURL, use normal navigation
        push(path);
      } else {
        // If not logged in without returnURL, show success inline
        setSuccessState({ message: successMessage });
      }
    },
    [logged, push]
  );
  const modifiedParams = useMemo(() => {
    if (provider === 'mewe') {
      return {
        state: searchParams.state || '',
        code: searchParams.loginRequestToken || '',
        refresh: searchParams.refresh || '',
      };
    }
    if (provider === 'x') {
      return {
        state: searchParams.oauth_token || '',
        code: searchParams.oauth_verifier || '',
        refresh: searchParams.refresh || '',
      };
    }

    if (provider === 'vk') {
      return {
        ...searchParams,
        state: searchParams.state || '',
        code: searchParams.code + '&&&&' + searchParams.device_id,
      };
    }

    if (provider === 'mewe') {
      const hash =
        typeof window !== 'undefined' ? window.location.hash.substring(1) : '';
      const hashParams = new URLSearchParams(hash);
      return {
        state: hashParams.get('state') || searchParams.state || '',
        code: hashParams.get('loginRequestToken') || '',
        refresh: searchParams.refresh || '',
      };
    }

    return searchParams;
  }, []);

  useEffect(() => {
    const version = ++flowVersion.current;
    const controller = new AbortController();
    const isCurrent = () => version === flowVersion.current;
    exited.current = false;
    (async () => {
      try {
        if (
          provider === 'youtube' &&
          firstValue(modifiedParams.state) === 'login' &&
          firstValue(modifiedParams.code)
        ) {
          push(
            `/auth?provider=GOOGLE&code=${encodeURIComponent(
              firstValue(modifiedParams.code)
            )}`
          );
          return;
        }

        const providerErrorMessage = getProviderErrorMessage(modifiedParams);
        if (providerErrorMessage) {
          completeFailure(providerErrorMessage);
          return;
        }

        const timezone = String(dayjs.tz().utcOffset());

        // Try public endpoint first (handles both public and fallback scenarios)
        let data = await fetch(`/integrations/social-connect/${provider}`, {
          method: 'POST',
          body: JSON.stringify({ ...modifiedParams, timezone }),
          signal: controller.signal,
        });

        if (!isCurrent()) return;

        // If public endpoint fails with specific errors, try authenticated endpoint
        if (data.status === HttpStatusCode.BadRequest) {
          const errorData = await data.json().catch(() => ({}));
          if (!isCurrent()) return;
          // "Invalid connection type" means this wasn't started as a public flow
          if (
            errorData.message?.includes('Invalid connection type') ||
            errorData.message?.includes('Invalid or expired state')
          ) {
            data = await fetch(`/integrations/social-connect/${provider}`, {
              method: 'POST',
              body: JSON.stringify({ ...modifiedParams, timezone }),
              signal: controller.signal,
            });
          }
        }

        if (!isCurrent()) return;

        if (data.status === HttpStatusCode.PreconditionFailed) {
          const { returnURL } = await data.json().catch(() => ({}));
          if (!isCurrent()) return;
          completeFailure(
            'Precondition failed',
            `/launches?precondition=true`,
            returnURL || getFailureFallback()
          );
          return;
        }

        if (data.status === HttpStatusCode.NotAcceptable) {
          const { msg, returnURL } = await data.json();
          if (!isCurrent()) return;
          completeFailure(
            msg,
            `/launches?msg=${msg}`,
            returnURL || getFailureFallback()
          );
          return;
        }

        if (
          data.status !== HttpStatusCode.Ok &&
          data.status !== HttpStatusCode.Created
        ) {
          const errorData = await data.json().catch(() => ({}));
          if (!isCurrent()) return;
          completeFailure(
            errorData.message || errorData.msg || 'Could not add provider'
          );
          return;
        }

        const {
          inBetweenSteps,
          id,
          onboarding: resOnboarding,
          pages,
          returnURL,
          extensionToken,
        } = await data.json();
        if (!isCurrent()) return;
        const onboarding = resOnboarding || searchParams.onboarding === 'true';

        // Store refresh token in extension for background cookie refresh
        if (
          extensionToken &&
          extensionId &&
          typeof chrome !== 'undefined' &&
          chrome?.runtime?.sendMessage
        ) {
          try {
            chrome.runtime.sendMessage(
              extensionId,
              {
                type: 'STORE_REFRESH_TOKEN',
                provider,
                integrationId: id,
                jwt: extensionToken,
                backendUrl,
              },
              () => {}
            );
          } catch {
            // Silently ignore — extension may not be available
          }
        }

        // If it's a two-step provider, show the selection UI inline
        if (inBetweenSteps && !searchParams.refresh) {
          setTwoStepState({
            integrationId: id,
            onboarding,
            pages: pages || [],
            returnURL,
          });
          return;
        }

        navigateOrShow(
          `/launches?added=${provider}&msg=Channel Updated${
            onboarding ? '&onboarding=true' : ''
          }`,
          returnURL,
          'Channel Updated'
        );
      } catch {
        if (isCurrent()) {
          completeFailure(
            'Could not finish loading this connection. Return to the app and start a new connection.'
          );
        }
      }
    })();
    return () => {
      flowVersion.current += 1;
      controller.abort();
    };
  }, []);

  const onSave = useCallback(
    async (data: any) => {
      if (!twoStepState || saving.current || exited.current) return;
      const version = flowVersion.current;
      saving.current = true;
      setErrorMessage(null);
      setIsSaving(true);

      try {
        // Use public or authenticated endpoint based on the flow
        const endpoint = logged
          ? `/integrations/provider/${twoStepState.integrationId}/connect`
          : `/integrations/public/provider/${twoStepState.integrationId}/connect`;

        const response = await fetch(endpoint, {
          method: 'POST',
          body: JSON.stringify({ ...modifiedParams, ...data }),
        });

        if (version !== flowVersion.current) return;
        if (
          response.status !== HttpStatusCode.Ok &&
          response.status !== HttpStatusCode.Created
        ) {
          const errorData = await response.json().catch(() => ({}));
          if (version !== flowVersion.current) return;
          setErrorMessage(
            errorData.message ||
              'Failed to save channel configuration. You can choose another page or return to the app.'
          );
          return;
        }

        navigateOrShow(
          `/launches?added=${provider}&msg=Channel Added${
            twoStepState.onboarding ? '&onboarding=true' : ''
          }`,
          twoStepState.returnURL,
          'Channel Added'
        );
      } catch {
        if (version === flowVersion.current) {
          setErrorMessage(
            'Could not confirm the channel configuration. Return to the app and check your channels before trying again.'
          );
        }
      } finally {
        saving.current = false;
        if (version === flowVersion.current) setIsSaving(false);
      }
    },
    [twoStepState, fetch, modifiedParams, provider, navigateOrShow]
  );

  const Provider = useMemo(() => {
    return (
      continueProviderList[provider as keyof typeof continueProviderList] ||
      null
    );
  }, [provider]);

  const providerDisplayName = useMemo(() => {
    const names: Record<string, string> = {
      facebook: 'Facebook',
      instagram: 'Instagram',
      'linkedin-page': 'LinkedIn',
      youtube: 'YouTube',
      gmb: 'Google Business',
    };
    return names[provider] || provider;
  }, [provider]);

  const recoveryControls = (
    <div className="flex flex-col items-center gap-[12px] text-center">
      <button
        type="button"
        onClick={backToApp}
        className="min-h-[44px] px-[20px] py-[10px] rounded-[8px] border border-gray-500 focus-visible:outline focus-visible:outline-2"
      >
        {t('connection_back_to_app', 'Back to app')}
      </button>
      {isMeta && (
        <p className="text-[14px] text-gray-400 max-w-[440px]">
          {t(
            'meta_connection_switch_account_help',
            'Wrong Facebook account? Switch accounts on Facebook in this browser, then return to the app and choose Add Channel to start again.'
          )}{' '}
          <a
            href="https://www.facebook.com/help/804757836392387"
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            {t(
              'meta_connection_switch_account_link',
              'How to switch Facebook accounts'
            )}
          </a>
        </p>
      )}
      {!logged && (
        <p className="text-[14px] text-gray-400 max-w-[440px]">
          {t(
            'connection_guest_close_help',
            'You can close this tab without signing in to the app. To try again, ask the person who sent this connection link for a new link.'
          )}
        </p>
      )}
    </div>
  );

  // Success state for non-logged users without returnURL
  if (successState) {
    return (
      <div className="flex flex-1 items-center justify-center text-white relative overflow-hidden">
        {/* Background gradient decoration */}
        <div className="absolute inset-0 opacity-30">
          <div className="absolute top-[20%] left-[10%] w-[300px] h-[300px] bg-btnPrimary rounded-full blur-[120px]" />
          <div className="absolute bottom-[20%] right-[10%] w-[250px] h-[250px] bg-btnPrimary rounded-full blur-[120px]" />
        </div>

        <div className="relative z-10 text-center">
          <div className="w-[80px] h-[80px] mx-auto mb-[24px] rounded-full bg-green-500/20 flex items-center justify-center">
            <svg
              className="w-[40px] h-[40px] text-green-500"
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path
                fillRule="evenodd"
                d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                clipRule="evenodd"
              />
            </svg>
          </div>
          <div className="text-[28px] font-semibold mb-[12px]">
            {t('channel_connected', 'Channel Connected!')}
          </div>
          <div className="text-[16px] text-gray-400 max-w-[400px]">
            {successState.message ||
              t(
                'channel_connected_description',
                `Your ${providerDisplayName} channel has been successfully connected. You can close this window now.`
              )}
          </div>
        </div>
      </div>
    );
  }

  // Show the two-step selection UI
  if (twoStepState && Provider) {
    return (
      <div className="flex flex-1 items-start justify-center text-white relative overflow-y-auto py-[20px]">
        {/* Background gradient decoration */}
        <div className="absolute inset-0 opacity-30">
          <div className="absolute top-[20%] left-[10%] w-[300px] h-[300px] bg-btnPrimary rounded-full blur-[120px]" />
          <div className="absolute bottom-[20%] right-[10%] w-[250px] h-[250px] bg-btnPrimary rounded-full blur-[120px]" />
        </div>

        {/* Content */}
        <div className="relative z-10 w-full max-w-[550px] mx-auto px-[20px]">
          <div className="bg-[#1A1919] rounded-[16px] p-[32px] flex flex-col gap-[24px]">
            <div className="flex flex-col gap-[8px] text-center">
              <h1 className="text-[24px] font-semibold">
                {t('configure_your_channel', 'Configure Your Channel')}
              </h1>
              <p className="text-[14px] text-gray-400">
                {t(
                  'select_the_page_or_account',
                  `Select the ${providerDisplayName} page or account you want to connect.`
                )}
              </p>
            </div>

            {errorMessage && (
              <p role="alert" className="text-center text-[14px] text-red-400">
                {errorMessage}
              </p>
            )}
            {recoveryControls}

            <IntegrationContext.Provider
              value={{
                date: newDayjs(),
                value: [],
                allIntegrations: [],
                integration: {
                  editor: 'normal',
                  additionalSettings: '',
                  display: '',
                  time: [{ time: 0 }],
                  id: twoStepState.integrationId,
                  type: '',
                  name: '',
                  picture: '',
                  inBetweenSteps: true,
                  changeNickName: false,
                  changeProfilePicture: false,
                  identifier: provider,
                },
              }}
            >
              <Provider
                onSave={onSave}
                existingId={[]}
                initialData={twoStepState.pages}
                isSaving={isSaving}
              />
            </IntegrationContext.Provider>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-1 items-start justify-center text-white relative overflow-y-auto py-[20px]">
        {/* Background gradient decoration */}
        <div className="absolute inset-0 opacity-30">
          <div className="absolute top-[20%] left-[10%] w-[300px] h-[300px] bg-btnPrimary rounded-full blur-[120px]" />
          <div className="absolute bottom-[20%] right-[10%] w-[250px] h-[250px] bg-btnPrimary rounded-full blur-[120px]" />
        </div>

        <div className="relative z-10 text-center">
          <div className="w-[80px] h-[80px] mx-auto mb-[24px] rounded-full bg-red-500/20 flex items-center justify-center">
            <svg
              className="w-[40px] h-[40px] text-red-500"
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path
                fillRule="evenodd"
                d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                clipRule="evenodd"
              />
            </svg>
          </div>
          <div className="text-[28px] font-semibold mb-[12px]">
            {t('could_not_add_provider', 'Could not add provider')}
          </div>
          <div role="alert" className="text-[16px] text-gray-400 max-w-[400px]">
            {errorMessage ||
              t(
                'you_are_being_redirected_back',
                'An error occurred. Please try again.'
              )}
          </div>
          <div className="mt-[24px]">{recoveryControls}</div>
          {logged && !isMeta && (
            <Redirect url={failureRedirectUrl} delay={3000} />
          )}
        </div>
      </div>
    );
  }

  // Loading state
  return (
    <div className="flex flex-1 items-start justify-center text-white relative overflow-y-auto py-[20px]">
      {/* Background gradient decoration */}
      <div className="absolute inset-0 opacity-30">
        <div className="absolute top-[20%] left-[10%] w-[300px] h-[300px] bg-btnPrimary rounded-full blur-[120px]" />
        <div className="absolute bottom-[20%] right-[10%] w-[250px] h-[250px] bg-btnPrimary rounded-full blur-[120px]" />
      </div>

      <div className="relative z-10 text-center">
        <div className="text-[28px] font-semibold mb-[12px]">
          {t('adding_channel', 'Adding Channel')}
        </div>
        <div className="text-[16px] text-gray-400">
          {t('please_wait', 'Please wait while we connect your account...')}
        </div>
        <div className="mt-[24px]">{recoveryControls}</div>
        {/* Loading spinner */}
        <div className="mt-[32px] flex justify-center">
          <div className="w-[48px] h-[48px] border-[3px] border-ai border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    </div>
  );
};
