import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { registerAdminAuth } from "../../src/routes/auth/admin.js";
import { loadConfig } from "../../src/config.js";
import type { DbPool } from "../../src/db/pool.js";
const config=loadConfig({DATABASE_URL:'postgres://test',ADMIN_TOKEN:'a'.repeat(16),API_KEY_HASH_PEPPER:'p'.repeat(16),RESEND_API_KEY:'test',SITE_URL:'https://demo.example.test'});
const url='/api/v1/admin/waitlist/00000000-0000-4000-8000-000000000001/resend-verification';

test('resend requires admin auth, uses site link, and throttles repeated sends',async()=>{
  let sends=0;let body='';
  const pool={async connect(){return{async query(sql:string){return{rows:sql.startsWith('UPDATE')?[{name:'Demo',email:'demo@example.test'}]:[]};},release(){}};}} as unknown as DbPool;
  const app=Fastify();registerAdminAuth(app,{config,pool,paidOperationRepo:null,email:{async send(input){sends++;body=input.html;}}});
  try {
    assert.equal((await app.inject({method:'POST',url})).statusCode,401);assert.equal(sends,0);
    const request={method:'POST' as const,url,headers:{authorization:`Bearer ${config.ADMIN_TOKEN}`}};
    const r=await app.inject(request);assert.equal(r.statusCode,200);assert.equal(r.json().delivery,'accepted');
    assert.match(body,/https:\/\/demo.example.test\/verify.html\?token=/);
    assert.equal((await app.inject(request)).statusCode,429);assert.equal(sends,1);
  }finally{await app.close();}
});
