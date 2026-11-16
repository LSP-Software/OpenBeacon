import type { OpenBeaconCache } from "@openbeacon/cache";
import { apiCompatibilityLevel, minClientApiCompatibilityLevel } from "@openbeacon/shared";
import { Hono } from "hono";
import { currentAnnouncements } from "../announcements.ts";
import { env } from "../env.ts";
import { serverVersion } from "../version.ts";

const router = new Hono<{ Bindings: { cache: Pick<OpenBeaconCache, "ping"> } }>();

router.get("/health", (context) => {
  const announcements = currentAnnouncements();
  return context.json({
    status: "ok",
    version: serverVersion,
    serverName: env.SERVER_NAME,
    apiCompatibilityLevel,
    minClientApiCompatibilityLevel,
    message: env.CLIENT_UPDATE_MESSAGE,
    ...(announcements.length > 0 ? { announcements } : {}),
  });
});

router.get("/ready", async (context) =>
  (await context.env.cache.ping())
    ? context.json({ status: "ready" })
    : context.json({ status: "unavailable", redis: "unreachable" }, 503),
);

export default router;
