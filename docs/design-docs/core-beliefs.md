# Core beliefs

Invariants any change in this repo must uphold. These exist because past
decisions (or strong stakeholder preference) made them load-bearing. To
change one, open a numbered plan under `../exec-plans/active/` first.

## 1. This module ships the transcode product end-to-end

The pin: *a customer can sign up, get an API key, and either submit a VOD
job or push an RTMP live stream without standing up the broader
`livepeer-network-modules` suite.* Surfaces that do not serve that pin are
out of scope.

## 2. LOC-owned broker discovery

The gateway resolves brokers through LOC's authenticated HTTP discovery API.
LOC owns the underlying `service-registry-daemon`; no local resolver socket or
static broker URL fallback is required or supported by gateway startup.
Selection consumes LOC's canonical route snapshot and binding, preserves
lossless quote/domain identity, and rejects incompatible protocol, transport,
work unit, or live descriptor before funding. This boundary was approved in
[plan 0020](../exec-plans/completed/0020-loc-http-discovery.md).

## 3. Mainnet-only — no Livepeer testnets

Deploy and smoke against Arbitrum One. Mitigate risk with dust amounts,
not testnets whose behavior can diverge from production.

## 4. Read-only source repos

`livepeer-network-modules` is the source of truth for the video pipeline;
`blue-claw-network/web-platform` is the shape reference for auth UX. Never
modify either source repo from this working tree. Copies are deliberate and
their source paths are recorded in the introducing commit.

## 5. LOC owns the network payment boundary

The Livepeer Open Clearinghouse (LOC) SDK/API owns funding, authorization
issuance, opening, claiming, settlement, recovery, and payer-daemon interaction. The
gateway supplies a selected route, a conservative funded ceiling, and a
stable request ID; it does not mint payment headers or settle brokers
directly. Customer pricing, Stripe, and a product usage ledger remain
separate product concerns.

Paid workloads are authorization-only. LOC maintains the stable payer-payee
wholesale account and issues each route- and workload-scoped authorization.
The gateway holds a delegated caller key and signs the opaque authorization to
produce the caller proof required by every job, session open, and session cap
revision; it never holds or uses the payer key.
`Livepeer-Payment` may replenish bounded account shortfall, but never
authorizes transcode work by itself. There is no payment-only fallback.

**Why:** Payment state must converge in one durable system. Splitting it
between the gateway, broker, payer daemon, and compensating queues recreates
the ambiguity that the v2 protocols remove.

## 6. The v2 cutover is intentionally breaking

VOD uses `paid-job/v1`; live uses `paid-session/v1`. The legacy mode
taxonomy, `/v1/cap`, `Livepeer-Mode`, `Livepeer-Spec-Version`, and direct
payer path are removed at cutover. There is no dual stack, mode retry, or
mixed-version deployment. Rollback means restoring the entire prior release.

## 7. Durable identity precedes side effects

Every paid job has a stable `Livepeer-Request-Id`; every live stream durably
records its LOC operation/session, broker job/session, selected route and
quote, and lifecycle state before an ambiguous network boundary. A retry
reuses the identical request content and ID. It never opens replacement work
to escape an unknown result.

## 8. One customer stream key is never a runner credential

The gateway gives the customer a public key and obtains a separate private
runner ingest key through the session's `stream-key-issue` grant. Runner
credentials and session parameters are envelope-encrypted at rest, never
logged or returned by status APIs, and cleared when the session becomes
terminal.

## 9. No multi-tenant projects

No `media.projects` table or `/v1/projects` routes. Assets, encoding jobs,
and live streams scope by `api_key_id`. One API key is one customer surface.

## 10. No customer-facing webhooks

No webhook endpoint management, signer, delivery worker, or replay
infrastructure. Asset and stream state are polled through product APIs.
The optional paid-session control WebSocket is an internal protocol signal,
not a customer webhook; authoritative HTTP reconciliation remains required.

## 11. No live-to-VOD recording handoff

`record_to_vod: true` is not supported. Live sessions are ephemeral.

## 12. Auth is Blueclaw-shaped, not customer-portal-shaped

Waitlist, approval, emailed API key, and portal login follow the Blue Claw
UX. The source suite's `customer-portal` dependency is never imported.

## 13. Docker-first build and run

Every component ships with a Dockerfile, a Makefile for common gestures,
and a compose file where multi-service orchestration is needed.

## 14. Image tags are not bumped silently

Republishing an image overwrites the existing tag. Version bumps require
explicit approval.

## 15. Documentation is enforced, not aspirational

Update active docs in the same change as behavior. References are immutable
point-in-time provenance; supersede them with a new dated reference.

## 16. Beads is the work system of record

Exec-plans preserve architecture, sequencing rationale, and release gates.
Beads owns live status, dependencies, blockers, and discovered work; do not
duplicate that state in Markdown checklists.

## 17. Single root `docs/`

All design docs, exec-plans, and references live at the repository root.
Component folders carry only local `AGENTS.md` and `README.md` guidance.

## 18. Dependencies stay current

External dependencies default to their latest stable release. Any deliberate
older pin must be recorded with an explicit reason and tracked in Beads.

## 19. Every code copy is commit-recorded

Code originating elsewhere lands under a deliberate exec-plan with its
source path or shape reference in the introducing commit. There is no
automatic source-repo sync.
