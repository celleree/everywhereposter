import {
  devices,
  type Locator,
  type Page,
  type TestInfo,
} from '@playwright/test';
import { test, expect, browserOrigin, capture, openApp } from './fixtures';
import { minifyPosts } from '../../libraries/helpers/src/utils/posts.list.minify';

// CI selects the Scheduled prefix under phone-chromium; this file deliberately
// exercises an actual desktop context and records the effective options below.
const desktopUserAgent = devices['Desktop Chrome'].userAgent;
test.use({
  viewport: { width: 1440, height: 900 },
  isMobile: false,
  hasTouch: false,
  deviceScaleFactor: 1,
  userAgent: desktopUserAgent,
  timezoneId: 'UTC',
  locale: 'en-US',
});
test.skip(
  ({ browserName }) => browserName !== 'chromium',
  'Desktop HTML5 drag acceptance uses Chromium.'
);

const movedId = 'synthetic-drag-a';
const otherId = 'synthetic-drag-b';
const oldDate = '2035-01-08T18:00:00.000Z';
const requestedDate = '2035-01-09T23:59:59';
const authoritativeDate = '2035-01-11T10:30:00.000Z';
const datePath = `/backend-api/posts/${movedId}/date`;
const calendarUrl =
  '/launches?display=month&startDate=2035-01-01&endDate=2035-01-31';
const initialOther = 'Synthetic unrelated post: initial caption';
const freshOther = 'Synthetic unrelated post: authoritative fresh caption';
const freshMoved = 'Synthetic desktop drag post: authoritative caption';
const post = (id: string, publishDate: string, content: string) => ({
  id,
  group: `synthetic-group-${id}`,
  state: 'QUEUE',
  publishDate,
  content,
  tags: [],
  intervalInDays: null,
  integration: {
    id: 'synthetic-channel',
    name: 'Synthetic channel',
    providerIdentifier: 'x',
    picture: '/icons/platforms/x.png',
  },
});
const rows = (
  date = oldDate,
  other = initialOther,
  content = 'Synthetic desktop drag post'
) => [
  post(movedId, date, content),
  post(otherId, '2035-01-10T18:00:00.000Z', other),
];
function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

async function installResponses(page: Page) {
  const putGate = gate(),
    readGate = gate();
  const fixture = {
    writes: [] as unknown[],
    reads: 0,
    putStatus: 200 as number | 'unknown',
    readStatus: 200,
    readRows: rows(authoritativeDate, freshOther, freshMoved),
    events: [] as object[],
    releasePut: putGate.release,
    releaseRead: readGate.release,
    releaseAll: () => {
      putGate.release();
      readGate.release();
    },
  };
  await page.route(
    (url) =>
      url.origin === browserOrigin &&
      (url.pathname === datePath || url.pathname === '/backend-api/posts'),
    async (route) => {
      const request = route.request(),
        url = new URL(request.url());
      if (
        request.method() === 'PUT' &&
        url.pathname === datePath &&
        !url.search
      ) {
        const body = request.postDataJSON();
        fixture.writes.push(body);
        fixture.events.push({ method: 'PUT', url: url.href, body });
        await putGate.promise;
        // This exact synthetic request is completed inside the browser. It is
        // never continued to the otherwise read-only fixture API.
        if (fixture.putStatus === 'unknown') return route.abort('failed');
        return route.fulfill({ status: fixture.putStatus, json: {} });
      }
      if (
        request.method() === 'GET' &&
        url.pathname === '/backend-api/posts' &&
        url.searchParams.get('display') === 'month' &&
        url.searchParams.get('customer') === '' &&
        // Calendar's localizedFormat plugin emits UTC as +00:00 by default.
        url.searchParams.get('startDate') === '2035-01-01T00:00:00+00:00' &&
        url.searchParams.get('endDate') === '2035-01-31T23:59:59+00:00'
      ) {
        fixture.reads++;
        fixture.events.push({
          method: 'GET',
          url: url.href,
          sequence: fixture.reads,
        });
        if (fixture.reads === 1)
          return route.fulfill({ json: minifyPosts({ posts: rows() }) });
        await readGate.promise;
        return route.fulfill({
          status: fixture.readStatus,
          json: minifyPosts({ posts: fixture.readRows }),
        });
      }
      // Unmatched requests retain both the browser guard and the server guard.
      return route.fallback();
    }
  );
  return fixture;
}

const card = (page: Page, id = movedId) =>
  page.locator(`[data-calendar-post-id="${id}"]`);
const slot = (page: Page, day: string) =>
  page.locator(`[data-calendar-slot="2035-01-${day}T23:59:59"]`);
const pending = (page: Page) =>
  page
    .getByRole('status')
    .filter({ hasText: /Updating schedule|Schedule unconfirmed/ });
async function inSlot(page: Page, day: string, busy: boolean) {
  const item = slot(page, day).locator(`[data-calendar-post-id="${movedId}"]`);
  await expect(item).toBeVisible();
  await expect(item).toHaveAttribute('aria-busy', String(busy));
}
async function drag(source: Locator, target: Locator) {
  await expect(source).toBeVisible();
  await expect(target).toBeVisible();
  // Native Playwright mouse dragging reaches react-dnd's HTML5Backend; no
  // dispatchEvent, React hook invocation, or direct mutation fetch substitutes.
  await source.dragTo(target, { targetPosition: { x: 12, y: 12 } });
}
async function openCalendar(page: Page, info: TestInfo) {
  // Keep scheduling constraints enabled while making the fixture dates stable.
  // setFixedTime changes Date only; real timers and network gates keep running.
  await page.clock.setFixedTime(new Date('2034-12-31T12:00:00Z'));
  // Initial data belongs to the existing cold-bootstrap budget. Register before
  // navigation so this cannot consume a later drag reconciliation response.
  const [initial] = await Promise.all([
    page.waitForResponse((response) => {
      const url = new URL(response.url());
      return response.request().method() === 'GET' &&
        url.origin === browserOrigin && url.pathname === '/backend-api/posts' &&
        url.searchParams.get('display') === 'month' &&
        url.searchParams.get('customer') === '' &&
        url.searchParams.get('startDate') === '2035-01-01T00:00:00+00:00' &&
        url.searchParams.get('endDate') === '2035-01-31T23:59:59+00:00';
    }, { timeout: 60_000 }),
    openApp(page, calendarUrl),
  ]);
  expect(initial.ok()).toBeTruthy();
  expect(await initial.finished()).toBeNull();
  const effective = await page.evaluate(() => ({
    viewport: { width: innerWidth, height: innerHeight },
    mobileLayout: matchMedia('(max-width: 1025px)').matches,
    maxTouchPoints: navigator.maxTouchPoints,
    deviceScaleFactor: devicePixelRatio,
    userAgent: navigator.userAgent,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  }));
  await info.attach('desktop-calendar-drag-effective-context', {
    body: JSON.stringify(
      {
        projectLabel: info.project.name,
        effectiveContext: 'desktop Chromium',
        ...effective,
      },
      null,
      2
    ),
    contentType: 'application/json',
  });
  expect(effective).toEqual({
    viewport: { width: 1440, height: 900 },
    mobileLayout: false,
    maxTouchPoints: 0,
    deviceScaleFactor: 1,
    userAgent: desktopUserAgent,
    timezone: 'UTC',
  });
  await expect(page.locator('#left-menu')).toBeVisible();
  await expect(
    page.getByRole('navigation', { name: 'Mobile navigation' })
  ).not.toBeVisible();
  await inSlot(page, '08', false);
  await expect(card(page, otherId)).toContainText(initialOther);
}
async function evidence(
  page: Page,
  info: TestInfo,
  fixture: Awaited<ReturnType<typeof installResponses>>,
  name: string
) {
  await info.attach('desktop-calendar-drag-request-log', {
    body: JSON.stringify(fixture.events, null, 2),
    contentType: 'application/json',
  });
  await capture(page, info, `desktop-calendar-drag-${name}`);
}

// The direct API request deliberately targets the same synthetic ID as the
// page-local exception. APIRequestContext does not pass through page routes.
test('Scheduled: desktop drag saves once and reconciles an authoritative date', async ({
  page,
  context,
}, info) => {
  const fixture = await installResponses(page);
  try {
    await openCalendar(page, info);
    const apiOrigin = `http://127.0.0.1:${
      process.env.BROWSER_API_PORT || '4218'
    }`;
    expect(
      (
        await context.request.put(`${apiOrigin}/posts/${movedId}/date`, {
          data: { date: requestedDate, action: 'schedule' },
        })
      ).status()
    ).toBe(405);
    expect(
      await page.evaluate(
        async () =>
          (
            await fetch('/backend-api/posts/synthetic-unmatched/date', {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: '{}',
            })
          ).status
      )
    ).toBe(405);

    await drag(card(page), slot(page, '09'));
    await inSlot(page, '09', true);
    await expect(pending(page)).toBeVisible();
    await expect.poll(() => fixture.writes).toEqual([
      { date: requestedDate, action: 'schedule' },
    ]);
    await drag(card(page), slot(page, '12'));
    expect(fixture.writes).toHaveLength(1);
    await inSlot(page, '09', true);
    fixture.releasePut();
    await expect.poll(() => fixture.reads).toBe(2);
    await inSlot(page, '09', true);
    await drag(card(page), slot(page, '12'));
    expect(fixture.writes).toHaveLength(1);
    fixture.releaseRead();
    // Both date and unrelated content differ from the optimistic snapshot.
    await inSlot(page, '11', false);
    await expect(card(page)).toContainText(freshMoved);
    await expect(card(page, otherId)).toContainText(freshOther);
    await expect(
      slot(page, '10').locator(`[data-calendar-post-id="${otherId}"]`)
    ).toBeVisible();
    await expect(
      page.getByText('Schedule saved.', { exact: true })
    ).toBeVisible();
    await expect(pending(page)).toHaveCount(0);
    expect(fixture.writes).toHaveLength(1);
    await evidence(page, info, fixture, 'saved-and-reconciled');
  } finally {
    fixture.releaseAll();
  }
});

for (const status of [400, 500]) {
  test(`Scheduled: desktop drag HTTP ${status} restores only the rejected post`, async ({
    page,
  }, info) => {
    const fixture = await installResponses(page);
    fixture.putStatus = status;
    fixture.readRows = rows(oldDate, freshOther);
    try {
      await openCalendar(page, info);
      await drag(card(page), slot(page, '09'));
      await inSlot(page, '09', true);
      // The real pending-status Refresh button revalidates this mounted
      // provider, so fresh unrelated content must not erase the date overlay.
      await pending(page)
        .getByRole('button', { name: 'Refresh', exact: true })
        .click();
      await expect.poll(() => fixture.reads).toBe(2);
      fixture.releaseRead();
      await expect(card(page, otherId)).toContainText(freshOther);
      await inSlot(page, '09', true);
      fixture.releasePut();
      await inSlot(page, '08', false);
      await expect(card(page, otherId)).toContainText(freshOther);
      await expect(
        slot(page, '10').locator(`[data-calendar-post-id="${otherId}"]`)
      ).toBeVisible();
      expect(fixture.writes).toEqual([
        { date: requestedDate, action: 'schedule' },
      ]);
      await expect(
        page.getByText(
          'The schedule could not be saved. The previous date has been restored.',
          { exact: true }
        )
      ).toBeVisible();
      await expect(page.getByText(/^Schedule saved/)).toHaveCount(0);
      await evidence(page, info, fixture, `http-${status}-entity-rollback`);
    } finally {
      fixture.releaseAll();
    }
  });
}

test('Scheduled: desktop drag unknown result reconciles without claiming save or rollback', async ({
  page,
}, info) => {
  const fixture = await installResponses(page);
  fixture.putStatus = 'unknown';
  try {
    await openCalendar(page, info);
    await drag(card(page), slot(page, '09'));
    await inSlot(page, '09', true);
    fixture.releasePut();
    await expect.poll(() => fixture.reads).toBe(2);
    await expect(pending(page)).toContainText('Schedule unconfirmed');
    await inSlot(page, '09', true);
    await drag(card(page), slot(page, '12'));
    expect(fixture.writes).toHaveLength(1);
    fixture.releaseRead();
    await inSlot(page, '11', false);
    await expect(card(page)).toContainText(freshMoved);
    await expect(card(page, otherId)).toContainText(freshOther);
    await expect(
      page.getByText(
        'The save could not be confirmed. The calendar has been refreshed; check the date before trying again.',
        { exact: true }
      )
    ).toBeVisible();
    await expect(page.getByText(/^Schedule saved/)).toHaveCount(0);
    await expect(
      page.getByText(
        'The schedule could not be saved. The previous date has been restored.',
        { exact: true }
      )
    ).toHaveCount(0);
    expect(fixture.writes).toHaveLength(1);
    await evidence(page, info, fixture, 'unknown-authoritative-reconciliation');
  } finally {
    fixture.releaseAll();
  }
});

test('Scheduled: desktop drag confirmed save survives a failed refresh', async ({
  page,
}, info) => {
  const fixture = await installResponses(page);
  fixture.readStatus = 503;
  try {
    await openCalendar(page, info);
    await drag(card(page), slot(page, '09'));
    await inSlot(page, '09', true);
    fixture.releasePut();
    await expect.poll(() => fixture.reads).toBe(2);
    await inSlot(page, '09', true);
    fixture.releaseRead();
    await inSlot(page, '09', false);
    await expect(card(page, otherId)).toContainText(initialOther);
    expect(fixture.writes).toEqual([
      { date: requestedDate, action: 'schedule' },
    ]);
    await expect(
      page.getByText(
        'Schedule saved, but the calendar could not be refreshed. Refresh to check the latest posts.',
        { exact: true }
      )
    ).toBeVisible();
    await expect(
      page.getByText(
        'The schedule could not be saved. The previous date has been restored.',
        { exact: true }
      )
    ).toHaveCount(0);
    await expect(pending(page)).toHaveCount(0);
    await evidence(page, info, fixture, 'saved-refresh-failed');
  } finally {
    fixture.releaseAll();
  }
});
