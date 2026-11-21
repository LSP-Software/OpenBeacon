import { checkImageStorage } from "@openbeacon/api/checkStorage.ts";
import { checkMapStorage } from "@openbeacon/api/mapStorage.ts";
import { checkGoogleSignIn, fcm } from "@openbeacon/auth";
import { checkEmail, emailEnabled, emailUnreachableCode } from "@openbeacon/email";
import { checkServices, errorCode } from "@openbeacon/shared";
import { pingRedis } from "@openbeacon/cache";
import { cache } from "./cache.ts";
import { checkOptionalServices } from "./checkOptionalServices.ts";
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

if (checkGoogleSignIn) {
  const google = await checkGoogleSignIn();
  if (google.status === "valid") console.log("  Google sign-in: valid");
  else if (google.status === "rejected")
    console.error(
      `  Google sign-in: Google rejected GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (${google.detail}). Set them to the client ID and secret of the same "Web application" OAuth client, the one the app was built with. Starting anyway, but Google sign-in and deleting Google accounts won't work until this is fixed.`,
    );
  else
    console.warn(
      `  Google sign-in: couldn't check the OAuth client with Google (${google.detail}), starting anyway`,
    );
}
