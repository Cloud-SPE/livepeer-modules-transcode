# Design docs

Cross-cutting design decisions for `livepeer-modules-transcode`. This
module is narrow enough that **every** design doc lives here — there are
no per-component `docs/` directories. Component-local guidance lives in
each component's `AGENTS.md` and `README.md` only.

| Doc | Status | What it covers |
|---|---|---|
| [core-beliefs.md](./core-beliefs.md) | active | Invariants every change must uphold |
| [requirements.md](./requirements.md) | active | What the module must do (functional + non-functional) |
| [architecture-overview.md](./architecture-overview.md) | active | Component layers, request flow, and the broker / payment-daemon / resolver boundary |
| [transcode-pipeline.md](./transcode-pipeline.md) | active | VOD batch design: tus upload → encoding job → ABR plan → manifest → playback URL |
| [live-pipeline.md](./live-pipeline.md) | active | Live RTMP design: customer RTMP push → broker session-open → LL-HLS strict-proxy |
| [auth-model.md](./auth-model.md) | active | Blueclaw-modeled auth: waitlist → email verify → admin approval → emailed API key → portal login |
| [dependencies.md](./dependencies.md) | active | Peer services this module requires (broker, payment-daemon, resolver, Resend) and what's deliberately excluded |
| [frontend-dom-and-css-invariants.md](./frontend-dom-and-css-invariants.md) | active | Lit, light DOM, semantic HTML, no inline CSS, styling only from checked-in CSS files |

Stubs (to be written as the porting roadmap surfaces them):

| Doc | Status | What it will cover |
|---|---|---|
| `operator-runbook.md` | stub | Deployment, env-var matrix, smoke procedure, GPU passthrough recipes |
| `data-model.md` | stub | `media.*` schema + `auth.*` schema reference (canonicalized once migrations land) |
| `error-taxonomy.md` | stub | HTTP error shape + `Livepeer-Error` header values used by gateway |

For the porting roadmap that sequences when each component lands, see
[`../exec-plans/active/0001-initial-port-roadmap.md`](../exec-plans/active/0001-initial-port-roadmap.md).

For the agent-first pattern this repo follows, see
[`../references/openai-harness-engineer.md`](../references/openai-harness-engineer.md).
