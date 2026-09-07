# Image build infrastructure

The centralized image builder follows the release-build shape from
`livepeer-network-modules/infra/scripts/build-images.sh`, adapted for this
repository's shared codec base and hardware-specific runner targets.

From the repository root:

```sh
# Complete matrix. codecs-builder is built first.
./infra/scripts/build-images.sh

# Selected images. Filters are substring matches.
./infra/scripts/build-images.sh codecs-builder transcode-runner
./infra/scripts/build-images.sh abr-runner-nvidia live-runner-nvidia

# Alternate registry/tag without changing checked-in defaults.
REGISTRY=ghcr.io/cloud-spe TAG=2026.9.5 ./infra/scripts/build-images.sh

# Publish release images from a clean committed tree and print their digests.
PUSH=1 REGISTRY=ghcr.io/cloud-spe TAG=2026.9.5 ./infra/scripts/build-images.sh
```

`infra/build/image-versions.env` is the shared source for the default image
tag and Docker toolchain inputs. The default remains `v0.1.0`; changing it is
a release decision, not an incidental build change.

## Image matrix

| Filter/build key | Produced tag | Published with `PUSH=1` |
|---|---|---|
| `codecs-builder` | `REGISTRY/codecs-builder:TAG` | no; local build input |
| `transcode-runner-{nvidia,intel,amd}` | `REGISTRY/transcode-runner:TAG-runtime-*` | yes |
| `abr-runner-{nvidia,intel,amd}` | `REGISTRY/abr-runner:TAG-runtime-*` | yes |
| `live-runner-{nvidia,intel,amd,cpu}` | `REGISTRY/live-runner-*:TAG` | yes |
| `transcode-gateway` | `REGISTRY/transcode-gateway:TAG` | yes |
| `transcode-tester` | `REGISTRY/transcode-tester:TAG` | no; local smoke harness |

The complete build is dependency ordered. A filtered transcode-runner or
abr-runner build does not implicitly spend 20+ minutes rebuilding codecs;
the matching `REGISTRY/codecs-builder:TAG` must already exist locally, or
`codecs-builder` must be included as another filter.

Pushing is deliberately stricter than building. `PUSH=1` requires a clean Git
work tree, including no untracked files, and reports the registry digest for
every pushed artifact. Deployments should pin those digests rather than the
mutable tag.

Component Makefiles remain the quick local-development interface. This script
is the authoritative whole-product/release build path.

Run the Docker-free contract test with:

```sh
./infra/scripts/build-images.test.sh
```

After building, verify all six VOD/ABR and four live variants as real containers.
The smoke uses hardware-independent test presets so it can exercise process
startup, writable durable state, Docker health checks, and runner discovery on
a development host without GPUs:

```sh
TAG=v2-dev REGISTRY=tztcloud ./infra/scripts/runner-images-smoke.sh
./live-runner/scripts/image-smoke.sh tztcloud/live-runner-nvidia:v2-dev nvidia
./live-runner/scripts/image-smoke.sh tztcloud/live-runner-intel:v2-dev intel
./live-runner/scripts/image-smoke.sh tztcloud/live-runner-amd:v2-dev amd
./live-runner/scripts/image-smoke.sh tztcloud/live-runner-cpu:v2-dev cpu
```

The image smoke deliberately overrides GPU admission only for its lifecycle
check. On each real device run `live-runner/scripts/hardware-smoke.sh IMAGE
VENDOR`; hardware encoding and the public RTMPS-to-HLS path still require
Modules certification on an appropriately equipped member.

## Standalone runner Compose examples

[`compose/runners/`](./compose/runners/) contains profile-driven examples for
VOD, ABR, and live runners on NVIDIA, Intel, and AMD hardware, plus explicit
CPU profiles. They run published images, use named durable volumes, and show
the vendor-specific device mappings. These are host-validation and
self-hosting examples; Modules member-agent desired state remains the
canonical Pool production deployment.

## Portainer deployment

[`portainer/nvidia-gtx1080/`](./portainer/nvidia-gtx1080/) is the deployable
Docker Standalone Portainer stack for a remote GTX 1080 host. It runs the
production-named VOD, ABR, and live `v2.0.0` images with persistent state and
Portainer-supplied secrets/public origins.
