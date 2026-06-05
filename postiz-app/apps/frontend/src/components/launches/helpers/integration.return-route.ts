const INTEGRATION_RETURN_ROUTE_KEY = 'integration-return-route';

const FALLBACK_ROUTE = '/launches';

function isSafeIntegrationReturnRoute(route: string) {
  if (!route || !route.startsWith('/') || route.startsWith('//')) {
    return false;
  }

  try {
    const baseUrl = 'https://postiz.local';
    const parsed = new URL(route, baseUrl);

    if (parsed.origin !== baseUrl) {
      return false;
    }

    return (
      parsed.pathname !== '/integrations/social' &&
      !parsed.pathname.startsWith('/integrations/social/')
    );
  } catch {
    return false;
  }
}

export function storeIntegrationReturnRoute(route?: string) {
  if (typeof window === 'undefined') {
    return;
  }

  const returnRoute =
    route ||
    `${window.location.pathname}${window.location.search}${window.location.hash}`;

  try {
    if (isSafeIntegrationReturnRoute(returnRoute)) {
      sessionStorage.setItem(INTEGRATION_RETURN_ROUTE_KEY, returnRoute);
      return;
    }

    sessionStorage.removeItem(INTEGRATION_RETURN_ROUTE_KEY);
  } catch {}
}

export function getIntegrationReturnRoute(fallback = FALLBACK_ROUTE) {
  const safeFallback = isSafeIntegrationReturnRoute(fallback)
    ? fallback
    : FALLBACK_ROUTE;

  if (typeof window === 'undefined') {
    return safeFallback;
  }

  try {
    const returnRoute = sessionStorage.getItem(INTEGRATION_RETURN_ROUTE_KEY);

    if (returnRoute && isSafeIntegrationReturnRoute(returnRoute)) {
      return returnRoute;
    }
  } catch {}

  return safeFallback;
}

export function clearIntegrationReturnRoute() {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    sessionStorage.removeItem(INTEGRATION_RETURN_ROUTE_KEY);
  } catch {}
}
