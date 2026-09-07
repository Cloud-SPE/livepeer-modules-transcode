# Live runner vendor-image handoff

Date: 2026-09-07  
Transcode work item: `lmt-65a.4.11`  
Modules revision inspected: `eec4a685d342ac4406d25f19cae562c0d5f31d20`

This is the transcode repository's catalog handoff for the breaking live image
change. It supersedes the assumption that one Ubuntu image under `any` can
truthfully serve every GPU vendor.

## Image contract

The live runner now has four explicit Linux AMD64 artifacts:

| Catalog hardware key | Image |
|---|---|
| `nvidia` | `tztcloud/live-runner-nvidia:<release>@sha256:<digest>` |
| `intel` | `tztcloud/live-runner-intel:<release>@sha256:<digest>` |
| `amd` | `tztcloud/live-runner-amd:<release>@sha256:<digest>` |
| CPU-only offering | `tztcloud/live-runner-cpu:<release>@sha256:<digest>` |

There is intentionally no `any` image. A vendor image has
`LIVE_RUNNER_HARDWARE` baked in and exits before serving if the matching device
and required live H.264 encoder cannot be detected. The CPU image deliberately
uses software encoding and must be represented by a CPU offering rather than a
GPU image-map fallback.

The `paid-session/v1` and `rtmp-hls/v1` request, response, and descriptor
contracts are identical across artifacts. `runner_compose.rtmp_port: 1935`
also remains unchanged.

## Modules changes requested

1. Remove `image.any` from `templates/video-transcode-live.yaml`.
2. Add only the vendor keys for which the template has corresponding admitted
   hardware classes and completed certification. Do not introduce a vendor key
   merely because its image builds.
3. Pin immutable release digests supplied by this repository after publication.
4. If CPU live is sold, model it as a separately priced CPU template/offering;
   do not make it a fallback for a GPU claim.
5. For every admitted hardware class, run attached-runner session
   certification through open, actual RTMP publish, advancing LL-HLS, usage,
   terminate, and restart recovery. The device test must initialize the target
   encoder; `ffmpeg -encoders` output alone is not evidence.

The current Modules catalog admits NVIDIA GPU classes only. Intel and AMD
artifacts may be built and tested independently, but their catalog keys remain
disabled until Modules adds truthful classes and the joint real-device matrix
passes. A GTX 1080 must execute an H.264 NVENC live encode before its existing
class can admit this image.
