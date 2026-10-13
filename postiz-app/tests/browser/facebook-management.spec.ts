import { test, expect, openApp, noHorizontalOverflow, capture, mobileProject, browserOrigin, reachable } from './fixtures';
import type { Page, APIRequestContext, TestInfo } from '@playwright/test';

test.skip(process.env.EP_FACEBOOK_BROWSER !== '1', 'Requires the explicitly isolated PostgreSQL adapter');
const api = `http://127.0.0.1:${process.env.BROWSER_API_PORT || '4218'}`;
async function reset(request: APIRequestContext, data: object = {}) {
  const result = await request.post(`${api}/__facebook/reset`, { data });
  expect(result.ok(), await result.text()).toBeTruthy();
}
async function evidence(request: APIRequestContext) { return (await request.get(`${api}/__facebook/evidence`)).json(); }
async function openPost(page: Page, info: TestInfo, name = 'Browser Page A') {
  await openApp(page, '/launches?display=list');
  if (mobileProject(info)) {
    await page.getByRole('button', { name: 'All posts', exact: true }).click();
    await page.getByRole('button', { name: `Details: ${name}`, exact: true }).click();
  } else await page.getByText(`Original ${name} text`, { exact: true }).first().click();
  await page.getByRole('button', { name: 'Edit Post', exact: true }).click();
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
  const remove = panel.getByRole('button', { name: 'Delete from Facebook', exact: true });
  await remove.click();
  const confirmation = panel.getByRole('alertdialog');
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
  await page.reload();
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
  await page.route(`${browserOrigin}/backend-api/posts`, route => {
    if (route.request().method() === 'POST') expect(route.request().postDataJSON().submissionId).toMatch(/^[0-9a-f-]{36}$/);
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
  await noHorizontalOverflow(page);
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
