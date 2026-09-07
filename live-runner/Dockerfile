ARG GO_VERSION=1.25.7
ARG UBUNTU_VERSION=24.04
ARG MEDIAMTX_IMAGE=bluenviron/mediamtx:1.20.1@sha256:1b029d11049be75630e9b73bb0d5f47b08a7db4eaee89a80bf8f53bc40e56414

FROM ${MEDIAMTX_IMAGE} AS mediamtx

FROM golang:${GO_VERSION}-alpine AS go-builder
WORKDIR /app
COPY transcode-core/go.mod transcode-core/go.sum* /app/transcode-core/
COPY live-runner/go.mod live-runner/go.sum* /app/live-runner/
WORKDIR /app/live-runner
RUN go mod download
COPY transcode-core/ /app/transcode-core/
COPY live-runner/ /app/live-runner/
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /bin/live-runner ./cmd/live-runner

FROM go-builder AS go-test
RUN go test ./...

# The distro FFmpeg build carries the H.264/H.265 software, NVENC, QSV and
# VAAPI encoders needed by the live-standard ladder. Runtime targets add the
# vendor user-space packages used by transcode-core's fail-closed detection.
FROM ubuntu:${UBUNTU_VERSION} AS runtime-ubuntu-base
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

COPY --from=go-builder /bin/live-runner /usr/local/bin/live-runner
COPY --from=mediamtx /mediamtx /usr/local/bin/mediamtx
COPY live-runner/presets.yaml /etc/live-runner/presets.yaml

RUN groupadd --system transcode && \
    useradd --system --gid transcode --home-dir /home/transcode --shell /usr/sbin/nologin transcode && \
    mkdir -p /var/lib/live-runner && \
    chown transcode:transcode /var/lib/live-runner

ENV LIVE_RUNNER_PRESETS_FILE=/etc/live-runner/presets.yaml
VOLUME ["/var/lib/live-runner"]
EXPOSE 8080 1935
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["curl", "--fail", "--silent", "http://127.0.0.1:8080/ready"]
ENTRYPOINT ["/usr/local/bin/live-runner"]

FROM runtime-ubuntu-base AS runtime-cpu
ENV LIVE_RUNNER_HARDWARE=cpu
USER transcode

FROM runtime-ubuntu-base AS runtime-intel
RUN apt-get update && apt-get install -y --no-install-recommends \
    gpg \
    wget \
    && rm -rf /var/lib/apt/lists/* && \
    wget -qO - https://repositories.intel.com/gpu/intel-graphics.key | \
      gpg --dearmor -o /usr/share/keyrings/intel-graphics.gpg && \
    echo "deb [arch=amd64 signed-by=/usr/share/keyrings/intel-graphics.gpg] https://repositories.intel.com/gpu/ubuntu noble unified" \
      > /etc/apt/sources.list.d/intel-gpu.list && \
    apt-get update && apt-get install -y --no-install-recommends \
      intel-media-va-driver-non-free \
      libmfx-gen1.2 \
      libva2 \
      libvpl2 \
      vainfo \
    && rm -rf /var/lib/apt/lists/*
ENV LIVE_RUNNER_HARDWARE=intel
USER transcode

FROM runtime-ubuntu-base AS runtime-amd
RUN apt-get update && apt-get install -y --no-install-recommends \
    libdrm2 \
    libva2 \
    mesa-va-drivers \
    vainfo \
    && rm -rf /var/lib/apt/lists/*
ENV LIVE_RUNNER_HARDWARE=amd
USER transcode

# NVIDIA Container Toolkit injects the host driver, NVENC libraries and
# nvidia-smi. Shipping a multi-gigabyte CUDA userspace is unnecessary for this
# FFmpeg-only runner and can impose a driver constraint unrelated to NVENC.
FROM runtime-ubuntu-base AS runtime-nvidia
ENV LIVE_RUNNER_HARDWARE=nvidia \
    NVIDIA_DRIVER_CAPABILITIES=compute,video,utility
USER transcode
