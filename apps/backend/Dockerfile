FROM oven/bun:1.3.10 AS base
WORKDIR /app

COPY package.json bun.lock turbo.json ./
COPY apps/backend/package.json ./apps/backend/
COPY apps/mobile/package.json ./apps/mobile/
COPY packages/api/package.json ./packages/api/
COPY packages/auth/package.json ./packages/auth/
COPY packages/database/package.json ./packages/database/
COPY packages/shared/package.json ./packages/shared/
COPY packages/tsconfig/package.json ./packages/tsconfig/

FROM base AS prod-deps
RUN bun install --frozen-lockfile --production

FROM base AS build
RUN bun install --frozen-lockfile
COPY . .
RUN cd packages/database && bunx prisma generate

FROM oven/bun:1.3.10 AS runner
WORKDIR /app

RUN groupadd --system --gid 1001 app && useradd --system --uid 1001 --gid app app

COPY --from=build --chown=app:app /app/package.json /app/bun.lock /app/turbo.json ./
COPY --from=build --chown=app:app /app/apps/backend ./apps/backend
COPY --from=build --chown=app:app /app/packages ./packages
COPY --from=prod-deps --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=prod-deps --chown=app:app /app/apps/backend/node_modules ./apps/backend/node_modules
COPY --from=prod-deps --chown=app:app /app/packages/database/node_modules ./packages/database/node_modules
COPY --from=build --chown=app:app /app/packages/database/node_modules/.prisma ./packages/database/node_modules/.prisma

USER app
EXPOSE 3000
CMD ["bun", "run", "apps/backend/src/index.ts"]
