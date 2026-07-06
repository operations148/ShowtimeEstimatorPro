# ── Build stage ──
FROM node:20-alpine AS builder
RUN corepack enable && corepack prepare pnpm@9 --activate
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
COPY packages/pricing-engine/package.json packages/pricing-engine/
COPY packages/provider-adapters/package.json packages/provider-adapters/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter api build

# ── Runtime stage ──
FROM node:20-alpine
RUN corepack enable && corepack prepare pnpm@9 --activate
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/package.json ./apps/api/
COPY --from=builder /app/packages ./packages

EXPOSE 4000
ENV NODE_ENV=production
CMD ["node", "apps/api/dist/index.js"]
