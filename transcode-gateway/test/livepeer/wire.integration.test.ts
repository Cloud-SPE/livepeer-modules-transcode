import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";

import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";

import { createResolverWorkerResolver } from "../../src/livepeer/resolverWorkerResolver.js";
import { createUnixSocketPayerDaemonClient } from "../../src/livepeer/payerDaemonClient.js";
import { createHttpWorkerClient } from "../../src/livepeer/httpWorkerClient.js";
import { HEADER, SPEC_VERSION } from "../../src/livepeer/headers.js";

const PROTO_ROOT = path.resolve(process.cwd(), "proto");

test("wire path resolves a route, mints payment over payer-daemon gRPC, and dispatches to broker", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "transcode-wire-"));
  const resolverSocket = path.join(tmp, "resolver.sock");
  const payerSocket = path.join(tmp, "payer.sock");

  const brokerRequest: {
    headers?: http.IncomingHttpHeaders;
    body?: string;
  } = {};
  const payerRequests: any[] = [];

  const broker = http.createServer((req, res) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      brokerRequest.headers = req.headers;
      brokerRequest.body = body;
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: true, storageKey: "s3://bucket/out.mp4", durationSec: 12 }));
    });
  });
  await new Promise<void>((resolve) => broker.listen(0, "127.0.0.1", () => resolve()));
  const brokerAddress = broker.address();
  if (!brokerAddress || typeof brokerAddress === "string") {
    throw new Error("broker did not bind to a TCP port");
  }
  const brokerUrl = `http://127.0.0.1:${brokerAddress.port}`;

  const resolverServer = await startGrpcServer(
    path.join(PROTO_ROOT, "livepeer", "registry", "v1", "resolver.proto"),
    "livepeer.registry.v1.Resolver",
    resolverSocket,
    {
      selectMany(call: any, callback: any) {
        callback(null, {
          routes: [
            {
              worker_url: "https://legacy-broker.invalid",
              eth_address: "0x9999999999999999999999999999999999999999",
              capability: "video:transcode.abr",
              offering: "default",
              price_per_work_unit_wei: "1",
              work_unit: "seconds",
              protocol: "http-stream@v0",
              extra_json: Buffer.from(JSON.stringify({ mode: "http-stream@v0" })),
            },
            {
              worker_url: brokerUrl,
              eth_address: "0x1234567890abcdef1234567890abcdef12345678",
              capability: "video:transcode.abr",
              offering: "default",
              price_per_work_unit_wei: "2500",
              work_unit: "seconds",
              protocol: "paid-job/v1",
              extra_json: Buffer.from(
                JSON.stringify({
                  protocol: "paid-job/v1",
                  job: { transports: ["stream", "unary"] },
                  zone: "test",
                }),
              ),
              constraints_json: Buffer.from(JSON.stringify({ region: "us" })),
              quote_id: "quote-123",
              quote_version: 7,
              constraint_fingerprint: Buffer.from([1, 2, 3]),
              route_fingerprint: Buffer.from([4, 5, 6]),
              units_per_price: 1,
              settlement_keys: [
                {
                  public_key: `0x04${"11".repeat(64)}`,
                  not_before: "2026-08-22T00:00:00Z",
                  expires_at: "2026-08-24T00:00:00Z",
                  introduced_in_publication_seq: 7,
                },
                {
                  public_key: `0x04${"22".repeat(64)}`,
                  not_before: "2026-08-21T00:00:00Z",
                  expires_at: "2026-08-23T00:00:00Z",
                  introduced_in_publication_seq: 6,
                },
              ],
              work_unit_estimator: {
                id: "abr-output-frame-megapixels/v1",
                rounding: "ceiling",
                exactness: "exact-or-reject",
                package: "@livepeer/abr-work-units",
                fixtures: "fixtures/abr-work-units/v1",
              },
            },
          ],
        });
      },
      listKnown(_call: any, callback: any) {
        callback(null, { entries: [] });
      },
      resolveByAddress(_call: any, callback: any) {
        callback(null, { nodes: [] });
      },
    },
  );

  const payerServer = await startGrpcServer(
    path.join(PROTO_ROOT, "livepeer", "payments", "v1", "payer_daemon.proto"),
    "livepeer.payments.v1.PayerDaemon",
    payerSocket,
    {
      health(_call: any, callback: any) {
        callback(null, { status: "ok" });
      },
      createPayment(call: any, callback: any) {
        payerRequests.push(call.request);
        callback(null, { payment_bytes: Buffer.from("abc") });
      },
    },
  );

  const resolverHandle = createResolverWorkerResolver({
    resolverSocket,
    resolverProtoRoot: PROTO_ROOT,
    resolverSnapshotTtlMs: 15_000,
    routeFailureThreshold: 3,
    routeCooldownMs: 30_000,
  });

  const payerClient = await createUnixSocketPayerDaemonClient({
    socketPath: payerSocket,
    protoRoot: PROTO_ROOT,
  });

  const workerClient = createHttpWorkerClient({
    payerDaemon: payerClient,
    fundedValueWei: "1000000000000000",
  });

  try {
    const route = await resolverHandle.resolver.selectWorker({
      capability: "video:transcode.abr",
      offering: "default",
      tier: "standard",
    });
    assert.ok(route, "expected resolver to return a route");
    assert.equal(route.workerUrl, brokerUrl, "unsupported protocol must be rejected before minting");
    assert.equal(route.protocol, "paid-job/v1");
    assert.deepEqual(route.job?.transports, ["stream", "unary"]);
    assert.equal(route.session, null);
    assert.equal(route.workUnitEstimator?.id, "abr-output-frame-megapixels/v1");
    assert.equal(route.settlementKeys.length, 2, "rotation overlap must survive projection");
    assert.equal(route.settlementKeys[0]?.introducedInPublicationSeq, 7);
    assert.equal(route.settlementKeys[1]?.introducedInPublicationSeq, 6);

    const resp = await workerClient.callWorker<{ job_id: string }, { ok: boolean }>({
      route,
      path: "/v1/video/transcode",
      method: "POST",
      body: { job_id: "job_1" },
      callerId: "api_key_1",
      timeoutMs: 5_000,
    });

    assert.equal(resp.ok, true);
    assert.equal(payerRequests.length, 1);

    const payerReq = payerRequests[0];
    const ticketParamsBaseUrl = field<string>(payerReq, "ticketParamsBaseUrl", "ticket_params_base_url");
    const acceptedPrice = field<any>(payerReq, "acceptedPrice", "accepted_price");
    const quoteRef = field<any>(acceptedPrice, "quoteRef", "quote_ref");
    const pricePerUnitWei = field<any>(acceptedPrice, "pricePerUnitWei", "price_per_unit_wei");
    const funding = field<any>(payerReq, "funding");
    const fundedValueWei = field<any>(funding, "fundedValueWei", "funded_value_wei");

    assert.equal(bufferToHex(payerReq.recipient), "1234567890abcdef1234567890abcdef12345678");
    assert.equal(ticketParamsBaseUrl, brokerUrl);
    assert.equal(field<string>(acceptedPrice, "capability"), "video:transcode.abr");
    assert.equal(field<string>(acceptedPrice, "offering"), "default");
    assert.equal(bufferToBigIntString(field(pricePerUnitWei, "value")), "2500");
    assert.equal(Number(field<number | string>(acceptedPrice, "unitsPerPrice", "units_per_price")), 1);
    assert.equal(field<string>(acceptedPrice, "workUnitName", "work_unit_name"), "seconds");
    assert.equal(field<string>(quoteRef, "quoteId", "quote_id"), "quote-123");
    assert.equal(Number(field<number | string>(quoteRef, "quoteVersion", "quote_version")), 7);
    assert.deepEqual(
      Array.from(field<Uint8Array>(quoteRef, "constraintFingerprint", "constraint_fingerprint")),
      [1, 2, 3],
    );
    assert.deepEqual(
      Array.from(field<Uint8Array>(quoteRef, "routeFingerprint", "route_fingerprint")),
      [4, 5, 6],
    );
    assert.equal(Number(field<number | string>(funding, "estimatedUnits", "estimated_units")), 1);
    assert.equal(bufferToBigIntString(field(fundedValueWei, "value")), "1000000000000000");
    assert.equal(Number(field<number | string>(funding, "maxTotalUnits", "max_total_units")), 1);
    assert.equal(field<boolean>(funding, "topUpAllowed", "top_up_allowed"), false);

    assert.ok(brokerRequest.headers, "expected broker to receive a request");
    assert.equal(brokerRequest.headers?.[HEADER.CAPABILITY.toLowerCase()], "video:transcode.abr");
    assert.equal(brokerRequest.headers?.[HEADER.OFFERING.toLowerCase()], "default");
    assert.equal(brokerRequest.headers?.[HEADER.PAYMENT.toLowerCase()], Buffer.from("abc").toString("base64"));
    assert.equal(brokerRequest.headers?.[HEADER.SPEC_VERSION.toLowerCase()], SPEC_VERSION);
    assert.match(String(brokerRequest.headers?.[HEADER.REQUEST_ID.toLowerCase()] ?? ""), /^req_/);
    assert.deepEqual(JSON.parse(brokerRequest.body ?? "{}"), { job_id: "job_1" });
  } finally {
    await payerClient.close();
    await resolverHandle.close();
    await stopGrpcServer(payerServer, payerSocket);
    await stopGrpcServer(resolverServer, resolverSocket);
    await new Promise<void>((resolve, reject) => broker.close((err) => (err ? reject(err) : resolve())));
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

async function startGrpcServer(
  protoFile: string,
  servicePath: string,
  socketPath: string,
  impl: Record<string, unknown>,
): Promise<grpc.Server> {
  try {
    fs.rmSync(socketPath, { force: true });
  } catch {}

  const def = await protoLoader.load(protoFile, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
    includeDirs: [PROTO_ROOT],
  });
  const pkg = grpc.loadPackageDefinition(def) as any;
  const svc = serviceByPath(pkg, servicePath);
  const server = new grpc.Server();
  server.addService(svc.service, impl as any);
  await new Promise<void>((resolve, reject) => {
    server.bindAsync(`unix:${socketPath}`, grpc.ServerCredentials.createInsecure(), (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
  return server;
}

async function stopGrpcServer(server: grpc.Server, socketPath: string): Promise<void> {
  await new Promise<void>((resolve) => server.tryShutdown(() => resolve()));
  try {
    fs.rmSync(socketPath, { force: true });
  } catch {}
}

function serviceByPath(root: Record<string, unknown>, dotted: string): any {
  return dotted.split(".").reduce<any>((acc, key) => acc[key], root);
}

function bufferToHex(value: Buffer | Uint8Array): string {
  return Buffer.from(value).toString("hex");
}

function bufferToBigIntString(value: Buffer | Uint8Array): string {
  const raw = Buffer.from(value);
  if (raw.length === 0) return "0";
  return BigInt(`0x${raw.toString("hex")}`).toString(10);
}

function field<T>(value: Record<string, unknown>, ...keys: string[]): T {
  for (const key of keys) {
    if (key in value) return value[key] as T;
  }
  throw new Error(`missing expected field: ${keys.join(" | ")}`);
}
