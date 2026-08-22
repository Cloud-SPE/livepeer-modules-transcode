---
plan: 0004
title: Wire layer — real WorkerClient + WorkerResolver (resolver-aware, payment-aware) + capability map + headers + payment minting
status: completed
phase: shipped
opened: 2026-05-18
closed: 2026-05-18
owner: harness
related:
  - "docs/exec-plans/completed/0003-engine-port.md (stub workerClient/Resolver to replace)"
  - "docs/design-docs/core-beliefs.md §2 (resolver-only, no static URL fallback)"
  - "docs/design-docs/dependencies.md (capability-broker, payment-daemon, service-registry-daemon)"
  - "docs/exec-plans/completed/0001-initial-port-roadmap.md §3.2 (sequencing)"
---

# Plan 0004 — wire layer (resolver + payer-daemon + broker HTTP client)

## 1. Problem

After plan 0003, `transcode-gateway/` has a fully ported engine but the
`WorkerClient` and `WorkerResolver` it expects are stubs (throw
`NotImplemented` / return `null`). The gateway boots; it just can't
dispatch transcode work.

The source `livepeer-network-modules/video-gateway/src/livepeer/` ships
the real wire layer: capability-to-mode mapping, `Livepeer-*` header
constants + minting, request-id generation, resolver-aware broker route
selection (gRPC against `service-registry-daemon`), per-broker route
health tracking, and a payment-header builder that calls
`payment-daemon` over a Unix socket.

This plan ports that wire layer into `transcode-gateway/src/livepeer/`,
adds the real `WorkerClient` + `WorkerResolver` implementations, vendors
the proto files the resolver needs, and wires the gateway to use them
when their environment is configured (otherwise the stubs from plan
0003 remain the default — useful for dev runs without external peer
services).

After this plan ships:

- With `LIVEPEER_RESOLVER_SOCKET` + `LIVEPEER_PAYER_SOCKET` set, the
  gateway can resolve brokers via the resolver, mint payment headers,
  and dispatch HTTP requests. (Routes that exercise this land in 0005
  + 0006.)
- Without those env vars set, the gateway boots with the stubs — the
  auth surface still works exactly as in plan 0002. No regression.

## 2. Required invariants

Per [core-beliefs.md](../../design-docs/core-beliefs.md):

- **§2 Resolver-only.** Source's `routeSelector.ts` has a
  static-`LIVEPEER_BROKER_URL` fallback branch. **Drop entirely.** The
  ported `routeSelector` only supports resolver-socket mode.
- **§4 Read-only source repos.** Cite source paths verbatim in commit
  messages.
- **§5–§7** No billing / projects / webhooks code creeps in.
- **§10 Docker-first.** No new host-tooling required.
- **§15 Latest stable deps.** New deps: `@grpc/grpc-js` (latest),
  `@grpc/proto-loader` (latest), `undici` (latest — Node 24 ships it
  internally; we add it explicitly for the Agent that supports UDS
  fetch).

## 3. Execution

### 3.1 Port the wire-layer files (mostly verbatim)

| Source file | Action | Notes |
|---|---|---|
| `livepeer/index.ts` | rewrite | New re-exports (no rtmp-adapter; new real client + resolver) |
| `livepeer/capabilityMap.ts` | port verbatim | Maps `Capability` → `Mode` |
| `livepeer/headers.ts` | port verbatim | `Livepeer-*` header constants + `SPEC_VERSION` |
| `livepeer/requestId.ts` | port verbatim | `newRequestId()` — `req_<8 random bytes hex>` |
| `livepeer/payment.ts` | port verbatim | `createPaymentBuilder({ payerDaemon }) → buildPayment` |
| `livepeer/payerDaemonClient.ts` | port w/ edits | Source leaves UDS `fetchImpl` as caller-supplied; we provide a real one using `undici.Agent({ connect: { socketPath } })` |
| `livepeer/routeHealth.ts` | port w/ edits | Source `import`s `GenericRouteHealthTracker` from `@livepeer-network-modules/gateway-route-health`. **Inline** the generic tracker + helpers into `livepeer/routeHealth.ts` per [dependencies.md](../../design-docs/dependencies.md) (we don't take that workspace dep). |
| `livepeer/routeSelector.ts` | port w/ heavy edits | Drop the static-URL branch entirely (lines 122–176 of source). Only resolver-socket mode. Remove `cfg.brokerUrl` field. |
| `livepeer/liveSessionDirectory.ts` | **defer to plan 0006** (live only) | — |
| `livepeer/selectionPolicy.ts` | **defer to plan 0005/0006** (route hint building, depends on `service/abrSelector.ts` which isn't ported yet) | — |
| `livepeer/rtmp-adapter.ts` | **defer to plan 0006** (live only) | — |

### 3.2 Vendor the resolver proto files

The `routeSelector` loads protos at runtime via `@grpc/proto-loader`.
Source loads them from `proto-contracts/livepeer/registry/v1/{types,resolver}.proto`
(a sibling workspace package).

For this standalone repo, **vendor** the two proto files into:

```
transcode-gateway/
└── proto/
    └── livepeer/
        └── registry/
            └── v1/
                ├── types.proto      # copied from proto-contracts/livepeer/registry/v1/types.proto
                └── resolver.proto   # copied from proto-contracts/livepeer/registry/v1/resolver.proto
```

`routeSelector` loads them with `includeDirs: [config.RESOLVER_PROTO_ROOT]`
(default `./proto`). The Dockerfile copies `proto/` into the runtime
image. Commit message that introduces the vendored files cites the
source path verbatim.

### 3.3 Real `WorkerClient` + `WorkerResolver`

Two new files in `src/livepeer/`:

**`src/livepeer/httpWorkerClient.ts`** — implements
`engine/interfaces/WorkerClient`. For each `callWorker(...)` invocation:

1. Mint a `Livepeer-Request-Id` via `newRequestId()`.
2. Call `paymentBuilder({ callerId, capability, offering, workUnits,
   faceValueWei, recipientEthAddress, nodeId })` to get
   `{ header, workId }`.
3. Build `Livepeer-*` headers (capability, offering, payment, request-id,
   spec-version) per `headers.ts`.
4. `fetch(route.workerUrl + path, { method, body, headers, signal })`
   with the configured `timeoutMs` via `AbortController`.
5. On `!res.ok`: throw `VideoCoreError("WorkerError", …)`. On success:
   return parsed JSON response.

It depends on a `PayerDaemonClient` and a `nodeId` (gateway's own eth
address — env-configurable).

**`src/livepeer/resolverWorkerResolver.ts`** — implements
`engine/interfaces/WorkerResolver`. For each `selectWorker(...)`:

1. Call `routeSelector.select({ capability, offering, ... })` to get a
   ranked list of `VideoRouteCandidate`.
2. Pick the first ready candidate (route-health already moved cooling
   ones to the back).
3. Convert `VideoRouteCandidate` → `SelectedWorkerRoute` (engine type).

If `cfg.tier` selection-policy hints become needed, the resolver
accepts an optional `supportFilter` callback. Plan 0005/0006 wires
selectionPolicy in when routes ship.

### 3.4 Env config additions (`src/config.ts`)

| Env | Required | Default | Purpose |
|---|---|---|---|
| `LIVEPEER_RESOLVER_SOCKET` | no | (unset → stub) | Path to service-registry-daemon resolver UDS |
| `LIVEPEER_RESOLVER_PROTO_ROOT` | no | `./proto` | Where to find `livepeer/registry/v1/*.proto` |
| `LIVEPEER_RESOLVER_SNAPSHOT_TTL_MS` | no | `15000` | Resolver result cache window |
| `LIVEPEER_PAYER_SOCKET` | no | (unset → stub) | Path to payment-daemon sender UDS |
| `LIVEPEER_NODE_ID` | no | (unset → stub fallback) | Gateway's eth address; mandatory for payment minting |
| `LIVEPEER_ROUTE_FAILURE_THRESHOLD` | no | `3` | Consecutive failures before cooling a broker |
| `LIVEPEER_ROUTE_COOLDOWN_MS` | no | `30000` | Cooldown duration once tripped |
| `LIVEPEER_FACE_VALUE_WEI` | no | `1000000000000000` | Default face-value per payment (configurable; 0.001 ETH) |

All optional. When `LIVEPEER_RESOLVER_SOCKET` is unset, the stub
resolver is used. When `LIVEPEER_PAYER_SOCKET` is unset, the stub
worker client is used.

### 3.5 Update `src/index.ts`

Replace stub wiring with conditional real-impl wiring:

```ts
const payerDaemon = config.LIVEPEER_PAYER_SOCKET
  ? createUnixSocketPayerDaemonClient({ socketPath: config.LIVEPEER_PAYER_SOCKET })
  : null;

const workerResolver = config.LIVEPEER_RESOLVER_SOCKET
  ? createResolverWorkerResolver({
      resolverSocket: config.LIVEPEER_RESOLVER_SOCKET,
      resolverProtoRoot: config.LIVEPEER_RESOLVER_PROTO_ROOT,
      // …
    })
  : createStubWorkerResolver();

const workerClient = payerDaemon && config.LIVEPEER_NODE_ID
  ? createHttpWorkerClient({
      payerDaemon,
      nodeId: config.LIVEPEER_NODE_ID,
      faceValueWei: config.LIVEPEER_FACE_VALUE_WEI,
    })
  : createStubWorkerClient();
```

The stubs from plan 0003 stay in `src/livepeer/` and serve as the
default for dev environments. The Dockerfile's compose stack does not
set `LIVEPEER_RESOLVER_SOCKET` / `LIVEPEER_PAYER_SOCKET`, so the smoke
flow continues to exercise only the auth surface.

### 3.6 Component AGENTS.md note

Update `transcode-gateway/AGENTS.md` to note that the `livepeer/`
directory now contains the real wire layer and that proto files live
under `proto/`.

### 3.7 Unit tests

- `test/livepeer/capabilityMap.test.ts` — every `Capability` maps to a
  `Mode`
- `test/livepeer/routeHealth.test.ts` — failure threshold opens
  cooldown; success closes it; ranking puts ready ones first;
  `summarizeRouteHealth` + `renderRouteHealthMetrics` produce the
  expected shapes

Integration tests against a real resolver / payer-daemon are out of
scope for 0004 (no peer services running in CI). Plan 0005 (or a
future smoke plan) wires a mock resolver to exercise the full path.

## 4. Acceptance

Plan is **complete** when:

1. `pnpm install` (workspace) resolves cleanly with new deps
   (`@grpc/grpc-js`, `@grpc/proto-loader`, `undici`).
2. `pnpm -F @livepeer-modules-transcode/transcode-gateway lint` passes.
3. `pnpm -F @livepeer-modules-transcode/transcode-gateway test` passes
   (existing 11 + new ones).
4. With **no new env vars**, the gateway still boots and passes the
   auth smoke from plan 0002 (regression check). Stubs remain the
   default.
5. With `LIVEPEER_RESOLVER_SOCKET=/dev/null` (intentionally bogus) set,
   the gateway still boots; the resolver is *constructed* (proto
   loaded, gRPC client opened) but the first `select(...)` call fails
   loudly (acceptable — it would succeed if the socket were real).
6. Vendored proto files exist at
   `transcode-gateway/proto/livepeer/registry/v1/{types,resolver}.proto`,
   verbatim copies of the source files.
7. Every TS file ≤ 300 lines. (`routeSelector.ts` is 455 lines in
   source; after dropping the static-URL branch + cleanups it should
   fit. If not, split into `resolver/{client,snapshot,ranking}.ts`.)
8. `PLANS.md` roadmap row for phase 3 (wire) flips to ✅.
9. This plan moves to `docs/exec-plans/completed/`.

## 5. Out of scope

- VOD routes wiring jobOrchestrator to a Fastify handler — plan 0005.
- Live RTMP listener + RTMP-relay adapter — plan 0006.
- `selectionPolicy.ts` (route-hint building per encoding tier / live
  ladder) — lands when routes need it (0005/0006); it depends on
  `service/abrSelector.ts` which is also not ported yet.
- `liveSessionDirectory.ts` — plan 0006 (live).
- Integration test against a real or mock resolver / payer-daemon —
  separate exec-plan once the route layer is in (a "0099-e2e-smoke"
  could land then).
- Admin video-ops routes (`/admin/video/resolver-candidates`,
  `/admin/video/route-health/metrics`, `/admin/video/route-controls/*`)
  — plan 0006 / the admin frontend plan.

## 6. Decision log

| Date | Decision | Why |
|---|---|---|
| 2026-05-18 | Drop the static-`LIVEPEER_BROKER_URL` fallback branch from `routeSelector.ts` | Per [core-beliefs §2](../../design-docs/core-beliefs.md): resolver-only. The source's branch existed for legacy single-broker deploys we explicitly don't support |
| 2026-05-18 | Vendor proto files at `transcode-gateway/proto/livepeer/registry/v1/` (verbatim from `proto-contracts/`) | We're a standalone repo; can't depend on `proto-contracts` workspace package. Vendoring keeps the gRPC client self-contained |
| 2026-05-18 | Inline `gateway-route-health` (`GenericRouteHealthTracker` + helpers) directly into `livepeer/routeHealth.ts` | Per [dependencies.md](../../design-docs/dependencies.md): we explicitly don't take that workspace dep. Inlining ~211 lines is cheap |
| 2026-05-18 | Keep stub `WorkerClient` + `WorkerResolver` as the default when env vars unset | Dev environments without peer services still boot. Plan 0002's auth smoke continues to pass unchanged |
| 2026-05-18 | Implement real UDS fetch for payer-daemon using `undici.Agent({ connect: { socketPath } })` | Source leaves it as caller-supplied (`fetchImpl?`); we have one viable backend (`undici` ships with Node 24). Cleaner than per-call manual `http.request` |
| 2026-05-18 | Defer `selectionPolicy.ts` to plan 0005/0006 | It depends on `service/abrSelector.ts` which isn't ported yet; pulling it forward would bleed scope |
| 2026-05-18 | Defer `liveSessionDirectory.ts` to plan 0006 | Live-only |
| 2026-05-18 | Single PR (wire layer + proto vendoring + real client/resolver + unit tests) | Per [core-beliefs §13](../../design-docs/core-beliefs.md) throughput-friendly; coherent unit |
