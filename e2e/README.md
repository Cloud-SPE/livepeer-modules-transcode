# e2e

End-to-end compose-stack smoke for the transcode module.

> **For agents:** start at [`AGENTS.md`](./AGENTS.md).

## Run

```sh
cp .env.example .env       # or set the four env vars by hand
make smoke
```

`make smoke` brings up postgres + MinIO + the gateway, waits for
readiness, then drives the full auth + VOD + live + HLS-proxy shape.
Exits 0 on success; loud failure messages otherwise.

## Local browser UIs

From the repository root, start the optional Docker development UI profile:

```sh
docker compose -p transcode-local -f e2e/compose.yaml --profile ui up -d --build
```

The signup site is at `http://localhost:3000`, admin at
`http://localhost:3001`, and the customer portal at `http://localhost:3002`.
All three proxy API requests to the gateway container. The default local admin
token is `dev-admin-token-1234567890`; the portal accepts a customer API key
issued through admin approval. Development verification emails are available
in gateway logs. These UIs use Vite development servers and are not production
hosting images. Rebuild after changing frontend source.
The UI image includes `frontend/theme.css`, the shared customer/admin theme.

The UI profile does not enable paid encoding or live streaming; the resolver
and LOC dependencies described below remain unwired.

## External demo services

The optional `compose.demo.yaml` overlay loads credentials from ignored
`e2e/.env.demo`. Start from `e2e/demo.env.example` and keep the populated file
private (mode 0600). It accepts
`LIVEPEER_LOC_URL`, `LIVEPEER_LOC_API_KEY`, `LIVEPEER_LOC_TIMEOUT_MS`,
`LIVEPEER_CALLER_PRIVATE_KEY`, `LIVEPEER_OPERATION_SECRETS_KEK`,
`LIVEPEER_OPERATION_SECRETS_KEY_ID`, `RESEND_API_KEY`, `RESEND_BASE_URL`, and
`FROM_EMAIL`. The caller key is raw lowercase secp256k1 hex; the wrapping key
is canonical base64 encoding of 32 random bytes. Preserve both across restarts.
`RESEND_BASE_URL` defaults to `https://api.resend.com` and supports compatible
email services. The gateway appends `/emails` and refuses redirects.

```sh
docker compose -p transcode-local -f e2e/compose.yaml -f e2e/compose.demo.yaml --profile ui up -d --build
```

This overlay enables real email when a key is present. Do not run the dry-run
email smoke against it. Local verification links use `localhost:4000` and
portal links use `localhost:3002`; recipients must open them on the Docker host.
Change the overlay URLs before inviting remote testers.

LOC supplies broker discovery over authenticated HTTP, so this demo needs no
local resolver container or socket. Startup rejects the former
`LIVEPEER_RESOLVER_SOCKET` setting. MinIO remains local-only; remote runners
need an externally reachable S3 endpoint. RTMP port 1935 is published for the
configured gateway listener, but a compatible live route and reachable runner
media endpoints are still required. Discovery verification does not fund work.

## Coverage matrix

### `make smoke` — stub-path regression

| Surface | Assertion |
|---|---|
| Boot      | `wire.resolver.stub` + `storage.s3.connected` logged |
| Auth      | full signup → verify → approve → login → profile → rotate → logout |
| VOD       | POST /uploads → PUT to MinIO → POST :id/complete → POST /vod/submit asserts 503 `no_video_transcode_route` (stub resolver); list + detail work |
| Live      | POST /live/streams asserts 503 `resolver_not_configured` |
| HLS proxy | GET /_hls/foo asserts 404 `playback_session_not_found` |

## What's NOT covered

- Actual transcode (needs real broker + runner)
- Actual RTMP push (needs real encoder + working broker)
- LOC payment and settlement (needs a real LOC process)
- LOC route selection (requires real LOC discovery)

The smoke deliberately stays at "the gateway degrades correctly without
them." Modules v2 and LOC conformance are exercised by the cross-repository
release matrix, not by the removed legacy direct-payer mock stack.

## License

MIT — repo-root applies.

### Frontend design acceptance (Path A)

The portal/admin use LOC Path A; the site follows the OpenAI demo signup
composition. Dark is the default. An explicit saved light preference remains.
`VITE_PORTAL_URL` and `VITE_SITE_URL` override cross-app links at build time.
Without overrides, production uses `/portal/` and `/`; Vite on ports
3000–3002 uses the current hostname and the appropriate local port.

After rebuilding the UI services, run the browser harness with Playwright
installed in the environment (Chromium must also be installed):

```bash
node e2e/ui-design-check.mjs
# Or point to an existing Playwright ES module installation:
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node e2e/ui-design-check.mjs
```

Set `LOCAL_ADMIN_TOKEN` in your shell to include real local admin login,
read-only stats and signout verification. Otherwise that integration check is
skipped. Authenticated product screens use intercepted fixture responses;
signup/verification feedback tests also intercept requests and send no emails.
The harness creates no paid workloads. Screenshots and `results.json` go to
`/tmp/transcode-path-a`, override with `UI_EVIDENCE_DIR`.

Checks include every portal/admin route at 1440px and 390px, 44px headers,
active route indication, table overflow containment, mobile drawer keyboard
containment/Escape/backdrop/route dismissal, optional light persistence,
login validation and fixture empty/error states. Inspect the screenshots
against the reference sources; a passing browser script alone is not a
visual design review. See plan 0021 for provenance and results.

`ui-auth-flow-check.mjs` adds intercepted browser regression coverage for
unverified approval errors, verification resend feedback, provider failures,
and retaining newly issued API keys when the pending filter removes their
rows. Run it with the same `PLAYWRIGHT_MODULE` setup. It sends no real emails
and changes no real signup records. Catalog coverage is included in the main
UI harness, including desktop/mobile and empty/error views.

For local onboarding recovery, open Admin → Signups. Pending unverified
entries expose **Resend verification**. Open the emailed link, refresh the
list, select the now-verified entry, and approve it. New API keys stay in the
separate **save now** panel even when the pending list refreshes. Mail provider
acceptance is shown explicitly; inspect gateway logs for provider failures.
The local demo needs `SITE_URL=http://localhost:3000`, because verification
links should open the signup site's verification page.

### Live recovery verification

`ui-live-recovery-check.mjs` exercises pending creation, recovered credentials,
ending, and durable listing after reload with mocked API responses. Run with
`PLAYWRIGHT_MODULE` pointing to an installed Playwright module.

For an explicitly authorized real network smoke, copy `live-stack-smoke.mjs`
into `/app/transcode-gateway/` in the local gateway container and execute it
there. It creates a separate approved local test account without sending email,
opens one paid live session with configured limits, publishes a 20-second test
pattern, checks HLS, requests closure and checks settlement. It revokes its test
API key, retains audit records, and reports failure if upstream discovery,
media output or settlement does not complete. This is a real paid network test.
