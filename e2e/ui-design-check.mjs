// Browser acceptance for plan 0021. Product responses are explicitly fixtures.
// Optional LOCAL_ADMIN_TOKEN verifies real local read-only admin access.
// Run with PLAYWRIGHT_MODULE pointing to an installed playwright index.mjs,
// or install playwright in the environment. Screenshots default to /tmp.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const out = process.env.UI_EVIDENCE_DIR || '/tmp/transcode-path-a';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const errors = [];
const results = [];
const profile = { email: 'demo@example.test', name: 'Demo', account_status: 'active', key_prefix: 'tc_demo', member_since: '2026-09-01T12:00:00Z' };
const asset = { id: 'asset_demo_1234567890', asset_id: 'asset_demo_1234567890', status: 'ready', encoding_tier: 'standard', created_at: '2026-09-20T12:00:00Z', duration_sec: 60, width: 1920, height: 1080, renditions: [{codec:'h264', resolution:'1920x1080', bitrate_kbps:4000, status:'completed'}], jobs:[{kind:'abr',status:'completed'}] };
const operation = { operation_id:'op_demo_123', request_id:'request_demo_123', protocol:'paid-job/v1', kind:'job', asset_id:asset.id, state:'settled', work_unit:'video-frame-megapixel', claimed_units:'4200', delivered_units:null, balance_units:null, warnings:[], terminal_at:'2026-09-20T12:02:00Z', error_code:null, recovered:false };
const stream = { stream_id:'live_demo_123', name:'Demo broadcast', status:'ended', created_at:'2026-09-20T12:00:00Z', rtmp_push_url:'rtmp://localhost:1935/live/demo-fixture', rtmp_push_url_kind:'gateway_relay', _ended:true, paid_operation:{...operation, protocol:'paid-session/v1',kind:'session',work_unit:'output_seconds',claimed_units:'60',delivered_units:'60'} };
async function capture(page, name) {
  await page.evaluate(() => Promise.all(document.getAnimations().map(a => a.finished.catch(() => {}))));
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: true });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  assert.equal(overflow, false, `${name}: page overflows horizontally`);
  results.push(name);
}
async function context(viewport) {
  const c = await browser.newContext({ viewport, colorScheme:'light' });
  c.on('page', p => p.on('pageerror', e => errors.push(e.message)));
  return c;
}
async function fixtures(c, mode='normal') {
  await c.addInitScript(({profile,stream}) => {
    if (!location.href.startsWith('http://localhost:')) return;
    sessionStorage.setItem('lmt-session-token','sess_visual_fixture');
    sessionStorage.setItem('lmt-api-key','tc_visual_fixture');
    sessionStorage.setItem('lmt-user-profile',JSON.stringify(profile));
    sessionStorage.setItem('lmt-admin-token','visual_fixture');
    sessionStorage.setItem('lmt-live-streams',JSON.stringify([stream]));
  }, {profile,stream});
  await c.route(/\/(api\/v1|v1)\//, async route => {
    const path = new URL(route.request().url()).pathname;
    if (mode==='error') return route.fulfill({status:503,json:{message:'Fixture: temporarily unavailable'}});
    let body;
    if(path.endsWith('/profile')) body=profile;
    else if(path.endsWith('/videos/assets')) body={items:mode==='empty'?[]:[asset], pagination:{next_cursor:null}};
    else if(path.includes('/videos/assets/')) body={...asset,paid_operation:operation};
    else if(path.endsWith('/live/streams')) body={streams:mode==='empty'?[]:[stream]};
    else if(path.includes('/live/streams/')) body=stream;
    else if(path.endsWith('/catalog')) body={source:'LOC',price_basis:'network_wholesale',fetched_at:'2026-09-23T12:00:00Z',items:mode==='empty'?[]:[{name:'video:transcode.abr',work_unit:'video-frame-megapixel',offerings:[{id:'abr-default',protocol:'paid-job/v1',price_per_work_unit_wei:'1629000000000',units_per_price:'1000',configured_for_gateway:true,job:{transports:['stream']}}]}]};
    else if(path.endsWith('/stats')) body={total_signups:24,today:2,this_week:8,this_month:24,daily_counts:[{date:'2026-09-20',count:2},{date:'2026-09-21',count:4}]};
    else if(path.endsWith('/operations')) body={items:mode==='empty'?[]:[operation]};
    else if(path.endsWith('/waitlist')) body={data:mode==='empty'?[]:[{id:'signup_demo',email:'demo@example.test',name:'Demo user',status:'pending',email_verified:true,created_at:'2026-09-20T12:00:00Z'}],pagination:{total_pages:1}};
    else if(path.endsWith('/logout')) body={ok:true};
    else throw new Error(`Unhandled fixture request: ${route.request().method()} ${path}`);
    await route.fulfill({json:body});
  });
}
try {
  for(const width of [1440,390]) {
    const suffix=width===1440?'desktop':'mobile';
    const c=await context({width,height:1000});
    const p=await c.newPage();
    await p.goto('http://localhost:3000');
    await p.locator('lmt-signup-form input').first().waitFor();
    assert.equal(await p.locator('html').getAttribute('data-theme'),'dark');
    assert.equal(await p.getByRole('link',{name:'Portal',exact:true}).getAttribute('href'),'http://localhost:3002/');
    await capture(p,`site-${suffix}`);
    await p.goto('http://localhost:3000/verify.html');
    await p.getByRole('status').waitFor(); await capture(p,`verify-${suffix}`);
    for(const [area,port] of [['portal',3002],['admin',3001]]) {
      await p.goto(`http://localhost:${port}`);
      await p.locator('input[type=password]').waitFor();
      assert.equal(await p.locator('html').getAttribute('data-theme'),'dark');
      await capture(p,`${area}-login-${suffix}`);
    }
    await c.close();
    const f=await context({width,height:1000}); await fixtures(f);
    const page=await f.newPage();
    for(const [area,port,routes] of [['portal',3002,['dashboard','account','assets','assets/'+asset.id,'upload','live','live/'+stream.stream_id,'catalog']],['admin',3001,['dashboard','signups','operations','catalog']]]) {
      for(const route of routes) {
        await page.goto(`http://localhost:${port}/?visual=${encodeURIComponent(route)}#${route}`);
        await page.locator('.shell-content').waitFor();
        await page.waitForFunction(() => !document.querySelector('main')?.textContent.includes('Loading…') && !document.querySelector('main')?.textContent.includes('Loading assets…') && !document.querySelector('main')?.textContent.includes('Loading capabilities…'));
        await page.locator('.shell-content > *').waitFor();
        const geometry=await page.evaluate(() => ({height:document.querySelector('.shell-topbar').getBoundingClientRect().height, heading:getComputedStyle(document.querySelector('main h1, main h2')).fontSize}));
        assert.equal(geometry.height,44,`${area} header height`);
        assert.equal(await page.locator('.sidebar-item[aria-current="page"]').getAttribute('href'), `#${route.split('/')[0]}`);
        assert.equal(geometry.heading,'20px');
        await capture(page,`fixture-${area}-${route.replaceAll('/','-')}-${suffix}`);
        if(route==='account') {
          await page.getByRole('button',{name:'Rotate API key…',exact:true}).click();
          await capture(page,`fixture-key-confirm-${suffix}`);
          await page.getByRole('button',{name:'Cancel',exact:true}).click();
        }
      }
      if(width===390) {
        await page.getByRole('button',{name:'Open navigation',exact:true}).click();
        await page.locator('.shell-sidebar.open').waitFor();
        await capture(page,`fixture-${area}-drawer-${suffix}`);
        assert.equal(await page.evaluate(()=>document.activeElement.classList.contains('drawer-close')),true);
        await page.keyboard.press('Shift+Tab');
        assert.equal(await page.evaluate(()=>document.activeElement===document.querySelector('.shell-sidebar nav a:last-child')),true);
        await page.keyboard.press('Tab');
        assert.equal(await page.evaluate(()=>document.activeElement.classList.contains('drawer-close')),true);
        await page.keyboard.press('Escape');
        await page.waitForFunction(()=>document.activeElement.classList.contains('hamburger'));
        assert.equal(await page.evaluate(()=>document.activeElement.classList.contains('hamburger')),true);
        await page.getByRole('button',{name:'Open navigation',exact:true}).click();
        await page.locator('.shell-sidebar a').first().click();
        await page.locator('.shell-sidebar.open').waitFor({state:'hidden'});
        await page.getByRole('button',{name:'Open navigation',exact:true}).click();
        await page.locator('.sidebar-item[aria-current="page"]').click();
        await page.locator('.shell-sidebar.open').waitFor({state:'hidden'});
        await page.getByRole('button',{name:'Open navigation',exact:true}).click();
        await page.locator('.shell-sidebar-backdrop').click({position:{x:370,y:700}});
        await page.locator('.shell-sidebar.open').waitFor({state:'hidden'});
      }
      await page.getByRole('button',{name:'Toggle theme'}).click();
      await page.reload();
      assert.equal(await page.locator('html').getAttribute('data-theme'),'light');
      await capture(page,`fixture-${area}-light-${suffix}`);
      await page.getByRole('button',{name:'Toggle theme'}).click();
    }
    await f.close();
  }
  for(const mode of ['empty','error']) {
    const c=await context({width:1440,height:1000}); await fixtures(c,mode); const p=await c.newPage();
    for(const [port,route] of [[3002,'dashboard'],[3002,'assets'],[3001,'signups'],[3001,'operations'],[3001,'catalog'],[3002,'catalog']]) {
      await p.goto(`http://localhost:${port}/?visual=${encodeURIComponent(route)}#${route}`);
      await p.locator('main').waitFor();
      await p.waitForFunction(()=>!document.querySelector('main').textContent.includes('Loading'));
      await capture(p,`fixture-${port}-${route}-${mode}`);
    }
    await c.close();
  }
  // Exercise public form feedback with intercepted responses: no email sent.
  {
    const c=await context({width:390,height:1000}); const p=await c.newPage();
    await c.route('**/api/v1/waitlist',r=>r.fulfill({json:{message:'Fixture: check your inbox.'}}));
    await c.route('**/api/v1/waitlist/verify?*',r=>r.fulfill({json:{status:'verified'}}));
    await p.goto('http://localhost:3000');
    await p.getByLabel('Name',{exact:true}).fill('Demo');
    await p.getByLabel('Email',{exact:true}).fill('demo@example.test');
    await p.getByRole('button',{name:'Join the waitlist'}).click();
    await p.getByRole('status').waitFor(); await capture(p,'fixture-signup-success-mobile');
    await p.goto('http://localhost:3000/verify.html?token=fixture');
    await p.getByText('Email verified.',{exact:false}).waitFor(); await capture(p,'fixture-verify-success-mobile');
    await p.goto('http://localhost:3002');
    await p.getByLabel('API key',{exact:true}).fill('invalid-key');
    await p.getByRole('button',{name:'Sign in',exact:true}).click();
    await p.getByRole('alert').waitFor(); await capture(p,'portal-invalid-key-mobile');
    await c.close();
  }
  if(process.env.LOCAL_ADMIN_TOKEN) {
    const c=await context({width:1440,height:1000}); const p=await c.newPage();
    await p.goto('http://localhost:3001');
    await p.getByLabel('Admin token').fill(process.env.LOCAL_ADMIN_TOKEN);
    await p.getByRole('button',{name:'Sign in',exact:true}).click();
    await p.getByRole('heading',{name:'Overview',exact:true}).waitFor();
    await capture(p,'real-local-admin-overview');
    await p.getByRole('button',{name:'Sign out'}).click();
    await p.getByRole('heading',{name:'Operator login'}).waitFor(); await c.close();
  }
  assert.deepEqual(errors,[], 'Browser page errors');
  await writeFile(`${out}/results.json`,JSON.stringify({screens:results,pageErrors:errors},null,2));
  console.log(`PASS: ${results.length} screenshots, desktop/mobile routes, drawer keyboard/dismissal, dark default, light persistence, no page errors. Evidence: ${out}`);
} finally { await browser.close(); }
