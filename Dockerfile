FROM oven/bun:canary

WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile
RUN DATABASE_URL=postgresql://localhost:5432/openbeacon bun run --cwd packages/database prisma generate

ENV NODE_ENV=production
EXPOSE 3000
CMD ["sh", "-c", "bun run apps/backend/src/validateEnv.ts && bun run --cwd packages/database prisma migrate deploy && exec bun run apps/backend/src/index.ts"]
