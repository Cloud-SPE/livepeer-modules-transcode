# live-runner

Runner-owned RTMP ingest and LL-HLS output for `paid-session/v1`, using the
capability-owned `rtmp-hls/v1` runtime descriptor.

This component currently pins the runner contract. Runtime implementation is
tracked by Bead `lmt-65a.4.5`.

## Process startup

The executable lives at `./cmd/live-runner`. Startup is fail-closed: it loads
and validates the configured live presets, opens the encrypted state store,
starts the pinned MediaMTX binary, waits for its loopback API, and converges
pending key activation, active sessions, and durable stopping intents before
serving HTTP. An unexpected MediaMTX exit terminates the runner. Graceful
shutdown stops HTTP admission, joins FFmpeg sessions, and then stops
MediaMTX.

Required environment variables are `LIVE_RUNNER_MASTER_KEY` (base64 for 32
bytes), `LIVE_RUNNER_BROKER_TOKEN`, `LIVE_RUNNER_INTERNAL_MEDIA_TOKEN`,
`LIVEPEER_PUBLIC_RTMP_URL`, `LIVEPEER_PUBLIC_URL`, and
`LIVE_RUNNER_PRESETS_FILE`. Modules injects the first as the public RTMPS
origin (for example `rtmps://host:1936`) and the second as the public HTTP
service origin. The runner derives all public ingest, playback, key-issue,
and status URLs from those two values. MediaMTX
listener addresses, its internal auth URL, the state directory, binary path,
and encoder concurrency have `LIVE_RUNNER_*` overrides; private HLS, API, and
metrics addresses are still rejected unless loopback-only.

`make image-test` runs the Go suite in the same copied module graph used by
the image. `make image HARDWARE=nvidia` (or `intel`, `amd`, `cpu`) builds one
non-root runtime containing FFmpeg, the pinned MediaMTX binary, and
`presets.yaml`; `make image-smoke HARDWARE=...` validates its declared target,
encoder surface, health, and bounded SIGTERM exit.

Hardware policy is explicit and fail-closed. The published artifacts are
`live-runner-nvidia`, `live-runner-intel`, `live-runner-amd`, and
`live-runner-cpu`; there is no universal `any` GPU image. Each image bakes its
target into `LIVE_RUNNER_HARDWARE`. A GPU image refuses startup unless the
matching device and live H.264 encoder (`h264_nvenc`, `h264_qsv`, or
`h264_vaapi`) are detected. The CPU image deliberately skips GPU detection and
uses `libx264`; it is a separately priced/certified offering, not silent GPU
fallback. `auto` remains available only for source-level development and must
not be used for a catalog claim.

Image inspection cannot prove a GPU encoder works. On a correctly equipped
host, `scripts/hardware-smoke.sh IMAGE VENDOR` initializes the actual encoder,
starts the runner with its vendor admission check enabled, waits for health,
and verifies graceful termination. Modules certification must additionally
exercise a real RTMP publish and advancing LL-HLS before that hardware class is
admitted. In particular, GTX 1080 certification must execute NVENC rather than
only list the encoder.

## Media router

The runner uses a pinned MediaMTX `1.20.1` process for authenticated
RTMP routing and real low-latency HLS muxing. The immutable container image is
recorded in `media.go`. RTMP is its only network-facing listener and is
restricted to the broker/gateway network (or a TLS edge); HLS, API, and
metrics bind to loopback and are reached through runner-owned surfaces.
RTSP, WebRTC, SRT, MoQ, recording, and publisher replacement are disabled.

MediaMTX delegates authentication to the runner. The current issued stream
key can publish only `ingest/<runner-session-id>`. A separate per-session
token derived from a runner-only root secret reads that ingest and publishes
`renditions/<runner-session-id>/<name>`.
Loopback HLS reads are allowed only while the corresponding session is
active. Rotation durably marks the replacement key as pending, disconnects
the existing MediaMTX publisher, and only then activates the replacement.
An identical retry completes an interrupted disconnect without issuing a
second key; completed retries do not disconnect the replacement publisher.
Terminal state rejects every path and termination also disconnects any
already-authenticated ingest publisher.

The descriptor's RTMP server URL ends in `/ingest`. Its issued stream key is
opaque to callers but composes as
`<runner-session-id>?token=<rotated-secret>`, so joining the two supplies
MediaMTX with exactly the scoped `ingest/<runner-session-id>` path and token.

An idempotent runtime coordinator watches the loopback MediaMTX path API for
the session's authenticated RTMP publisher. Only then does it acquire encoder
capacity and start one context-bound FFmpeg process that decodes once and
publishes the selected ladder back to the private rendition paths. Publisher
disconnects or transient launch failures return to the watch loop; runner
termination and process shutdown cancel and join the FFmpeg process.

The advertised public HLS route synthesizes one deterministic master playlist
from the session's durable output profile. Rendition playlists, parts,
initialization fragments, and segments are streamed from loopback MediaMTX
through an allowlisted same-origin proxy. It forwards no customer headers or
cookies, permits only MediaMTX's exact same-path internal cookie handshake,
follows no other redirects, and marks every response `no-store`; stopping and
terminal sessions are unavailable immediately. The MediaMTX session cookie
never crosses the public runner boundary.

## Runner surface

Paths are operator-configured in Modules; these are this runner's declared
defaults:

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/v1/sessions` | Idempotently create a runner session |
| `GET` | `/v1/sessions/{id}` | Reconcile runner state and cumulative usage |
| `DELETE` | `/v1/sessions/{id}` | Idempotently terminate media and credentials |
| `POST` | `/v1/sessions/{id}/stream-keys` | Issue/rotate a scoped ingest key using the grant |
| `GET` | `/v1/public/sessions/{id}/status` | Read the credential-free status advertised by the descriptor |
| `GET` | `/.well-known/livepeer-runner` | Authoritative runner-owned attach contract |
| `GET` | `/ready` | Readiness probe |

The create request is keyed by the broker `session_id`. An identical retry
returns the recorded runner session and descriptor without starting another
runtime or minting a new grant. Different content for the same ID is rejected
as `runner_session_id_reuse`.

Broker create, status, and terminate calls use the operator-configured runner
bearer. Event callbacks use the per-session callback bearer received on
create. Stream-key issuance uses the `stream-key-issue` grant bearer, never
the broker credential or callback token. A key-issuance `request_id` is its
idempotency key: an identical retry returns the same key; changed content is
`request_id_reuse`; a new request ID rotates the key and invalidates its
predecessor. Retrying a superseded request ID returns `request_id_superseded`
instead of disclosing a key that can no longer publish.

## Metering

`output_seconds` is the cumulative whole seconds of finalized media on the
session's named `metering_rendition`. Segment durations are summed once and
floored after aggregation. It is not input duration, wall-clock time, or a
sum across the ABR ladder. This makes the claim a playable-output measure and
keeps gateway wall clock plus advancing HLS useful as independent checks.
The runner polls MediaMTX's rendition media playlist and counts only complete
`EXTINF` segments, never low-latency parts. It atomically persists hashed
segment identities, the fractional microsecond total, and any resulting usage
event. Playlist rereads and process restarts therefore converge without a
second claim, while a new media epoch's new segment identities continue the
same cumulative timeline. Unavailable or malformed playlists are retried and
cannot advance usage.

Every event has a durable positive sequence and stable event ID. Usage totals
never decrease. An accepted event is also a heartbeat; otherwise the runner
emits `session.heartbeat` within the offering's required cadence.
Callbacks are delivered from the durable outbox in sequence order with the
per-session callback bearer. Any 2xx broker response acknowledges an event;
timeouts, 408, 429, and 5xx responses remain retryable. Redirects are never
followed, preventing callback credentials from crossing the broker-selected
origin. A process-owned worker resumes pending outboxes after restart. It
retains permanent callback failures for operator inspection and erases a
terminal session's encrypted credentials only after the final event has been
durably acknowledged.

## Credential boundary

Object-store credentials and the callback token enter in the create request
and never appear in runtime public data, status, events, errors, or logs.
`rtmp_url` and `hls_url` are customer-safe. `key_issue_url` is public in the
descriptor framework but gateway-only at the product boundary. Grant secrets
appear only in the open response. Issued stream keys appear only in the key
issuance response.

`gateway-relay` issuance gives the key only to the gateway relay.
`direct-publisher` permits the gateway to deliver that key to its publisher;
the runner contract and descriptor remain identical.

## Restart and termination

Before starting media, the runner durably records the create fingerprint,
runner session ID, exact descriptor, encrypted callback token, grant hash and
encrypted secret, session parameters, state, event sequence, cumulative
usage, finalized-segment cursor and fractional remainder, and issued-key
request records. Restart returns the same status and
continues the next sequence without resetting usage or reissuing a grant.
Each session's secrets use an independent data-encryption key wrapped by the
runner master key, and the complete durable record is integrity-protected.

Termination is idempotent. Unknown, already-ended, and repeated termination
requests succeed without restarting media. The terminal transition stops
ingest and HLS, emits one final cumulative event, and destroys callback,
grant, stream-key, and storage credentials. A runner must never serve media
after terminal state. Secret destruction removes the current wrapped
per-session key and encrypted payload from durable runner state.
The runner persists a stopping intent before touching media; restart retries
that same termination reason and never re-authorizes ingest while cleanup is
incomplete.
