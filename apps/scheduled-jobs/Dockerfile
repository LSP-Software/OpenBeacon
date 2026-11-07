FROM oven/bun:1.4.4
WORKDIR /app
RUN chown bun:bun /app
USER bun
COPY --chown=bun:bun . .
RUN bun install --frozen-lockfile
RUN DATABASE_URL=postgresql://localhost:5432/openbeacon bun run --cwd packages/database prisma generate
ENV NODE_ENV=production
CMD ["bun", "run", "apps/scheduled-jobs/src/index.ts"]
