# Local live creation failure — 2026-09-23

At 13:35:51.136 UTC (09:35:51 EDT), request
`cc90be0b-a785-441c-a7d9-b854ca868231` returned HTTP 500 for
`POST /v1/live/streams` after 30005ms. The configured LOC timeout is 30000ms.
The stack records LocTransportError from `locHttpTransport.request`, through
`locWorkerResolver.selectWorker`, to the discovery call in the live route.

Discovery ran outside the live-open try/catch. The global error handler
therefore converted the upstream failure to a generic Internal server error.
The elapsed time is consistent with a LOC request timeout. Old logs retained
only the generic exception message and stack, not its typed error code; they
cannot establish whether the upstream stall was within LOC or the network.

The failed request did not reach `openPaidLiveStream`; no paid-session open
was attempted. Both `media.live_streams` and `media.paid_operations` were empty
when inspected. A subsequent read-only discovery request using the exact
loaded gateway configuration succeeded in 577ms with paid-session/v1.
No new stream or paid workload was submitted during debugging.

Fix: catch typed LOC failures around discovery, return sanitized explanatory
504/503/502 responses with request ID and retryability, and emit structured
`live.discovery_failed` metadata. Unexpected programming errors still reach
the global error handler. This fixes error classification and visibility,
not an unproven underlying LOC/network reliability issue.

Regression tests cover timeout, network unavailability, upstream credential
rejection, malformed response, and throttling with Retry-After. They assert
that no paid client, store, or stream repository is touched on discovery
failure and that private upstream details do not enter the response.

Tracked in Beads `lmt-n98`.
