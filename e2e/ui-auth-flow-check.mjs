// Browser regression: all mail/approval mutations below are intercepted fixtures.
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser=await chromium.launch();
try {
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  await context.addInitScript(()=>{if(location.origin==='http://localhost:3001')sessionStorage.setItem('lmt-admin-token','fixture');});
  const p=await context.newPage();const errors=[];p.on('pageerror',e=>errors.push(e.message));p.on('dialog',d=>d.accept());
  let verified=false,approved=false,resends=0;
  const id='00000000-0000-4000-8000-000000000001';
  await context.route('**/api/**',async r=>{
    const path=new URL(r.request().url()).pathname;
    let body;
    if(path.endsWith('/waitlist'))body={data:approved?[]:[{id,email:'demo@example.test',name:'Demo',status:'pending',email_verified:verified,created_at:'2026-09-23T12:00:00Z'}],pagination:{total_pages:1}};
    else if(path.endsWith('/approve')){
      if(!verified)body={approved:0,skipped:[{id,reason:'email_not_verified'}],keys:[],emails_sent:0,email_errors:[]};
      else {approved=true;body={approved:1,skipped:[],keys:[{waitlist_id:id,email:'demo@example.test',key:'tc_fixture_one_time_key'}],emails_sent:0,email_errors:['demo@example.test: Fixture provider failure']};}
    } else if(path.endsWith('/resend-verification')){resends++;body={status:'ok',delivery:'accepted'};}
    else throw new Error('Unexpected fixture request: '+path);
    await r.fulfill({json:body});
  });
  await p.goto('http://localhost:3001/#signups');
  await p.getByLabel('Select demo@example.test',{exact:true}).check();
  await p.getByRole('button',{name:'Approve',exact:true}).click();
  await p.getByRole('status').filter({hasText:'Verify email first'}).waitFor();
  assert.equal(await p.getByLabel('Select demo@example.test',{exact:true}).isChecked(),true);
  await p.screenshot({path:'/tmp/transcode-path-a/fixture-approval-unverified.png',fullPage:true});
  await p.getByRole('button',{name:'Resend verification',exact:true}).click();
  await p.getByRole('status').filter({hasText:'accepted by the provider'}).waitFor();assert.equal(resends,1);
  verified=true;
  await p.getByRole('button',{name:'Refresh',exact:true}).click();
  await p.getByRole('button',{name:'Approve',exact:true}).click();
  await p.getByText('tc_fixture_one_time_key',{exact:true}).waitFor();
  await p.getByText('No signups match.',{exact:true}).waitFor();
  await p.getByRole('status').filter({hasText:'Fixture provider failure'}).waitFor();
  assert.equal(await p.getByRole('heading',{name:'New API keys — save now'}).count(),1);
  await p.screenshot({path:'/tmp/transcode-path-a/fixture-approval-key-survives-filter.png',fullPage:true});
  await p.getByRole('button',{name:'Dismiss keys',exact:true}).click();
  assert.equal(await p.getByText('tc_fixture_one_time_key',{exact:true}).count(),0);
  assert.deepEqual(errors,[]);
  console.log('PASS: visible unverified rejection, retained selection, resend acceptance, provider errors and one-time key retained after pending row disappears; all mutations mocked.');
}finally{await browser.close();}
