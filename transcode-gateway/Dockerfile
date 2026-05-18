# syntax=docker/dockerfile:1.7

# ---------- build ----------
FROM node:24-alpine AS build
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

# Workspace-aware install — copy lockfile from repo root.
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY transcode-gateway/package.json transcode-gateway/

RUN pnpm install --filter @livepeer-modules-transcode/transcode-gateway... --frozen-lockfile

COPY transcode-gateway/tsconfig.json transcode-gateway/
COPY transcode-gateway/src/ transcode-gateway/src/

WORKDIR /app/transcode-gateway
RUN pnpm build

# ---------- runtime ----------
FROM node:24-alpine AS runtime
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

ENV NODE_ENV=production

COPY --from=build /app/pnpm-workspace.yaml /app/package.json /app/pnpm-lock.yaml* ./
COPY --from=build /app/transcode-gateway/package.json transcode-gateway/
COPY --from=build /app/transcode-gateway/dist/ transcode-gateway/dist/
COPY --from=build /app/transcode-gateway/migrations/ transcode-gateway/migrations/
COPY transcode-gateway/proto/ transcode-gateway/proto/

RUN pnpm install --filter @livepeer-modules-transcode/transcode-gateway --prod --frozen-lockfile

WORKDIR /app/transcode-gateway
EXPOSE 4000
CMD ["node", "dist/index.js"]
