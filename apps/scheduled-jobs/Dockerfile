FROM oven/bun:1.4.4 AS prisma
WORKDIR /app
COPY package.json bun.lock bunfig.toml ./
COPY packages/database/package.json packages/database/
RUN bun install --frozen-lockfile --omit=peer --filter @openbeacon/database
COPY packages/database packages/database
RUN DATABASE_URL=postgresql://localhost:5432/openbeacon bun run --cwd packages/database prisma generate

FROM oven/bun:1.4.4 AS deps
WORKDIR /app
COPY package.json bun.lock bunfig.toml ./
COPY apps/backend/package.json apps/backend/
COPY apps/scheduled-jobs/package.json apps/scheduled-jobs/
COPY packages/api/package.json packages/api/
COPY packages/auth/package.json packages/auth/
COPY packages/cache/package.json packages/cache/
COPY packages/database/package.json packages/database/
COPY packages/email/package.json packages/email/
COPY packages/encryption/package.json packages/encryption/
COPY packages/schemas/package.json packages/schemas/
COPY packages/shared/package.json packages/shared/
COPY packages/tsconfig/package.json packages/tsconfig/
# --omit=peer stops bun installing optional peers (expo, react-native) that only the mobile app resolves in bun.lock.
RUN bun install --frozen-lockfile --production --omit=peer --filter @openbeacon/scheduled-jobs

FROM oven/bun:1.4.4
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=deps /app ./
COPY packages packages
COPY apps/backend apps/backend
COPY apps/scheduled-jobs apps/scheduled-jobs
COPY --from=prisma /app/packages/database/generated packages/database/generated

USER bun
ENV NODE_ENV=production
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --start-interval=5s --retries=3 \
    CMD curl -fsS http://127.0.0.1:3000/health > /dev/null || exit 1
CMD ["bun", "run", "apps/scheduled-jobs/src/index.ts"]
