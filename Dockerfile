FROM oven/bun:1.4.4 AS deps
WORKDIR /app
COPY package.json bun.lock bunfig.toml ./
COPY apps/backend/package.json apps/backend/
COPY packages/api/package.json packages/api/
COPY packages/auth/package.json packages/auth/
COPY packages/cache/package.json packages/cache/
COPY packages/database/package.json packages/database/
COPY packages/email/package.json packages/email/
COPY packages/encryption/package.json packages/encryption/
COPY packages/schemas/package.json packages/schemas/
COPY packages/shared/package.json packages/shared/
COPY packages/tsconfig/package.json packages/tsconfig/
# Keeps devDependencies because the backend runs `prisma migrate deploy` on startup and prisma is a devDependency of @openbeacon/database.
# --omit=peer stops bun installing optional peers (expo, react-native) that only the mobile app resolves in bun.lock.
RUN bun install --frozen-lockfile --omit=peer --filter @openbeacon/backend

FROM deps AS prisma
COPY packages/database packages/database
RUN DATABASE_URL=postgresql://localhost:5432/openbeacon bun run --cwd packages/database prisma generate

FROM oven/bun:1.4.4
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=deps /app ./
COPY packages packages
COPY apps/backend apps/backend
COPY --from=prisma /app/packages/database/generated packages/database/generated

USER bun
ENV NODE_ENV=production
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --start-interval=5s --retries=3 \
    CMD curl -fsS "http://127.0.0.1:${OPENBEACON_API_PORT:-3000}/health" > /dev/null || exit 1
CMD ["sh", "-c", "bun run apps/backend/src/validateEnv.ts && bun run --cwd packages/database prisma migrate deploy && exec bun run apps/backend/src/index.ts"]
