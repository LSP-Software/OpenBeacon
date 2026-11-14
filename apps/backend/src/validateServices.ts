import { checkMapStorage, checkImageStorage } from "@openbeacon/api/checkStorage.ts";
import { checkEmail, emailEnabled } from "@openbeacon/email";
import { pingRedis } from "@openbeacon/cache";
import { cache } from "./cache.ts";
import { checkServices } from "./checkServices.ts";
import { db } from "./db.ts";
import { env } from "./env.ts";

await checkServices({
  PostgreSQL: () => db.$queryRaw`SELECT 1`,
  Redis: async () => {
    await pingRedis(env.REDIS_URL);
    const { missing, keyPattern } = await cache.findMissingPermissions();
    if (!missing.length) return;
    const user = decodeURIComponent(new URL(env.REDIS_URL).username) || "default";
    const grants = missing.map((command) => `+${command.toLowerCase()}`).join(" ");
    console.error(
      `  Redis: the Redis user can't run ${missing.join(", ")} on keys matching ${keyPattern}. Grant them with: ACL SETUSER ${user} ~${keyPattern} ${grants}`,
    );
    throw Object.assign(new Error("Redis permissions are missing"), { code: "NOPERM" });
  },
  "Image storage": checkImageStorage,
  "Map storage": checkMapStorage,
  ...(emailEnabled ? { Email: checkEmail } : {}),
});
