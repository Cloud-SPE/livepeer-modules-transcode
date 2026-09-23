import { test } from "node:test";
import assert from "node:assert/strict";
import { resendVerification } from "../src/auth/resendVerification.js";
import type { DbPool } from "../src/db/pool.js";

for (const scenario of ['accepted','rejected','ineligible'] as const) {
  test(`verification resend ${scenario}: transaction protects old token and eligibility`,async()=>{
    const statements:string[]=[];let released=false;let sent=false;let hash='';
    const pool={async connect(){return {async query(sql:string,params?:unknown[]){statements.push(sql);
      if(sql.startsWith('UPDATE')) {hash=String(params?.[1]);return {rows:scenario==='ineligible'?[]:[{name:'Demo',email:'demo@example.test'}]};}
      return {rows:[]};
    },release(){released=true;}};}} as unknown as DbPool;
    const send=async (_entry:unknown,token:string)=>{sent=true;assert.notEqual(token,hash);assert.match(hash,/^[0-9a-f]{64}$/);if(scenario==='rejected')throw new Error('provider rejected');};
    if(scenario==='rejected') await assert.rejects(resendVerification(pool,'id',48,send),/provider rejected/);
    else assert.equal(await resendVerification(pool,'id',48,send),scenario==='accepted');
    assert.equal(sent,scenario!=='ineligible');assert.equal(released,true);
    assert.equal(statements.at(-1),scenario==='accepted'?'COMMIT':'ROLLBACK');
    assert.match(statements[1]!,/status = 'pending' AND email_verified = false/);
  });
}
