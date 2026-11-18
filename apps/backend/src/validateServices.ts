import { checkImageStorage } from "@openbeacon/api/checkStorage.ts";
import { checkMapStorage } from "@openbeacon/api/mapStorage.ts";
import { fcm } from "@openbeacon/auth";
import { checkEmail, emailEnabled, emailUnreachableCode } from "@openbeacon/email";
import { errorCode } from "@openbeacon/shared";
import { pingRedis } from "@openbeacon/cache";
import { cache } from "./cache.ts";
import { checkOptionalServices } from "./checkOptionalServices.ts";
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
});

await checkOptionalServices({
  ...(emailEnabled
    ? {
        Email: {
          check: checkEmail,
          isUnreachable: (error) => errorCode(error) === emailUnreachableCode,
        },
      }
    : {}),
  ...(fcm
    ? {
        "Push (FCM)": {
          check: fcm.getAccessToken,
          isUnreachable: (error) =>
            /^FCM_AUTH_(UNREACHABLE|429|5\d\d)$/.test(errorCode(error) ?? ""),
        },
      }
    : {}),
});
