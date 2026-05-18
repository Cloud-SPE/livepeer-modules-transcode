# PRODUCT_SENSE

What this is, who it's for, what problems it solves, and what it
explicitly is not.

## Who this is for

The **Livepeer customer running video workloads** — a developer or
operator who wants either:

- to submit batch VOD transcode jobs (upload a source video, get back
  HLS renditions + manifest + playback URL), or
- to operate a live stream (push RTMP, get back LL-HLS playback),

…without standing up the broader `livepeer-network-modules` suite. They
want the simplest possible self-service onboarding: a waitlist signup, an
emailed API key after admin approval, and a small portal to manage their
key.

Secondary audience: **the module operator** who runs this stack against
an external capability-broker pool and approves new users through the
admin dashboard.

## What it is

A **standalone deployable transcode product**:

- One TypeScript Fastify gateway (`transcode-gateway/`) that exposes a
  customer-facing HTTP + RTMP surface plus auth + admin endpoints.
- Two Go workload runners (`transcode-runner/`, `abr-runner/`) plus a
  shared Go library (`transcode-core/`) and a codec base image
  (`codecs-builder/`) — the actual FFmpeg work.
- Three zero-build Lit frontends — a waitlist signup site, an
  authenticated portal, and an admin dashboard — modeled after Blue Claw
  Network's onboarding flow.

The auth model is intentionally tiny: email waitlist → admin approval →
emailed API key → portal login with that API key. No Stripe, no
prepaid wallet, no per-customer tier negotiation in v0.

## What it is not

- **Not a `livepeer-network-modules` replacement.** This module is *extracted
  from* that monorepo for the transcode slice only. It does not own the
  capability-broker, payment-daemon, service-registry-daemon, or
  orch-coordinator — those are external peer services.
- **Not a billing platform.** Pricing, cost quotes, usage ledgers,
  Stripe, prepaid wallets, and rate cards are all deferred to phase 2.
  The v0 module is free at the module's layer; commercial wrappers are a
  separate concern.
- **Not a multi-tenant SaaS shell.** No `projects`, no per-customer
  resource isolation beyond the `api_key_id` scoping baked into the
  schema. One API key = one customer surface.
- **Not a webhook delivery system.** No customer-facing webhook
  endpoints, no HMAC signer, no retry/replay infrastructure in v0. Asset
  and stream state are poll-only.
- **Not a CDN.** Operators front the gateway with their CDN of choice
  (CloudFront / Fastly / Cloudflare) for caching and edge replication.
- **Not a fork of `livepeer-network-modules`.** That repo continues to
  ship and is **never modified** by anything done here. The two share no
  submodules, no pinned SHAs, no release schedule. Code is **copied** in
  on deliberate, commit-recorded decisions — never auto-synced.
- **Not a re-implementation of Blue Claw Network.** Blueclaw is a
  **shape reference** for auth UX, not a code source. Its backend is
  Rust/Axum; ours is TypeScript/Fastify. We borrow the route layout, the
  DB-table shape, and the frontend UX — not the code itself.

## Anti-goals

- **No coupling to `customer-portal`.** The transcode module must boot
  without any `@livepeer-network-modules/customer-portal` workspace dep.
  Auth, identity, and the portal SPA are all built fresh from the
  Blueclaw shape.
- **No static broker URL fallback.** The module must always go through a
  service-registry-daemon resolver socket. Single-broker dev setups run
  a one-orch resolver, not a hard-coded URL env.
- **No pricing creep in v0.** Any PR that adds a cost field, a usage
  counter, a rate card, or a Stripe call is out of scope — file a phase-2
  exec-plan instead.
- **No `projects` table.** Assets and streams scope by `api_key_id`,
  full stop. Re-adding multi-tenant projects is a separate phase-2 plan.
- **No webhooks in v0.** Customer-facing callbacks for transcode
  completion are deferred. v0 callers poll.
- **No automatic carryover from `livepeer-network-modules`.** Each port
  is a deliberate, commit-recorded decision under a numbered exec-plan.
- **No edits to `livepeer-network-modules` or `blue-claw-network`** from
  this working tree. Both are read-only references.

## Why this matters

The transcode slice of `livepeer-network-modules` is tangled with the
shared `customer-portal` shell, multi-product admin SPA, projects /
billing / webhooks machinery, and a half-dozen workspace deps it pulls
in. That makes it hard to ship as a standalone product to a customer who
just wants "give me an API for transcode."

This module exists to make that customer's onboarding trivial:
*sign up → wait for approval → get an API key → push RTMP or POST a
VOD job.* The broader monorepo retains the full SaaS shell; this module
ships the minimum viable transcode product.
