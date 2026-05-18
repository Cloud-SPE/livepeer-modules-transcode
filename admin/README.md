# admin

Operator dashboard for Livepeer Transcode. Vite + Lit.

> **For agents:** start at [`AGENTS.md`](./AGENTS.md).

## Routes

```
#dashboard   Stats overview (total / today / this week / month + 30-day list)
#signups     Waitlist list: approve / reject / delete / CSV export
```

## Dev

```sh
GATEWAY_URL=http://localhost:4000 \
  pnpm -F @livepeer-modules-transcode/admin dev
```

Port 3001. Proxies `/api/*` to the gateway.

## Build

```sh
pnpm -F @livepeer-modules-transcode/admin build
```

## Auth

Operator pastes the gateway's `ADMIN_TOKEN` env value on login. Cached
in `sessionStorage` (per-tab). Cleared on 401 or sign-out.

## Configuration

| Env (build-time) | Default | Purpose |
|---|---|---|
| `VITE_API_BASE` | `""` (same-origin) | Override gateway base URL |
| `GATEWAY_URL` | `http://localhost:4000` | Dev-server proxy target |

## License

MIT — repo-root applies.
