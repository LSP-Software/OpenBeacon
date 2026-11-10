FROM oven/bun:1.4.4

RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*

WORKDIR /app
RUN chown bun:bun /app
USER bun
COPY --chown=bun:bun . .
RUN bun install --frozen-lockfile
RUN DATABASE_URL=postgresql://localhost:5432/openbeacon bun run --cwd packages/database prisma generate
ENV NODE_ENV=production
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD curl -fsS http://127.0.0.1:3000/health || exit 1
CMD ["bun", "run", "apps/scheduled-jobs/src/index.ts"]
