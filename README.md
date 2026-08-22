# livepeer-modules-transcode

A standalone module for the Livepeer **transcode** product — VOD batch
transcode plus live RTMP ingest with LL-HLS playback — extracted from
`livepeer-network-modules` so it can ship and operate on its own release
cadence.

> **For agents:** start at [`AGENTS.md`](./AGENTS.md). The README below is
> a human-oriented overview.

## What this is

A single deployable product:

- A TypeScript / Fastify gateway (`transcode-gateway/`) that exposes a
  customer-facing HTTP + RTMP surface. Customers can submit VOD
  encoding jobs (presigned upload → one paid ABR exchange → HLS manifest +
  playback URL) and start live streams (RTMP ingest → broker live
  session → LL-HLS strict-proxy).
- Two Go workload runners (`transcode-runner/` for single-rendition,
  `abr-runner/` for multi-rendition) plus a shared Go library
  (`transcode-core/`) and a multi-stage codec base image
  (`codecs-builder/`).
- A Node integration smoke harness (`transcode-tester/`).
- Three zero-build Lit web-component frontends — a waitlist signup
  site (`site/`), an authenticated user portal (`portal/`), and an
  operator admin dashboard (`admin/`) — modeled after Blue Claw
  Network's onboarding flow (waitlist → admin approval → emailed API
  key → portal login).

## What this is not

- A capability broker. Transcode jobs are dispatched to an external
  `capability-broker` service that runs the actual encodes.
- A payment system. Network funding and settlement are delegated to the
  Livepeer Open Clearinghouse (LOC); the gateway never acts as a payer.
- A discovery layer. Broker resolution goes through an external
  `service-registry-daemon` resolver socket.
- A CDN. Operators front the gateway with their CDN of choice for
  caching, edge replication, and geographic routing.

For the full requirements catalog see
[`docs/design-docs/requirements.md`](./docs/design-docs/requirements.md);
for the peer-service inventory see
[`docs/design-docs/dependencies.md`](./docs/design-docs/dependencies.md).

## Status

**Initial port complete; breaking Livepeer Modules v2 migration active.** All
gateway, runner, frontend, and smoke-harness components in the original
roadmap have shipped. The completed roadmap is
[`docs/exec-plans/completed/0001-initial-port-roadmap.md`](./docs/exec-plans/completed/0001-initial-port-roadmap.md).
Current work is tracked in Beads epic `lmt-65a` and explained by
[`plan 0018`](./docs/exec-plans/active/0018-livepeer-modules-v2-migration.md).
The present branch is not a v2-compatible release until that plan completes.

## Setup (fresh clone)

The repo pins every toolchain it builds against so installs are
reproducible. Two paths — pick whichever fits your machine.

### Pinned versions

| File              | What it pins              | Read by                                       |
| ----------------- | ------------------------- | --------------------------------------------- |
| `.tool-versions`  | Node `24`, Go `1.25.7`    | asdf / mise / rtx (unified multi-tool)        |
| `.nvmrc`          | Node `24` (fallback)      | fnm, nvm                                      |
| `package.json`    | `pnpm@9.0.0` + sha512     | Corepack (ships with Node)                    |
| `go.mod` per pkg  | `go 1.25.x` per module    | the `go` command (auto-toolchain since 1.21)  |

### Option A — Unified with mise / asdf (recommended)

```sh
mise install            # reads .tool-versions, installs Node 24 + Go 1.25.7
corepack enable         # activates pinned pnpm@9.0.0 shim
pnpm install            # populates the JS workspace once packages exist
```

### Option B — Separate managers (fnm + your existing Go install)

```sh
fnm use                 # reads .nvmrc → Node 24
corepack enable         # activates pinned pnpm@9.0.0 shim
pnpm install            # `engine-strict=true` in .npmrc hard-fails on wrong Node
```

For Go, every module's `go.mod` declares its required version. Any `go` ≥
1.21 on your machine will **auto-download the right toolchain** the first
time you run `go build` / `go test` (Go's built-in `GOTOOLCHAIN=auto`
behavior). No `goenv` / `g` needed unless you specifically want one.

## Operating model

This repo follows the agent-first harness pattern documented in
[`docs/references/openai-harness-engineer.md`](./docs/references/openai-harness-engineer.md):

- **Humans steer; agents execute.** Intent is set by humans; tools and feedback loops do the rest.
- **The repo is the system of record.** If it isn't checked in, it doesn't exist.
- **Progressive disclosure.** `AGENTS.md` is a *map*, not a manual. Detail lives in `docs/`.
- **Enforce invariants, not implementations.** Constraints in lints/CI; choices in code.
- **Throughput over ceremony.** Short-lived PRs; fix-forward over block.

## Layout

```
.
├── AGENTS.md              # Entry-point map for coding agents
├── CLAUDE.md              # Stub pointing Claude Code at AGENTS.md
├── DESIGN.md              # Architectural overview at a glance
├── PRODUCT_SENSE.md       # What this is + who/why + anti-goals
├── PLANS.md               # Current state and what's in flight
├── README.md              # You are here
├── package.json           # pnpm workspace root
├── pnpm-workspace.yaml
├── .tool-versions / .nvmrc / .npmrc
├── docs/                  # All design / plan / reference docs (single root)
│   ├── design-docs/       # start at index.md
│   ├── exec-plans/        # active/, completed/, tech-debt-tracker.md
│   ├── product-specs/     # cross-cutting feature specs (TBD)
│   ├── generated/         # machine-produced reference (dep graphs, SBOMs)
│   └── references/        # external material (transcripts, PDFs)
└── <component-name>/      # one subfolder per component (added as ported)
    ├── AGENTS.md
    └── ...
```
