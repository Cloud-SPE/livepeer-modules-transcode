# Runner Compose examples

Standalone, production-shaped examples for the VOD, ABR, and live runners.
The examples run published images rather than building source and keep every
runner's replay/session journal on a named volume.

Livepeer Modules member-agent desired state remains the canonical Pool
deployment path. Use these profiles to validate an image on a host, operate a
self-hosted runner, or reproduce a certification failure. A runner started
here does not become sellable until it attaches to a capability broker through
the Modules workflow.

## Configure

```sh
cd infra/compose/runners
cp .env.example .env
```

The checked-in values are development placeholders, not credentials. Before a
live profile starts, replace the master key and both tokens. For production,
replace every selected `*_IMAGE` value with the immutable tag and digest
printed by `infra/scripts/build-images.sh` after a `PUSH=1` release build.

The HTTP ports bind to loopback because only a broker should invoke a runner.
Live RTMP binds on all interfaces so a publisher can reach it; restrict that
binding with `LIVE_*_RTMP_BIND` or a host firewall. A standalone live runner
whose HLS output must be public also sets `LIVE_*_HTTP_BIND=0.0.0.0` and makes
`LIVE_*_PUBLIC_URL` match its externally reachable origin. These standalone
examples serve plain RTMP. Production RTMPS is terminated by the Modules
member edge.

## Start one profile

Use the profile matching both the product and the host hardware:

```sh
docker compose --profile vod-nvidia up -d
docker compose --profile vod-intel up -d
docker compose --profile vod-amd up -d

docker compose --profile abr-nvidia up -d
docker compose --profile abr-intel up -d
docker compose --profile abr-amd up -d

docker compose --profile live-nvidia up -d
docker compose --profile live-intel up -d
docker compose --profile live-amd up -d
docker compose --profile live-cpu up -d
```

The local Makefile wraps the same commands and always supplies `.env` (or
`.env.example` when `.env` has not been created):

```sh
make validate
make up PROFILE=vod-nvidia
make logs PROFILE=vod-nvidia
make down PROFILE=vod-nvidia
```

`vod-cpu` is staged for the SVT-AV1 image tracked by `lmt-65a.3.10`; it will
not pull successfully until that image ships.

GPU profiles in this Compose project share initialized admission files.
VOD and ABR may share the batch cohort; live excludes batch until its last
lease ends. Runner-local concurrency limits still apply. For example:

```sh
docker compose --profile vod-nvidia --profile abr-nvidia --profile live-nvidia up -d
```

The one-shot `gpu-admission-init` must succeed before GPU runners start. It
uses the CPU live image only to run a shell and initialize file permissions;
GPU runners retain their vendor images and never fall back to CPU encoding.
CPU profiles do not participate in GPU admission.

NVIDIA lock domains use `NVIDIA_GPU_ID`; production should use the stable GPU
UUID. Intel and AMD expose their full device trees and conservatively share
one `dri` domain. To run separate DRI devices independently, first restrict
device mappings and assign matching physical-device lock identities. Set
`VIDEO_GID` and `RENDER_GID` to match the host's device permissions.

The named admission volume is scoped to this Compose project. Do not manage
the same GPU from a second Compose project, Portainer, or Modules at the same
time: separate volumes do not coordinate leases. Stop every older runner on
the GPU before upgrading to these admission-enabled images. Preserve the
admission volume during rolling restarts so all runners see the same files.

## Verify

The default control ports are:

| Profile | Port | Discovery check |
|---|---:|---|
| `vod-nvidia` / `vod-intel` / `vod-amd` / `vod-cpu` | 18080–18083 | `/.well-known/livepeer-runner` |
| `abr-nvidia` / `abr-intel` / `abr-amd` | 18180–18182 | `/.well-known/livepeer-runner` |
| `live-nvidia` / `live-intel` / `live-amd` / `live-cpu` | 18280–18283 | `/.well-known/livepeer-runner` |

For example:

```sh
curl --fail http://127.0.0.1:18080/healthz
curl --fail http://127.0.0.1:18080/.well-known/livepeer-runner
docker compose ps
```

The image health checks use `/healthz` for VOD/ABR and `/ready` for live.
Inspect failures with `docker compose logs <service>`.

## Stop and preserve state

```sh
docker compose --profile vod-nvidia down
```

`down` preserves the named volumes. Do not add `--volumes` during ordinary
upgrades: removing the journal discards terminal replay and changed-content
reuse protection. Back up the selected `*-state` volume before an upgrade or
host migration. Only delete it as an explicit destructive reset.

## Production handoff

After host validation:

1. Pin the same image digest in the matching Modules template
   `runner_compose.image` entry.
2. Ensure Modules gives `/var/lib/transcode-runner`, `/var/lib/abr-runner`, or
   `/var/lib/live-runner` a stable per-placement volume.
3. Apply placement and require Modules certification before admitting work.
4. Run the joint transcode, Modules, and LOC conformance matrix.

The four live profiles are distinct products at the image boundary. Never map
a GPU catalog key to `live-runner-cpu`, and never map `any` to one of the
vendor images. GPU images fail startup when their matching device or H.264
encoder is unavailable; CPU execution is intentionally named rather than an
implicit fallback.
