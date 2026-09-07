# Published v2.0.0 image digests

Published to Docker Hub on 2026-09-06 for the Linux AMD64 Portainer stack:

| Image | Immutable registry reference |
|---|---|
| Codec build base | `tztcloud/codecs-builder:v2.0.0@sha256:9113def35694ce9f352f4e75a53fbfee9c8bf48c6e6af0110002a8778d99df56` |
| VOD NVIDIA runner | `tztcloud/transcode-runner-nvidia:v2.0.0@sha256:7f92ba9b6f9c04f77279cf2f0ddd7aad48ec1704c65e3ee87ed9898777e5e6bc` |
| ABR NVIDIA runner | `tztcloud/abr-runner-nvidia:v2.0.0@sha256:e6059b27099bb30388c40c5d06fbdc5666729f326f71ee69d8ca81921c40e93a` |
| Legacy unqualified live runner (do not deploy) | `tztcloud/live-runner:v2.0.0@sha256:e67b5b1e213727b903654c771e7444e0e91ec191287a03305fb1d4e83ca707f7` |
| NVIDIA live runner | Pending vendor-specific build, push, and GTX 1080 certification |

The old live image did not encode a truthful hardware contract and is retained
above only as historical provenance. The stack requires `LIVE_NVIDIA_IMAGE`;
do not deploy it to production until that value includes the new immutable
digest. `codecs-builder` is a local build input and will not be published by
future release builds.
