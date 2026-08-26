# Design docs

Cross-cutting design decisions for `livepeer-modules-transcode`. This
module is narrow enough that **every** design doc lives here — there are
no per-component `docs/` directories. Component-local guidance lives in
each component's `AGENTS.md` and `README.md` only.

| Doc | Status | What it covers |
|---|---|---|
| [core-beliefs.md](./core-beliefs.md) | active | Invariants every change must uphold |
| [requirements.md](./requirements.md) | active | What the module must do (functional + non-functional) |
| [architecture-overview.md](./architecture-overview.md) | active | Modules v2 target: resolver, LOC, broker, gateway, and runner boundaries |
| [transcode-pipeline.md](./transcode-pipeline.md) | active | One `paid-job/v1` streaming ABR exchange, usage, recovery, and playback |
| [live-pipeline.md](./live-pipeline.md) | active | `paid-session/v1` RTMP relay, private runner keys, bounded refills, and LL-HLS |
| [auth-model.md](./auth-model.md) | active | Blueclaw-modeled auth: waitlist → email verify → admin approval → emailed API key → portal login |
| [dependencies.md](./dependencies.md) | active | Required LOC, broker, resolver, storage, database, and email boundaries |
| [frontend-dom-and-css-invariants.md](./frontend-dom-and-css-invariants.md) | active | Lit, light DOM, semantic HTML, no inline CSS, styling only from checked-in CSS files |

Related operational contracts:

| Doc | Status | What it will cover |
|---|---|---|
| [Modules v2 operations](../runbooks/modules-v2-operations.md) | active | Environment, monitoring, recovery, deployment, and rollback |
| `data-model.md` | stub | `media.*` schema + `auth.*` schema reference (canonicalized once migrations land) |
| `error-taxonomy.md` | stub | HTTP error shape + `Livepeer-Error` header values used by gateway |

For the porting roadmap that sequences when each component lands, see
[`../exec-plans/completed/0001-initial-port-roadmap.md`](../exec-plans/completed/0001-initial-port-roadmap.md).

For the active breaking migration, see
[`../exec-plans/active/0018-livepeer-modules-v2-migration.md`](../exec-plans/active/0018-livepeer-modules-v2-migration.md).

For the agent-first pattern this repo follows, see
[`../references/openai-harness-engineer.md`](../references/openai-harness-engineer.md).
