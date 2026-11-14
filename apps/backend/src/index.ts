import "./validateEnv.ts";
import "./validateServices.ts";
import { env as apiEnv } from "@openbeacon/api/env.ts";
import { getMapTilesManifest } from "@openbeacon/api/mapStorage.ts";
import { securityAlerts } from "@openbeacon/auth";
import { tryCatch } from "@openbeacon/shared";
import { app } from "./app.ts";
import { cache } from "./cache.ts";
import { db } from "./db.ts";
import { env } from "./env.ts";
import { findHttpsWarnings } from "./findHttpsWarnings.ts";
import { authenticateCloudflare, resolveClientIp } from "./helpers/clientIp.ts";

for (const warning of findHttpsWarnings({
  BETTER_AUTH_URL: env.BETTER_AUTH_URL,
  IMAGES_S3_ENDPOINT: apiEnv.IMAGES_S3_ENDPOINT,
  IMAGES_S3_PUBLIC_ENDPOINT: apiEnv.IMAGES_S3_PUBLIC_ENDPOINT,
  IMAGES_S3_CDN_URL: apiEnv.IMAGES_S3_CDN_URL,
  MAP_S3_ENDPOINT: apiEnv.MAP_S3_ENDPOINT,
  MAP_S3_PUBLIC_ENDPOINT: apiEnv.MAP_S3_PUBLIC_ENDPOINT,
})) {
  console.warn(warning);
}

if (securityAlerts) {
  securityAlerts.schedulePendingAlertsTurnedOff();
  setInterval(securityAlerts.schedulePendingAlertsTurnedOff, 60_000);
}

const watchForFirstMap = async (waiting: boolean) => {
  const manifest = await tryCatch(getMapTilesManifest());

  if (manifest.data) {
    if (waiting) {
      console.log("The map tiles service has published the first map; maps are now available");
    }
    return;
  }

  if (manifest.error) {
    console.error(`Could not read the map from map storage: ${manifest.error.message}`);
  } else {
    console.warn(
      "There is no map in map storage yet, so the app shows that the map isn't ready. Check the map tiles container logs or run `map-tiles status` in it to follow the first download.",
    );
  }
  setTimeout(() => void watchForFirstMap(true), 5 * 60_000);
};

void watchForFirstMap(false);

export default {
  fetch(request: Request, server: Bun.Server<unknown>) {
    if (
      env.TRUSTED_PROXY_PROVIDER === "cloudflare-authenticated" &&
      !(
        request.method === "GET" && ["/health", "/ready"].includes(new URL(request.url).pathname)
      ) &&
      !authenticateCloudflare({
        headers: request.headers,
        secret: env.CLOUDFLARE_ORIGIN_SECRET ?? "",
      })
    ) {
      return new Response("Forbidden", { status: 403 });
    }

    const clientIp = resolveClientIp({
      headers: request.headers,
      requestIp: server.requestIP(request)?.address ?? null,
      trustedProxyProvider: env.TRUSTED_PROXY_PROVIDER,
    });

    return app.fetch(request, {
      cache,
      db,
      ...(clientIp ? { clientIp } : {}),
    });
  },
  port: env.OPENBEACON_API_PORT,
  hostname: env.OPENBEACON_API_HOSTNAME,
  // Bun drops a connection that sends nothing for 10 seconds by default, and Android's OkHttp
  // then silently resends the request. Stay above the app's longest request timeout (30 seconds).
  idleTimeout: 60,
  maxRequestBodySize: 8 * 1024 * 1024,
};
