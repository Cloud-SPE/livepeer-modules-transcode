# Live stack recovery verification — 2026-09-23

Read-only inspection of production LOC on infra1 confirmed registry SelectMany
NOT_FOUND during session preparation. Registry logs recorded skipped candidates
due to chain RPC deadline failures and all_circuits_open. The registry has one
configured RPC host, arb1.xode.app. The gateway's preparation in-flight timeout
and registry cache TTL are both 300 seconds. No production changes were made.

The original stream later opened and exhausted its lease. Its broker remains
winding_down. The gateway now preserves winddown_pending, a safe error code and
bounded backoff, rather than rejecting an interim settlement as malformed or
pretending closure completed. Broker access is needed to distinguish outstanding
runner termination from payment authorization settlement.

Local changes include real v2 settlement response parsing, protobuf zero-field
and unspecified-outcome handling, release of creation claims, durable stream
listing, 202 pending creation, owner-only ready publishing details, and accurate
portal lifecycle polling. The final Docker gateway and portal responded healthy
(health status ok and portal HTTP200).

Validation: 167 gateway tests and TypeScript lint passed; five portal tests
passed; the browser recovery scenario passed; 55 desktop/mobile design captures
passed without page errors. The real bounded lifecycle smoke was attempted but
failed at LOC discovery (504 loc_timeout), before creating a test paid session.
A subsequent read-only discovery probe returned404 after32092ms. No real media
publish/HLS/settlement success is claimed. The separate local smoke account key
was revoked and audit rows retained; no email was sent.

The proposed LOC patch was tested only in an isolated source copy: four focused
regressions and35 existing unit tests passed,11 existing legacy cases skipped.
All three original patch target files have matching SHA256 checksums in the
local read-only source checkout and installed production package. The patch is
under docs/proposals/loc-live-recovery and awaits deployment approval. Current
work and upstream blockers are tracked by Beads, not this reference.
