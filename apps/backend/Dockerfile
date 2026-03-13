FROM oven/bun:1.3.10 AS base
WORKDIR /app

FROM base AS deps
COPY package.json bun.lock ./
COPY apps/backend/package.json ./apps/backend/
COPY apps/mobile/package.json ./apps/mobile/
COPY packages/api/package.json ./packages/api/
COPY packages/auth/package.json ./packages/auth/
COPY packages/database/package.json ./packages/database/
COPY packages/shared/package.json ./packages/shared/
COPY packages/tsconfig/package.json ./packages/tsconfig/
RUN bun install --frozen-lockfile

FROM deps AS builder
COPY . .
RUN cd packages/database && bunx prisma generate

FROM oven/bun:1.3.10 AS runner
WORKDIR /app
COPY --from=builder /app .

EXPOSE 3000
CMD ["bun", "run", "apps/backend/src/index.ts"]
