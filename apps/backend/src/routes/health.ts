import type { OpenBeaconCache } from "@openbeacon/cache";
import type { PrismaClient } from "@openbeacon/database";
import { apiCompatibilityLevel, minClientApiCompatibilityLevel } from "@openbeacon/shared";
import { Hono } from "hono";
import { currentAnnouncements } from "../announcements.ts";
import { env } from "../env.ts";
import { serverVersion } from "../version.ts";

const router = new Hono<{
  Bindings: { cache: Pick<OpenBeaconCache, "ping">; db: Pick<PrismaClient, "$queryRaw"> };
}>();

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

router.get("/ready", async (context) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const [redis, database] = await Promise.all([
    context.env.cache.ping(),
    Promise.race([
      Promise.resolve(context.env.db.$queryRaw`SELECT 1`).then(
        () => true,
        () => false,
      ),
      new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), 2_000);
      }),
    ]),
  ]);
  clearTimeout(timer);
  if (redis && database) return context.json({ status: "ready" });
  return context.json(
    {
      status: "unavailable",
      ...(redis ? {} : { redis: "unreachable" }),
      ...(database ? {} : { database: "unreachable" }),
    },
    503,
  );
});

export default router;
