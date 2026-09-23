import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { registerCatalog, catalogWire } from "../../src/routes/catalog.js";
import { loadConfig } from "../../src/config.js";
import type { DbPool } from "../../src/db/pool.js";
import type { LocTransport } from "../../src/engine/interfaces/index.js";
const config = loadConfig({ DATABASE_URL:"postgres://test", ADMIN_TOKEN:"a".repeat(16), API_KEY_HASH_PEPPER:"p".repeat(16) });
const source = {items:[{name:"video:transcode.abr",work_unit:"video-frame-megapixel",extra:{secret:"private"},offerings:[{id:"abr-default",protocol:"paid-job/v1",work_unit:"video-frame-megapixel",price_per_work_unit_wei:"900719925474099312345",units_per_price:"1000",extra:{secret:"private"},job:{transports:["stream"],credential:"private"}}]}]};

test("catalog requires auth, strips opaque metadata and preserves exact rate denominator", async () => {
  let calls=0;
  const transport: LocTransport = {async request(input) { calls++; return input.schema.parse(source); }};
  const app=Fastify(); registerCatalog(app,{config,pool:{} as DbPool,transport});
  try {
    for(const url of ['/api/v1/user/catalog','/api/v1/admin/catalog']) assert.equal((await app.inject({url})).statusCode,401);
    assert.equal(calls,0);
    const r=await app.inject({url:'/api/v1/admin/catalog',headers:{authorization:`Bearer ${config.ADMIN_TOKEN}`}});
    assert.equal(r.statusCode,200);assert.doesNotMatch(r.body,/private|credential|secret/);
    assert.equal(r.json().items[0].offerings[0].price_per_work_unit_wei,"900719925474099312345");
    assert.equal(r.json().items[0].offerings[0].units_per_price,"1000");
    assert.equal(r.json().items[0].offerings[0].configured_for_gateway,true);
    assert.equal(r.json().price_basis,"network_wholesale");
  } finally {await app.close();}
});

test("catalog does not present absent LOC or upstream errors as empty availability",async()=>{
  for(const transport of [undefined,{async request(){throw new Error('private upstream detail');}} as LocTransport]) {
    const app=Fastify();registerCatalog(app,{config,pool:{} as DbPool,...(transport?{transport}:{})});
    const r=await app.inject({url:'/api/v1/admin/catalog',headers:{authorization:`Bearer ${config.ADMIN_TOKEN}`}});
    assert.equal(r.statusCode,503);assert.doesNotMatch(r.body,/private/);await app.close();
  }
  const invalid=structuredClone(source);invalid.items[0]!.offerings[0]!.units_per_price='0';
  assert.equal(catalogWire.safeParse(invalid).success,false);
});

test("catalog rejects invalid upstream denominators without returning inaccurate prices",async()=>{
  const app=Fastify();
  const transport: LocTransport={async request(input){const bad=structuredClone(source);bad.items[0]!.offerings[0]!.units_per_price='0';return input.schema.parse(bad);}};
  registerCatalog(app,{config,pool:{} as DbPool,transport});
  const response=await app.inject({url:'/api/v1/admin/catalog',headers:{authorization:`Bearer ${config.ADMIN_TOKEN}`}});
  assert.equal(response.statusCode,503);await app.close();
});
