# Portainer deployment — NVIDIA GTX 1080

This directory is the deployable Portainer stack for one Docker Standalone
host with NVIDIA Container Toolkit and a GTX 1080. It pulls the production
`v2.0.0` images; it does not build on the server.

VOD and ABR retain their immutable `v2.0.0` Docker Hub references. Set
`LIVE_NVIDIA_IMAGE` to the vendor-specific live image. During local
qualification it may be `tztcloud/live-runner-nvidia:v2.0.0`; before a
production redeploy, replace it with the immutable digest emitted by the
release build and record that digest in `image-digests.md`.

In Portainer:

1. Open **Stacks → Add stack → Web editor**.
2. Paste `stack.yaml`.
3. Add every variable from `stack.env.example` under **Environment variables**.
4. Replace the GPU UUID, all three live secrets, and both public URLs.
5. Replace `LIVE_NVIDIA_IMAGE` with its qualified immutable reference.
6. Deploy the stack.

The Docker host must return the card from:

```sh
nvidia-smi --query-gpu=uuid,name --format=csv,noheader
docker run --rm --gpus all nvidia/cuda:12.9.1-runtime-ubuntu24.04 nvidia-smi
```

Open only the required firewall paths:

- TCP 18080: VOD runner HTTP, trusted broker/operator sources only.
- TCP 18180: ABR runner HTTP, trusted broker/operator sources only.
- TCP 18280: live control and HLS. Restrict control routes with the surrounding
  network boundary; HLS needs the reachability named by `LIVEPEER_PUBLIC_URL`.
- TCP 1935: direct plain RTMP ingest. Modules production normally terminates
  RTMPS at its member edge instead.

Health checks after deployment:

```sh
curl --fail http://SERVER:18080/healthz
curl --fail http://SERVER:18180/healthz
curl --fail http://SERVER:18280/ready
```

The three containers reserve the same physical GPU. They may remain online,
but the broker/pool must not admit VOD or ABR work during an active live
broadcast. A GTX 1080 has no AV1 encoder; use H.264 or HEVC presets only.
Before admitting live work, run
`live-runner/scripts/hardware-smoke.sh tztcloud/live-runner-nvidia:v2.0.0
nvidia` from a checkout on this host, followed by the Modules real-publish
certification. Encoder enumeration alone is not sufficient.

Named volumes preserve request replay and live-session state across Portainer
redeployments. Never select **Remove volumes** during an ordinary update.
