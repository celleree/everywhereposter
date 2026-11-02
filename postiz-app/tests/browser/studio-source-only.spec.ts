import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';

test.skip(process.env.EP_STUDIO_BROWSER !== '1', 'Requires explicitly owned offline Studio runtime');
test.setTimeout(900_000);
test.use({ actionTimeout: 30_000 });
test('owned source -> native evidence -> real wallet -> private render -> exact review -> composer', async ({ page, context, request }, info) => {
  const origin = 'http://127.0.0.1:4647', api = 'http://127.0.0.1:4648';
  const { token, otherToken, replay, scope } = await (await request.get(api + '/__studio/session')).json();
  await context.addCookies([{ name: 'auth', value: token, url: origin, httpOnly: true, sameSite: 'Lax' }]);
  if (replay) await context.addInitScript(({ scope, body }) => localStorage.setItem('everywhereposter:studio-request:v1:' + scope, JSON.stringify(body)),
    { scope, body: replay.request });
  const outside: string[] = [], reachedOutside: string[] = [], postMutations: string[] = [];
  await context.route('**/*', route => {
    const r = route.request(), url = new URL(r.url());
    if (url.origin !== origin) { outside.push(url.origin); return route.abort('blockedbyclient'); }
    if (/^\/backend-api\/posts(?:\/|$)/.test(url.pathname) && r.method() !== 'GET') {
      postMutations.push(url.pathname); return route.abort('blockedbyclient');
    }
    return route.continue();
  });
  page.on('response', r => { if (new URL(r.url()).origin !== origin) reachedOutside.push(r.url()); });
  const stats = async () => (await page.request.get('/backend-api/__studio/stats')).json();
  await page.goto('/video-editor');
  const studio = page.getByRole('region', { name: 'Studio results' });
  let job: any;
  if (!replay) {
  await expect(studio.getByRole('button', { name: 'Upload or choose source', exact: true })).toBeVisible({ timeout: 60000 });
  await studio.getByRole('button', { name: 'Upload or choose source', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Media Library', exact: true });
  await picker.getByRole('button', { name: 'Select Owned portrait source.mp4', exact: true }).click({ position: { x: 10, y: 10 } });
  if (await picker.isVisible()) await picker.getByRole('button', { name: 'Add selected media', exact: true }).click();
  await expect(picker).toHaveCount(0);
  await expect(studio.getByRole('button', { name: 'Choose optional supporting visuals (0/8)' })).toBeVisible();
  // Synthetic source and explicit synthetic framing; no detection or real-person acceptance claim.
  await studio.getByRole('button', { name: 'Adjust speaker area', exact: true }).click();
  const original = studio.getByLabel('Original video for speaker framing');
  await original.evaluate(v => v.scrollIntoView({ block: 'center' }));
  const rectangle = (await original.boundingBox())!;
  await page.mouse.move(rectangle.x + rectangle.width * .28, rectangle.y + rectangle.height * .5);
  await page.mouse.down();
  await page.mouse.move(rectangle.x + rectangle.width * .72, rectangle.y + rectangle.height * .74);
  await page.mouse.up();
  await studio.getByLabel('I checked that this outlined area contains one stationary speaker throughout the clip.').check();
  const created = page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith('/media/studio/jobs'));
  await studio.getByRole('button', { name: 'Create Studio edit (uses AI credits)', exact: true }).click();
  const response = await created; expect(response.ok()).toBe(true);
  job = await response.json(); const base = '/backend-api/media/studio/jobs/' + job.id;
  const early = await page.request.get(base + '/preview');
  expect(early.status()).toBe(409);
  const before = await stats();
  expect(before.outputs).toHaveLength(0); expect(before.jobs[0].reviewedAt).toBeNull();
  const foreign = await page.request.get(base, { headers: { Cookie: 'auth=' + otherToken } });
  expect([403, 404]).toContain(foreign.status());
  const anonymous = await request.get(api + '/media/studio/jobs/' + job.id + '/preview');
  expect(anonymous.status()).toBe(403);
  } else job = { id: replay.jobId };
  const base = '/backend-api/media/studio/jobs/' + job.id;
  const ready = async () => (await page.request.get(base)).json();
  await expect.poll(async () => {
    const state = await ready();
    if (state.phase) throw Error(JSON.stringify(state));
    return state.technicalStatus;
  }, { timeout: 720000, intervals: [3000] }).toBe('PASS');
  await studio.getByRole('button', { name: 'Refresh result', exact: true }).click();
  const video = studio.getByLabel('Studio video to review');
  await expect(video).toBeVisible({ timeout: 30000 });
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThanOrEqual(1);
  await video.evaluate((v: HTMLVideoElement) => v.play());
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(0.2);
  await video.evaluate((v: HTMLVideoElement) => v.pause());
  const range = await page.request.get(base + '/preview', { headers: { Range: 'bytes=0-1023' } });
  expect(range.status()).toBe(206); expect(range.headers()['cache-control']).toBe('private, no-store');
  expect(range.headers()['content-range']).toMatch(/^bytes 0-1023\//);
  await page.screenshot({ path: info.outputPath('studio-private-preview.png'), fullPage: true });
  await page.reload();
  await expect(studio.getByLabel('Studio video to review')).toBeVisible({ timeout: 30000 });
  await studio.getByRole('button', { name: 'Recover last edit request', exact: true }).click();
  await expect(studio.getByRole('button', { name: 'Recover last edit request', exact: true })).toBeEnabled({ timeout: 30000 });
  const recovered = await stats();
  expect(recovered.jobs).toHaveLength(1); expect(recovered.jobs[0].id).toBe(job.id);
  expect(recovered.nativeDispatches).toBe(1); expect(recovered.paidCompletions).toBe(1);
  expect(recovered.ledger).toHaveLength(1); expect(recovered.outputs).toHaveLength(replay?.reviewed ? 1 : 0);
  const current = await ready(), approval = { generation: current.generation, sha256: current.sha256, reviewed: true };
  if (current.state !== 'REVIEWED') {
    await expect(studio.getByRole('button', { name: 'Save reviewed copy', exact: true })).toBeDisabled();
    const stale = await page.request.post(base + '/review', { headers: { Origin: origin }, data: { ...approval, generation: current.generation + 1 } });
    expect(stale.status()).toBe(409);
    await studio.getByLabel('I have watched and listened to this version and approve saving this copy.').check();
    await expect(studio.getByRole('button', { name: 'Save reviewed copy', exact: true })).toBeEnabled();
    const saved = page.waitForResponse(r => r.url().endsWith(base + '/review') && r.request().method() === 'POST');
    await studio.getByRole('button', { name: 'Save reviewed copy', exact: true }).click();
    expect((await saved).ok()).toBe(true);
    await expect.poll(async () => (await ready()).state).toBe('REVIEWED');
  }
  const savedState = await ready(), output = await (await page.request.get('/backend-api/media/' + savedState.outputMediaId)).json();
  const reviewReplay = await request.post(api + '/media/studio/jobs/' + job.id + '/review', { headers: { auth: token, Origin: origin }, data: approval });
  expect(reviewReplay.ok()).toBe(true); expect((await reviewReplay.json()).outputMedia.id).toBe(output.id);
  const bytes = await page.request.get('/backend-api' + new URL(output.path).pathname);
  expect(bytes.ok()).toBe(true);
  expect(createHash('sha256').update(await bytes.body()).digest('hex')).toBe(current.sha256);
  await studio.getByRole('button', { name: 'Use in composer', exact: true }).click();
  const composer = page.locator('#social-content');
  await expect(composer).toBeVisible(); const attached = composer.locator('video').first();
  await expect(attached).toHaveAttribute('src', output.path);
  await expect.poll(() => attached.evaluate((v: HTMLVideoElement) => v.readyState), { timeout: 30000 }).toBeGreaterThanOrEqual(2);
  await attached.evaluate((v: HTMLVideoElement) => v.play());
  await expect.poll(() => attached.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(1.1);
  await attached.evaluate((v: HTMLVideoElement) => v.pause());
  await page.screenshot({ path: info.outputPath('studio-composer.png'), fullPage: true });
  const final = await stats(), plan = final.files['authored-plan.json'].value.manifest.project, evidence = final.files['evidence.json'].value;
  expect(final.jobs).toHaveLength(1); expect(final.outputs).toHaveLength(1); expect(final.outputs[0].id).toBe(output.id);
  expect(final.nativeDispatches).toBe(1); expect(final.paidCompletions).toBe(1); expect(final.ledger).toHaveLength(1);
  expect(final.operations[0]).toMatchObject({ state: 'SETTLED', chargedNanos: '40' });
  expect(final.currentHash).toBe(final.originalHash);
  expect(final.audioProof).toHaveLength(1); expect(final.audioProof[0].alignedPcmSha256).toBe(final.audioProof[0].sourcePcmSha256); expect(plan.profile).toBe('talking-head-v2');
  expect(plan.cuts.map(({ in: start, out }: any) => ({ in: start, out }))).toEqual([{ in: 0, out: plan.source.frames }]); expect(plan.effects).toEqual([]); expect(plan.broll).toEqual([]);
  const words = evidence.files.words.value.filter((w: any) => w.type === 'word' || w.type === undefined)
    .map((w: any, i: number) => ({ id: 'w' + i, text: (w.text ?? w.word).trim(), start: w.start, end: w.end }));
  expect(plan.words).toEqual(words);
  expect(plan.title.text).toBe(plan.title.wordIds.map((id: string) => words.find((w: any) => w.id === id).text).join(' '));
  expect(plan.title.wordIds.length).toBeGreaterThanOrEqual(3);
  expect(final.commands.some((c: any) => c.args?.some((a: string) => /title-preflight/.test(a)))).toBe(true);
  expect(final.postWrites).toBe(0); expect(postMutations).toEqual([]); expect(reachedOutside).toEqual([]);
  await info.attach('studio-offline-integration-evidence', { body: JSON.stringify({
    jobId: job.id, generation: current.generation, outputMediaId: output.id, artifactSha256: current.sha256, sourceSha256: final.originalHash,
    authoritativeCounts: { jobs: final.jobs.length, outputs: final.outputs.length, reservations: final.operations.length, ledger: final.ledger.length },
    instrumentation: { origin: final.instrumentationOrigin, native: final.nativeDispatches, syntheticCompletions: final.paidCompletions },
    evidencePaths: [...final.artifacts.map((a: any) => a.path), ...Object.values(final.files).map((a: any) => a.path)],
    blockedOutsideOrigins: outside, reachedOutside,
    acceptance: 'SYNTHETIC_OFFLINE_INTEGRATION; SEMANTIC_QUALITY_PENDING; HUMAN_CREATIVE_REVIEW_PENDING'
  }, null, 2), contentType: 'application/json' });
});
