# Broker winddown and LOC patch review — 2026-09-23

The user granted read-only SSH access to gpu-eu-central.xode.app and
gpu-us-central.xode.app and selected review first for LOC deployment. No remote
container, configuration, source, or persisted session was modified.

EU capability-broker-v2 logs from13:40–14:10UTC contain607 instances of
`runner terminate failed; winddown pending, will retry on sweep`, with
`sessionengine: runner terminate returned400`. The corresponding live runner
logs show subsequent callback rejections409session_terminal. No payment-close
failure appeared in the examined incident log slice. US broker/payment-daemon
logs from the sampled recent30-minute window contained no JSON warn/error
entries; this does not establish US end-to-end health.

The original local durable winddown reason is lease_exhausted. The broker
forwards its pinned reason unchanged to the runner; the live-runner handler
returns400 before loading session state unless the reason belongs to its finite
allowlist. That list included lease_expired but not lease_exhausted, and omitted
several other gateway/broker reasons. Local handler regressions now cover
termination and idempotent replay for thirteen missing codes, retaining the
recorded reason. Gateway requests map product codes to descriptor codes.

Review also identified a missing attempt fence in the initial LOC proposal.
The revised isolated patch captures the preparation claim expiry and performs a
conditional release only if status and expiry still match. Database-backed
local tests preserve renewed/completed claims and request identity. This patch
is not deployed and cannot by itself fix chain RPC availability or runner400.
