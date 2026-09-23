import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true });
const p = await browser.newPage(); const errors=[]; p.on('pageerror', e=>errors.push(e.message));
let created=false, state='opening', creates=0;
const operation=()=>({ state: state==='ending'?'winddown_pending':state==='ended'?'settled':state==='ready'?'active':'opening', protocol:'paid-session/v1', warnings:[], work_unit:'output_seconds', funded_units:'60', claimed_units:'0', balance_units:'60', winddown_reason:state==='ending'?'customer_end':null });
const stream=()=>({stream_id:'live_fixture',name:'Recovery demo',status:state,created_at:new Date().toISOString(),paid_operation:operation(),...(state==='ready'?{stream_key:'customer-fixture',rtmp_push_url:'rtmp://localhost:1935/live'}:{})});
try {
  await p.addInitScript(()=>{sessionStorage.setItem('lmt-session-token','sess_fixture');sessionStorage.setItem('lmt-api-key','tc_fixture');sessionStorage.setItem('lmt-user-profile',JSON.stringify({name:'Demo',email:'demo@example.test'}));});
  await p.route(/\/(api\/v1|v1)\//, async r=>{
    const path=new URL(r.request().url()).pathname, method=r.request().method();
    if(path.endsWith('/profile'))return r.fulfill({json:{name:'Demo',email:'demo@example.test'}});
    if(path.endsWith('/live/streams') && method==='POST'){created=true;creates++;return r.fulfill({status:202,json:stream()});}
    if(path.endsWith('/live/streams'))return r.fulfill({json:{streams:created?[stream()]:[]}});
    if(path.endsWith('/end')){state='ending';return r.fulfill({status:202,json:{status:'ending'}});}
    if(path.includes('/live/streams/'))return r.fulfill({json:stream()});
    throw new Error(`Unexpected fixture ${method} ${path}`);
  });
  await p.goto('http://localhost:3002/#live');
  await p.getByRole('button',{name:'Create',exact:true}).click();
  await p.getByRole('cell',{name:'opening',exact:true}).waitFor();
  assert.equal(await p.getByRole('button',{name:'Create',exact:true}).isDisabled(),true);
  await p.getByRole('link',{name:'View details',exact:true}).click();
  await p.getByRole('status').filter({hasText:'setup is pending'}).waitFor();
  state='ready'; await p.getByLabel('Stream key',{exact:true}).waitFor({timeout:10000});
  assert.equal(await p.getByLabel('Stream key',{exact:true}).inputValue(),'customer-fixture');
  await p.getByRole('link',{name:'← Back to live streams',exact:true}).click();
  await p.getByRole('cell',{name:'ready',exact:true}).waitFor();
  p.on('dialog',d=>d.accept());await p.getByRole('button',{name:'End',exact:true}).click();
  await p.getByRole('cell',{name:'ending',exact:true}).waitFor();
  assert.equal(await p.getByRole('cell',{name:'ended',exact:true}).count(),0);
  state='ended';await p.getByRole('cell',{name:'ended',exact:true}).waitFor({timeout:10000});
  await p.reload();await p.getByRole('cell',{name:'ended',exact:true}).waitFor();
  assert.equal(creates,1);assert.deepEqual(errors,[]);
  console.log('PASS: pending create retained, duplicate disabled, ready credentials shown, asynchronous end tracked, reload restores stream; all API responses mocked.');
} finally {await browser.close();}
