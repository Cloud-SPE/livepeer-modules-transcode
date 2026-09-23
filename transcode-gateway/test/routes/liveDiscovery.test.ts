import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { registerLiveStreams, type LiveStreamsDeps } from "../../src/routes/live/streams.js";
import { registerRequestLogger } from "../../src/middleware/requestLogger.js";
import { loadConfig } from "../../src/config.js";
import { LocTransportError } from "../../src/engine/interfaces/index.js";

const config={...loadConfig({DATABASE_URL:'postgres://test',ADMIN_TOKEN:'a'.repeat(16),API_KEY_HASH_PEPPER:'p'.repeat(16)}),RTMP_RELAY_ENABLED:true,LIVEPEER_GATEWAY_EXTERNAL_RTMP_URL:'rtmp://localhost:1935/live'};
for(const [error,status,code] of [
  [new LocTransportError('loc_timeout',{retryable:true}),504,'loc_timeout'],
  [new LocTransportError('loc_unavailable',{retryable:true}),503,'loc_unavailable'],
  [new LocTransportError('loc_http_error',{retryable:false,status:401,remoteCode:'PRIVATE_UPSTREAM_DETAIL'}),502,'loc_auth_failed'],
  [new LocTransportError('loc_response_invalid',{retryable:false}),502,'loc_response_invalid'],
  [new LocTransportError('loc_http_error',{retryable:true,status:429,retryAfterSeconds:7}),503,'loc_http_error'],
] as const) {
  test(`live discovery ${error.code}/${error.status} returns useful error before any paid session side effect`,async()=>{
    let sideEffects=0;
    const trap=new Proxy({}, {get(){sideEffects++;throw new Error('unexpected paid session side effect');}});
    const pool={async query(sql:string){return {rowCount:1,rows:sql.includes('key_hash = ANY')
      ? [{id:'key-id',user_id:'user-id',key_prefix:'tc_test',created_at:new Date()}]
      : [{name:'Demo',email:'demo@example.test',key_prefix:'tc_test',key_created_at:new Date(),status:'approved',member_since:new Date()}]};}};
    const app=Fastify();registerRequestLogger(app);
    registerLiveStreams(app,{config,pool,workerResolver:{async selectWorker(){throw error;}},paidSessionClient:trap,paidSessionStore:trap,liveSessions:trap,liveStreamRepo:trap,playbackIdRepo:trap} as unknown as LiveStreamsDeps);
    try {
      const r=await app.inject({method:'POST',url:'/v1/live/streams',headers:{authorization:'Bearer tc_fixture'},payload:{name:'Demo',encoding_tier:'standard'}});
      assert.equal(r.statusCode,status);assert.equal(r.json().error,code);
      assert.equal(r.json().retryable,error.retryable);assert.match(r.json().request_id,/^[0-9a-f-]{36}$/);
      assert.match(r.json().message,/No live stream was created/);
      assert.doesNotMatch(r.body,/PRIVATE_UPSTREAM_DETAIL|tc_fixture/);
      if(error.retryAfterSeconds)assert.equal(r.headers['retry-after'],'7');
      assert.equal(sideEffects,0);
    } finally {await app.close();}
  });
}
