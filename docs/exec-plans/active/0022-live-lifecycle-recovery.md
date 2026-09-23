# 0022 — Live lifecycle recovery and production verification

The user-reported create failure exposed independent failures across discovery,
preparation, customer status, and settlement. Beads owns execution status:
`lmt-l7g` (incident), `lmt-rdj` (settlement), `lmt-gxz` (portal), `lmt-zzy`
(creation lease), `lmt-qcg` (LOC proposal), `lmt-lku` (broker winddown), and
`lmt-2uw` (real lifecycle verification).

The gateway must preserve the original request identity across uncertain
network results. A saved create that needs recovery returns 202 and its stream
identity; the portal polls the owned stream instead of suggesting replacement
work. A durable owner-scoped list restores streams after browser reload. Only
ready owner detail exposes the customer publishing key, never runner secrets.

Closure remains nonterminal while the broker is winding down. Retry metadata
and bounded backoff make this visible without continuous failed requests.
Settlement accepts the actual v2 protobuf JSON representation, including omitted
zero fields and unspecified outcome, while preserving identity checks and the
unchanged signed envelope for LOC's authoritative verification. Successful or
failed creation releases its latest recovery claim before returning.

Local validation includes route ownership/credential tests, real broker-shaped
settlement fixtures, pending-close and lease-release regressions, portal browser
coverage, and Docker rebuilds. The bounded real-network smoke publishes a
20-second test pattern, retrieves an HLS media segment and requires final LOC
settlement. Mocked browser/unit results do not establish production readiness.

Production inspection on infra1 is explicitly read-only. The isolated LOC
proposal under `docs/proposals/loc-live-recovery/` requires approval before any
source application or production deployment. Chain RPC availability and the
broker's outstanding termination/payment obligation must also be resolved;
changing customer status or accepting an interim settlement cannot solve them.

Read-only EU broker logs subsequently identified repeated runner termination400
responses. Gateway `lease_exhausted` did not belong to the runner's strict
reason set (`lease_expired` does). Bead `lmt-9tr` covers outgoing gateway reason
mapping plus finite runner compatibility for reasons already pinned by the
broker. The gateway changes are being activated in the local Docker stack; the runner
review image is built locally. Production deployment is not authorized. Correcting future outgoing reasons alone cannot repair a broker
that preserves the first reason on every winddown retry.
