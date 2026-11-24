import { test, expect, openApp, noHorizontalOverflow, capture, mobileProject, browserOrigin, reachable } from './fixtures';
import type { Page, APIRequestContext, TestInfo } from '@playwright/test';

test.skip(process.env.EP_FACEBOOK_BROWSER !== '1', 'Requires the explicitly isolated PostgreSQL adapter');
const api = `http://127.0.0.1:${process.env.BROWSER_API_PORT || '4218'}`;
async function reset(request: APIRequestContext, data: object = {}) {
  const result = await request.post(`${api}/__facebook/reset`, { data });
  expect(result.ok(), await result.text()).toBeTruthy();
  return (await result.json()) as { integrationIds: string[] };
}
async function evidence(request: APIRequestContext) { return (await request.get(`${api}/__facebook/evidence`)).json(); }
async function openPost(page: Page, info: TestInfo, name = 'Browser Page A') {
  await openApp(page, '/launches?display=list');
  await page.getByRole('button', { name: 'Published', exact: true }).click();
  if (mobileProject(info)) {
    await page.getByRole('button', { name: `Details: ${name}`, exact: true }).click();
  } else await page.getByText(`Original ${name} text`, { exact: true }).first().click();
  const selected = (await evidence(page.request)).posts.find((post: { integration: { name: string } }) => post.integration.name === name);
  expect(selected?.group).toEqual(expect.any(String));
  // Await this selected group's initial load before the unchanged UI assertion;
  // no edit or reconciliation request has been sent at this bootstrap boundary.
  const [group] = await Promise.all([
    page.waitForResponse(response => response.request().method() === 'GET' &&
      response.url() === `${browserOrigin}/backend-api/posts/group/${encodeURIComponent(selected.group)}`,
    { timeout: 60_000 }),
    page.getByRole('button', { name: 'Edit Post', exact: true }).click(),
  ]);
  expect(group.ok()).toBeTruthy();
  expect(await group.finished()).toBeNull();
  await expect(page.getByRole('region', { name: 'Facebook text post management' })).toBeVisible();
}

test.beforeEach(async ({ page, context }) => {
  await context.addCookies([{ name: 'facebook-fixture', value: '1', url: browserOrigin }]);
  await reset(context.request);
  // Pass only the opted-in feature endpoints to the real local adapter; fixture
  // defaults continue blocking all unrelated mutations and all external origins.
  await page.route(`${browserOrigin}/backend-api/posts/*/facebook-published**`, route => route.continue());
});

test('Facebook management: same-ID edit, cache refresh, reload, keyboard cancellation and confirmed deletion', async ({ page, context }, info) => {
  if (mobileProject(info)) await page.setViewportSize({ width: 360, height: 800 });
  const before = await evidence(context.request);
  const original = before.posts[0];
  await openPost(page, info);
  const panel = page.getByRole('region', { name: 'Facebook text post management' });
  await expect(page.locator('#wrapper-settings input:enabled')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Save as draft', exact: true })).toHaveCount(0);
  await expect(page.getByText('Repeat Post Every...', { exact: true })).toHaveCount(0);
  await expect(panel.getByRole('link', { name: 'Open this post on Facebook' })).toHaveAttribute('href', original.releaseURL);
  const message = panel.getByRole('textbox', { name: 'Post message' });
  await message.fill('Edited through the real controller');
  const save = panel.getByRole('button', { name: 'Save Facebook message' });
  await save.click();
  await expect(save).toBeDisabled();
  await expect.poll(async () => (await evidence(context.request)).posts[0].content).toBe('Edited through the real controller');
  await expect.poll(async () => (await evidence(context.request)).reads).toBeGreaterThan(before.reads + 2);
  const edited = await evidence(context.request);
  expect(edited.posts[0].releaseId).toBe(original.releaseId);
  expect(edited.posts[0].releaseURL).toBe(original.releaseURL);
  expect(edited.calls.filter((call: any) => call.method === 'POST' && !call.id.endsWith('/feed'))).toEqual([{ id: original.releaseId, method: 'POST', message: 'Edited through the real controller' }]);
  await noHorizontalOverflow(page);
  await capture(page, info, 'facebook-edited');
  await expect(page.locator('#composer-preview-content')).toContainText('Edited through the real controller');
  await expect(page.locator('#composer-preview-content')).not.toContainText('Original Browser Page A text');
  await message.fill('Unsaved local draft');
  const remove = panel.getByRole('button', { name: 'Delete from Facebook', exact: true });
  await remove.click();
  const confirmation = panel.getByRole('alertdialog');
  await expect(confirmation).toHaveAccessibleDescription('Edited through the real controller');
  await expect(confirmation).not.toContainText('Unsaved local draft');
  await expect(confirmation.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(confirmation).toHaveCount(0);
  await expect(remove).toBeFocused();
  await remove.click();
  await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect((await evidence(context.request)).calls.filter((call: any) => call.method === 'DELETE')).toHaveLength(0);
  await remove.click();
  await confirmation.getByRole('button', { name: 'Confirm Facebook deletion' }).click();
  await expect(panel.getByRole('status').filter({ hasText: /^Deleted on Facebook\.$/ })).toBeVisible();
  await expect(page.locator('#composer-preview-content')).toContainText('Deleted on Facebook');
  const deleted = await evidence(context.request);
  expect(deleted.posts[0]).toMatchObject({ state: 'DELETED_REMOTE', releaseId: original.releaseId, content: 'Edited through the real controller' });
  expect(deleted.remote.some((post: any) => post.id === original.releaseId)).toBeFalsy();
  expect(deleted.calls.filter((call: any) => call.method === 'DELETE')).toEqual([{ id: original.releaseId, method: 'DELETE' }]);
  const repeated = await context.request.post(`${api}/posts/${original.id}/facebook-published`, { data: { action: 'delete', revision: 0 } });
  expect(repeated.ok()).toBeTruthy();
  expect((await evidence(context.request)).calls.filter((call: any) => call.method === 'DELETE')).toHaveLength(1);
  await info.attach('facebook-confirmed-state', { body: JSON.stringify({ fixture: 'Synthetic session, isolated PostgreSQL, mocked Meta and Temporal only', before, edited, deleted }), contentType: 'application/json' });
  await openApp(page, '/launches?display=month');
  if (mobileProject(info)) await page.getByRole('button', { name: 'All posts', exact: true }).click();
  await expect(page.getByText('Edited through the real controller', { exact: true }).first()).toBeVisible();
  if (mobileProject(info)) await page.getByRole('button', { name: 'Details: Browser Page A', exact: true }).click();
  else await page.getByText('Edited through the real controller', { exact: true }).first().click();
  await expect(page.getByText('Deleted Remote', { exact: false }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit Post', exact: true })).toBeDisabled();
  await noHorizontalOverflow(page);
});

for (const mode of ['reject', 'timeout', 'accepted-timeout']) {
  test(`Facebook management: ${mode} preserves confirmed state and never automatically resends`, async ({ page, context }, info) => {
    await context.request.post(`${api}/__facebook/mode`, { data: { mode } });
    await openPost(page, info);
    const panel = page.getByRole('region', { name: 'Facebook text post management' });
    await panel.getByRole('textbox', { name: 'Post message' }).fill('Requested uncertain text');
    await panel.getByRole('button', { name: 'Save Facebook message' }).click();
    await expect(panel.getByRole('alert')).toContainText('reconciliation');
    await expect(panel.getByRole('button', { name: 'Check result' })).toBeVisible();
    await expect(panel.getByRole('textbox')).toBeDisabled();
    expect((await evidence(context.request)).posts[0]).toMatchObject({ content: 'Original Browser Page A text', state: 'PUBLISHED' });
    await panel.getByRole('button', { name: 'Check result' }).click();
    if (mode === 'accepted-timeout') {
      await expect(panel.getByRole('button', { name: 'Check result' })).toHaveCount(0);
      await expect(panel.getByRole('textbox')).toBeEnabled();
      await expect(panel.getByRole('textbox')).toHaveValue('Requested uncertain text');
    }
    else await expect(panel.getByRole('alert')).toContainText('remains locked');
    const proof = await evidence(context.request);
    expect(proof.calls.filter((call: any) => call.method === 'POST' && !call.id.endsWith('/feed'))).toHaveLength(1);
    expect(proof.posts[0].content).toBe(mode === 'accepted-timeout' ? 'Requested uncertain text' : 'Original Browser Page A text');
    await noHorizontalOverflow(page);
  });
}


test('Facebook management: composer creates a real receipt then opens same-ID text actions', async ({ page, context }, info) => {
  await reset(context.request, { empty: true });
  const submissionIds: string[] = [];
  await page.route(`${browserOrigin}/backend-api/posts/submissions/*`, route => route.continue());
  await page.route(`${browserOrigin}/backend-api/posts`, route => {
    if (route.request().method() === 'POST') {
      const id = route.request().postDataJSON().submissionId;
      expect(id).toMatch(/^[a-zA-Z0-9_-]{16,128}$/);
      submissionIds.push(id);
    }
    return route.continue();
  });
  await page.route(`${browserOrigin}/backend-api/posts/should-shortlink`, route => route.continue());
  await openApp(page, '/create');
  if (mobileProject(info)) await page.getByRole('button', { name: 'Write a text post', exact: true }).click();
  const input = mobileProject(info) ? page.getByRole('textbox', { name: 'Post text', exact: true }) : page.locator('[contenteditable="true"]').first();
  await input.fill('Original Browser Page A text');
  await page.getByRole('button', { name: 'Continue to Destinations', exact: true }).click();
  await page.getByRole('button', { name: 'Select Browser Page A on Facebook', exact: true }).click();
  await page.getByRole('button', { name: 'Continue to Review', exact: true }).click();
  await page.getByRole('button', { name: 'Continue to Publish', exact: true }).click();
  const publish = page.getByRole('button', { name: 'Publish now', exact: true });
  await reachable(publish);
  await publish.click();
  await expect(page.getByText('Publishing was confirmed for every enabled destination.', { exact: true })).toBeVisible();
  const proof = await evidence(context.request);
  expect(proof.posts).toHaveLength(1);
  expect(proof.posts[0]).toMatchObject({ state: 'PUBLISHED', content: 'Original Browser Page A text' });
  expect(submissionIds).toHaveLength(1);
  const statusResponse = await context.request.get(`${api}/posts/submissions/${encodeURIComponent(submissionIds[0])}`);
  expect(statusResponse.ok()).toBeTruthy();
  expect(await statusResponse.json()).toMatchObject({
    submissionId: submissionIds[0],
    destinations: [{ postId: proof.posts[0].id, integrationId: proof.posts[0].integration.id, recoverability: 'complete' }],
  });
  const missing = await context.request.get(`${api}/posts/submissions/missing-submission-attempt`);
  expect(missing.status()).toBe(404);
  const unauthorized = await context.request.get(`${api}/posts/submissions/${encodeURIComponent(submissionIds[0])}`, { headers: { auth: 'invalid-fixture-session' } });
  expect(unauthorized.status()).toBe(401);
  expect(proof.calls.filter((call: any) => call.method === 'POST' && call.id.endsWith('/feed'))).toHaveLength(1);
  await openPost(page, info);
  await expect(page.getByRole('textbox', { name: 'Post message' })).toHaveValue('Original Browser Page A text');
  await expect(page.getByRole('link', { name: 'Open this post on Facebook' })).toHaveAttribute('href', proof.posts[0].releaseURL);
  const panel = page.getByRole('region', { name: 'Facebook text post management' });
  await panel.getByRole('textbox').fill('Edited composer-created post');
  await panel.getByRole('button', { name: 'Save Facebook message' }).click();
  await expect.poll(async () => (await evidence(context.request)).posts[0].content).toBe('Edited composer-created post');
  expect((await evidence(context.request)).posts[0].releaseId).toBe(proof.posts[0].releaseId);
  await panel.getByRole('button', { name: 'Delete from Facebook', exact: true }).click();
  await panel.getByRole('button', { name: 'Confirm Facebook deletion' }).click();
  await expect(panel.getByRole('status').filter({ hasText: /^Deleted on Facebook\.$/ })).toBeVisible();
  const deleted = await evidence(context.request);
  expect(deleted.posts[0]).toMatchObject({ releaseId: proof.posts[0].releaseId, state: 'DELETED_REMOTE' });
  expect(deleted.remote).toHaveLength(0);
  expect(submissionIds).toHaveLength(1);
  await noHorizontalOverflow(page);
  await reset(context.request, { empty: true });
  const otherOrg = await context.request.get(`${api}/posts/submissions/${encodeURIComponent(submissionIds[0])}`);
  expect(otherOrg.status()).toBe(404);
});

test('Facebook management: Calendar Post now deletes only the selected Page copy', async ({ page, context }, info) => {
  const { integrationIds } = await reset(context.request, { empty: true, mixed: true });
  const names = ['California Home Services', 'Central Valley Home Services', 'Home Services Network'];
  const message = 'Spring home maintenance checklist. Watch the video at https://www.youtube.com/watch?v=synthetic';
  const mobile = mobileProject(info);

  if (mobile) {
    // The mobile Calendar lists posts. Publish through the same legacy endpoint
    // as desktop Calendar Post now so this case can exercise the phone shortcut.
    const response = await context.request.post(`${api}/posts`, { data: {
      type: 'now', date: new Date().toISOString(), shortLink: false, tags: [],
      posts: integrationIds.map(id => ({
        integration: { id }, group: 'new-editor-group', settings: {},
        value: [{ id: 'new-editor-id', content: message, image: [], delay: 0 }],
      })),
    } });
    expect(response.ok(), await response.text()).toBeTruthy();
  } else {
    await page.route(`${browserOrigin}/backend-api/posts`, route => route.continue());
    await page.route(`${browserOrigin}/backend-api/posts/should-shortlink`, route => route.fulfill({ json: { ask: false } }));
    await openApp(page, '/launches?display=month');
    const slot = page.locator('[data-calendar-slot]:not(.repeated-strip)').first();
    await slot.locator('div.cursor-pointer').last().click();
    await page.locator('[contenteditable="true"]').first().fill(message);
    for (const name of names) await page.getByRole('button', { name: new RegExp(name) }).click();
    await page.getByRole('button', { name: 'Add to Calendar', exact: true }).hover();
    const published = page.waitForResponse(response =>
      response.request().method() === 'POST' && response.url() === `${browserOrigin}/backend-api/posts`
    );
    await page.getByRole('button', { name: 'Post now', exact: true }).click();
    const response = await published;
    expect(response.status()).toBe(200);
    expect(response.request().postDataJSON()).toMatchObject({ type: 'now', posts: expect.any(Array) });
    expect(response.request().postDataJSON().submissionId).toBeUndefined();
  }

  const before = await evidence(context.request);
  expect(before.posts).toHaveLength(3);
  expect(before.posts.map((post: any) => post.state)).toEqual(['PUBLISHED', 'PUBLISHED', 'PUBLISHED']);
  expect(before.calls.filter((call: any) => call.method === 'POST')).toEqual([
    { id: '9900/feed', method: 'POST', message },
    { id: '9901/feed', method: 'POST', message },
  ]);
  const [target, otherPage, linkedin] = names.map(name =>
    before.posts.find((post: any) => post.integration.name === name)
  );

  await openApp(page, `/launches?display=${mobile ? 'list' : 'month'}`);
  if (mobile) {
    await page.getByRole('button', { name: 'Published', exact: true }).click();
    await page.getByRole('button', { name: `Delete on platform: ${names[0]}`, exact: true }).click();
  } else {
    await page.locator(`[data-calendar-post-id="${target.id}"]`).getByText(message).click();
    const detail = page.getByRole('dialog');
    await expect(detail.getByText(names[0], { exact: true }).first()).toBeVisible();
    await expect(detail.getByText(message, { exact: true })).toBeVisible();
    await expect(detail).not.toContainText(target.releaseId);
    await expect(detail).not.toContainText(target.id);
    await page.getByRole('button', { name: 'Manage Facebook post', exact: true }).click();
  }
  const panel = page.getByRole('region', { name: 'Facebook text post management' });
  await expect(panel.getByRole('heading', { name: names[0], exact: true })).toBeVisible();
  await expect(panel.getByText(message, { exact: true })).toBeVisible();
  await expect(panel).not.toContainText('9900');
  await expect(panel.getByRole('link', { name: 'Open this post on Facebook' })).toHaveAttribute('href', target.releaseURL);
  await expect(panel.getByRole('button', { name: 'Save Facebook message' })).toHaveCount(0);
  await panel.getByRole('button', { name: 'Delete from Facebook', exact: true }).click();
  const confirmation = panel.getByRole('alertdialog');
  await expect(confirmation).toHaveAccessibleName(`Permanently delete this post from ${names[0]}?`);
  await expect(confirmation).toHaveAccessibleDescription(message);
  await expect(confirmation.getByText(message, { exact: true })).toBeVisible();
  await expect(panel).not.toContainText('9900');
  expect((await evidence(context.request)).calls.filter((call: any) => call.method === 'DELETE')).toEqual([]);
  await confirmation.getByRole('button', { name: 'Confirm Facebook deletion' }).click();
  await expect(panel.getByText('Deleted on Facebook.', { exact: true })).toBeVisible();

  await openApp(page, '/launches?display=month');
  if (!mobile) await page.getByRole('button', { name: /^scheduled posts$/i }).click();
  await page.getByRole('button', { name: 'Published', exact: true }).click();
  await expect(page.getByText(message, { exact: true })).toHaveCount(2);
  const after = await evidence(context.request);
  expect(after.calls.filter((call: any) => call.method === 'DELETE')).toEqual([{ id: target.releaseId, method: 'DELETE' }]);
  expect(after.posts.find((post: any) => post.id === target.id)).toMatchObject({ state: 'DELETED_REMOTE', releaseId: target.releaseId });
  for (const sibling of [otherPage, linkedin]) {
    expect(after.posts.find((post: any) => post.id === sibling.id)).toEqual(sibling);
  }
  expect(after.remote).toEqual(before.remote.filter((post: any) => post.id !== target.releaseId));

  const editedMessage = 'Edited LinkedIn fixture';
  const updated = await context.request.post(`${api}/posts`, { data: {
    type: 'update', date: linkedin.publishDate, shortLink: false, tags: [],
    posts: [{
      integration: { id: linkedin.integrationId }, group: linkedin.group, settings: {},
      value: [{ id: linkedin.id, content: editedMessage, image: [], delay: 0 }],
    }],
  } });
  expect(updated.ok(), await updated.text()).toBeTruthy();
  expect((await evidence(context.request)).remote).toContainEqual({ id: linkedin.releaseId, message: editedMessage });
});

test('Facebook management: a lost deletion response stays locked in Calendar', async ({ page, context }, info) => {
  const target = (await evidence(context.request)).posts.find((post: any) => post.integration.name === 'Browser Page A');
  await context.request.post(`${api}/__facebook/mode`, { data: { mode: 'accepted-timeout' } });
  const openManagement = async () => {
    await openApp(page, '/launches?display=list');
    await page.getByRole('button', { name: 'Published', exact: true }).click();
    if (mobileProject(info)) {
      await page.getByRole('button', { name: 'Details: Browser Page A', exact: true }).click();
    } else {
      await page.getByText('Original Browser Page A text', { exact: true }).first().click();
    }
    await page.getByRole('button', { name: 'Manage Facebook post', exact: true }).click();
  };
  await openManagement();
  const panel = page.getByRole('region', { name: 'Facebook text post management' });
  await panel.getByRole('button', { name: 'Delete from Facebook', exact: true }).click();
  await panel.getByRole('button', { name: 'Confirm Facebook deletion' }).click();
  const check = panel.getByRole('button', { name: 'Check result', exact: true });
  await expect(check).toBeVisible();
  await expect(panel.getByRole('alertdialog')).toHaveCount(0);
  await expect(panel.getByText('Deleted on Facebook.', { exact: true })).toHaveCount(0);
  await openManagement();
  await check.click();
  await expect(panel.getByRole('alert')).toContainText('Check Facebook and contact support');
  await expect(panel.getByRole('button', { name: 'Delete from Facebook', exact: true })).toHaveCount(0);
  const after = await evidence(context.request);
  expect(after.calls.filter((call: any) => call.method === 'DELETE')).toEqual([{ id: target.releaseId, method: 'DELETE' }]);
  expect(after.posts.find((post: any) => post.id === target.id)).toEqual(target);
});

test('Facebook management: stale editor cannot overwrite newer confirmed text', async ({ page, context }, info) => {
  await openPost(page, info);
  const panel = page.getByRole('region', { name: 'Facebook text post management' });
  await expect(panel.getByRole('textbox')).toHaveValue('Original Browser Page A text');
  await expect(panel.getByRole('textbox')).toBeEnabled();
  const post = (await evidence(context.request)).posts[0];
  const status = await (await context.request.get(`${api}/posts/${post.id}/facebook-published`)).json();
  const updated = await context.request.post(`${api}/posts/${post.id}/facebook-published`, { data: { action: 'edit', revision: status.revision, message: 'Newer confirmed text' } });
  expect(updated.ok()).toBeTruthy();
  await panel.getByRole('textbox').fill('Stale editor text');
  await panel.getByRole('button', { name: 'Save Facebook message' }).click();
  await expect(panel.getByRole('alert')).toContainText('Reload before editing');
  const proof = await evidence(context.request);
  expect(proof.posts[0].content).toBe('Newer confirmed text');
  expect(proof.calls.filter((call: any) => call.method === 'POST' && !call.id.endsWith('/feed'))).toHaveLength(1);
});

test('Facebook management: unauthorized member sees actionable restriction without mutation controls', async ({ page, context }, info) => {
  await reset(context.request, { role: 'USER' });
  await openPost(page, info);
  const panel = page.getByRole('region', { name: 'Facebook text post management' });
  await expect(panel.getByRole('alert')).toContainText('administrator');
  await expect(panel.getByRole('textbox')).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'Delete from Facebook', exact: true })).toHaveCount(0);
  const proof = await evidence(context.request);
  const denied = await context.request.post(`${api}/posts/${proof.posts[0].id}/facebook-published`, { data: { action: 'delete', revision: 0 } });
  expect(denied.status()).toBe(403);
  expect((await evidence(context.request)).calls.filter((call: any) => call.method === 'DELETE')).toHaveLength(0);
  await noHorizontalOverflow(page);
});


test('Facebook management: loading waits for the real status response before exposing controls', async ({ page }, info) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route(`${browserOrigin}/backend-api/posts/*/facebook-published`, async route => {
    if (route.request().method() === 'GET') await gate;
    await route.continue();
  });
  try {
    await openPost(page, info);
    const panel = page.getByRole('region', { name: 'Facebook text post management' });
    await expect(panel.getByRole('status')).toHaveText('Loading Facebook post actions…');
    await expect(panel.getByRole('textbox')).toHaveCount(0);
    release();
    await expect(panel.getByRole('textbox')).toHaveValue('Original Browser Page A text');
  } finally { release(); }
});
