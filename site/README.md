# site

Public marketing + waitlist signup site for Livepeer Transcode.
Vite + Lit web components.

> **For agents:** start at [`AGENTS.md`](./AGENTS.md).

## Pages

- `/` — landing + signup form
- `/verify.html?token=...` — email verification result

## Dev

```sh
pnpm install                                        # at repo root
GATEWAY_URL=http://localhost:4000 pnpm -F @livepeer-modules-transcode/site dev
```

Server runs on port 3000 with `/api/*` proxied to the gateway.

## Build

```sh
pnpm -F @livepeer-modules-transcode/site build
```

Output in `site/dist/`. Deploy to any static host (Cloudflare Pages,
Vercel, S3 + CloudFront).

## Configuration

| Env (build-time) | Default | Purpose |
|---|---|---|
| `VITE_API_BASE` | `""` (same-origin) | Override the gateway base URL in the bundled JS |
| `GATEWAY_URL` | `http://localhost:4000` | Dev-server proxy target |

## License

MIT — repo-root applies.
