const { chromium, devices, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const hash = bytes => require('node:crypto').createHash('sha256').update(bytes).digest('hex');
const sourceFixture = path.resolve(__dirname, '../browser/assets/synthetic-picker.mp4');
const originalHash = hash(fs.readFileSync(sourceFixture));
const output = process.env.EP_PREVIEW_OUTPUT || '/tmp/ep-design-preview';
const origin = 'http://127.0.0.1:4317';
const states = ['empty','selected','uploading','preparing','review','no-blocks','load-error','expired','uncertain-save','saving','saved','composer','attached'];
(async () => {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.EP_PREVIEW_CHROMIUM || '/usr/bin/chromium', args: ['--no-sandbox'] });
  const results = [], errors = [], external = [], writes = [];
  try {
    for (const [name, options] of [ ['desktop', {viewport:{width:1440,height:1000}}], ['iphone-small-chromium', {...devices['iPhone SE'], defaultBrowserType:undefined}], ['android-chromium', {...devices['Pixel 7']}], ['narrow-chromium',{viewport:{width:320,height:740},hasTouch:true,isMobile:true}], ['landscape-chromium',{viewport:{width:844,height:390},hasTouch:true,isMobile:true}] ]) {
      const context = await browser.newContext({...options, deviceScaleFactor:1, reducedMotion:'reduce'});
      await context.route('**/*', route => { if (!['GET','HEAD'].includes(route.request().method())) writes.push(route.request().url()); return new URL(route.request().url()).origin === origin ? route.continue() : (external.push(route.request().url()),route.abort()); });
      const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
      for (const state of states) {
        await page.goto(origin + '/?state=' + state); await expect(page.locator('h1')).toBeVisible(); await page.locator('video,img').evaluateAll(elements => Promise.all(elements.map(el => el.tagName === 'IMG' ? el.decode().catch(()=>{}) : Promise.resolve())));
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1); expect(overflow, name + '/' + state + ' horizontal overflow').toBe(false);
        if (state !== 'attached' && state !== 'empty') { const button = page.locator('.action-bar button'); await button.scrollIntoViewIfNeeded(); await expect(button).toBeInViewport(); const hit = await button.evaluate(el => { const r=el.getBoundingClientRect(), hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2); return !!hit && el.contains(hit); }); expect(hit, name+'/'+state+' primary is unobscured').toBe(true); }
        if (['desktop','iphone-small-chromium','android-chromium'].includes(name)) { await page.evaluate(()=>scrollTo(0,0)); await page.screenshot({path:path.join(output, name+'-'+state+'.png'), fullPage:true}); if (['empty','review','saved','composer'].includes(state)) await page.screenshot({path:path.join(output,name+'-'+state+'-viewport.png')}); }
        results.push({name,state,overflow});
      }
      await page.goto(origin); await page.getByRole('button',{name:'Choose from Media Library'}).click();
      await expect(page.locator('.steps [aria-current=step]')).toContainText('Choose video');
      await page.getByRole('button',{name:'Prepare for review'}).evaluate(b=>{b.click();b.click()}); await expect(page.getByRole('button',{name:'Preparing video…'})).toBeDisabled();
      await expect(page.getByRole('button',{name:'Cut block 1',exact:true})).toBeEnabled();
      const cut=page.getByRole('button',{name:'Cut block 1',exact:true}); await cut.scrollIntoViewIfNeeded(); await cut.focus(); await page.keyboard.press('Enter');
      await expect(page.getByRole('button',{name:'Restore block 1',exact:true})).toBeVisible();
      await page.getByRole('button',{name:'Save a separate copy'}).evaluate(b=>{b.click();b.click()}); await expect(page.getByRole('button',{name:'Saving copy…'})).toBeDisabled();
      await expect(page.getByText('Separate copy saved · revision 1')).toBeVisible();
      await page.getByRole('button',{name:'Restore block 1',exact:true}).click(); await expect(page.locator('.action-bar')).toContainText('Saved revision 1 is unchanged.');
      await page.getByRole('button',{name:'Save updated copy'}).click(); await expect(page.getByText('Separate copy saved · revision 2')).toBeVisible();
      await page.getByRole('button',{name:'Open post composer'}).click(); await expect(page.locator('h1')).toBeFocused();
      await page.locator('input[type=checkbox]').uncheck(); await expect(page.getByRole('button',{name:'Attach to preview draft'})).toBeDisabled(); await page.locator('input[type=checkbox]').check();
      await page.getByLabel('Caption',{exact:true}).fill('A test caption from the preview.'); await expect(page.locator('.post-preview')).toContainText('A test caption from the preview.');
      await page.getByRole('button',{name:'Attach to preview draft'}).click(); await expect(page.getByRole('status')).toContainText('Nothing was saved to your account');
      await page.goto(origin+'/?state=uncertain-save'); await expect(page.getByRole('button',{name:'Save a separate copy'})).toHaveCount(0); await page.getByRole('button',{name:'Check sample Media Library'}).click(); await expect(page.getByRole('button',{name:'Open post composer'})).toBeEnabled();
      await page.goto(origin+'/?state=preparing'); await page.reload(); await expect(page.getByRole('button',{name:'Preparing video…'})).toBeDisabled();
      await page.goto(origin); await page.getByLabel('Upload prototype video').setInputFiles({name:'sample.mov',mimeType:'video/quicktime',buffer:Buffer.from('fixture')}); await expect(page.getByRole('button',{name:'Uploading video…'})).toBeDisabled(); await expect(page.getByRole('button',{name:'Prepare for review'})).toBeEnabled();
      expect(await page.evaluate(()=>localStorage.length)).toBe(0);
      expect(hash(fs.readFileSync(sourceFixture))).toBe(originalHash);
      results.push({name,journey:'PASS',sourceFixtureHashUnchanged:true});
      await context.close();
    }
    expect(errors).toEqual([]); expect(external).toEqual([]); expect(writes).toEqual([]);
    fs.writeFileSync(path.join(output,'verification.json'),JSON.stringify({fixtureOnly:true,browser:await browser.version(),states:results,errors,external,writes,sourceFixtureSha256:originalHash,nativeWebkit:false},null,2));
    console.log(`PASS: ${results.filter(r=>r.state).length} state/viewports; 5 complete journeys; zero backend/external requests. Screenshots: ${output}`);
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1});
