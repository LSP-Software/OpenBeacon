FROM oven/bun:1.4.4 AS build
WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile --production --ignore-scripts --filter @openbeacon/map-tiles-cli

FROM oven/bun:1.4.4
WORKDIR /app
RUN mkdir /state && chown bun:bun /state
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/map-tiles ./apps/map-tiles
COPY --from=build /app/packages/map-tiles ./packages/map-tiles
COPY --from=build /app/packages/shared ./packages/shared
USER bun
ENV NODE_ENV=production
ENV MAP_TILES_STATE_DIR=/state
VOLUME /state
ENTRYPOINT ["bun", "apps/map-tiles/src/index.ts"]
