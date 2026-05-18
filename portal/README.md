# portal

Authenticated user portal for Livepeer Transcode. Vite + Lit.

> **For agents:** start at [`AGENTS.md`](./AGENTS.md).

## Routes

```
#dashboard        Profile + quick links
#account          Rotate API key
#assets           VOD asset library
#assets/:id       Asset detail (renditions, jobs, playback)
#upload           Upload widget (presigned S3 PUT)
#live             Live streams (create + manage)
#live/:id         Live stream detail
```

## Dev

```sh
GATEWAY_URL=http://localhost:4000 \
  pnpm -F @livepeer-modules-transcode/portal dev
```

Port 3002. Proxies `/api/*` + `/v1/*` to the gateway.

## Build

```sh
pnpm -F @livepeer-modules-transcode/portal build
```

## Configuration

| Env (build-time) | Default | Purpose |
|---|---|---|
| `VITE_API_BASE` | `""` (same-origin) | Override gateway base URL |
| `GATEWAY_URL` | `http://localhost:4000` | Dev-server proxy target |

## License

MIT — repo-root applies.
