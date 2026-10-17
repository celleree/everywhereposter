import posthog, { PostHogConfig } from 'posthog-js';

// Keep tokens, search text, private resource IDs and OAuth return URLs out of analytics.
const publicPaths = new Set([
  '/', '/auth', '/auth/login', '/auth/forgot', '/auth/activate',
  '/auth/login-required', '/billing', '/billing/lifetime', '/settings',
  '/launches', '/third-party', '/video-editor', '/create', '/media',
  '/agents', '/plugs', '/analytics', '/creator-audit', '/err', '/oauth/authorize',
]);
export function analyticsUrl(value: string): string {
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol)) return '';
    const pathname = publicPaths.has(url.pathname) ? url.pathname : '/[private]';
    return `${url.origin}${pathname}`;
  } catch {
    return '';
  }
}

let enabled = false;
export const isAnalyticsEnabled = () => enabled;

export const sanitizeAnalytics: NonNullable<PostHogConfig['before_send']> = (event) => {
  if (!enabled) return null;
  if (!event) return event;
  const sanitize = (properties: Record<string, any>) => {
    for (const key of Object.keys(properties)) {
      const value = properties[key];
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        sanitize(value);
      } else if (typeof value === 'string' && /url|referrer|pathname/i.test(key)) {
        properties[key] = key.includes('pathname')
          ? (publicPaths.has(value) ? value : '/[private]')
          : analyticsUrl(value);
      }
    }
  };
  sanitize(event.properties);
  return event;
};

let lastPathname: string | undefined;
let previousUrl: string | undefined;
export function initializePostHog(key?: string, host?: string, environment?: string) {
  enabled = false;
  if (!key?.trim() || !host?.trim() || environment !== 'production' ||
      ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname) ||
      navigator.webdriver) return false;
  try {
    if (localStorage.getItem('everywhereposter.analytics.disabled') === 'true') return false;
    const parsedHost = new URL(host);
    if (!['https:', 'http:'].includes(parsedHost.protocol)) return false;
  } catch { return false; }
  enabled = true;
  if (!posthog.__loaded) {
    posthog.init(key, {
      api_host: host,
      person_profiles: 'identified_only',
      capture_pageview: false,
      capture_pageleave: false,
      autocapture: false,
      opt_out_useragent_filter: false,
      disable_session_recording: true,
      session_recording: { maskAllInputs: true, maskTextSelector: '*', blockSelector: 'body' },
      enable_recording_console_log: false,
      capture_performance: false,
      enable_heatmaps: false,
      capture_exceptions: false,
      disable_surveys: true,
      before_send: sanitizeAnalytics,
    });
  }
  return posthog.__loaded;
}

export function capturePageview(pathname: string) {
  if (pathname === lastPathname) return;
  const url = analyticsUrl(window.location.origin + pathname);
  posthog.capture('$pageview', {
    $current_url: url,
    $pathname: new URL(url).pathname,
    $host: window.location.host,
    $referrer: previousUrl ?? analyticsUrl(document.referrer),
  });
  lastPathname = pathname;
  previousUrl = url;
}
