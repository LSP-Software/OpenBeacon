import { OpenBeaconCache, redisUrlSchema } from "@openbeacon/cache";
import {
  emailEnabled,
  sendAccountExistsEmail,
  sendCodeEmail,
  sendGoogleSignInEmail,
  sendSecurityAlertEmail,
} from "@openbeacon/email";
import { getAuthCapabilities } from "./capabilities.ts";
import { createAuth } from "./createAuth.ts";
import { db } from "./db.ts";
import { createEmailCodes } from "./emailCode.ts";
import { env } from "./env.ts";
import { getPublicUrl } from "./publicUrl.ts";
import { createSecurityAlerts } from "./securityAlerts.ts";

export { clientIpHeader } from "./createAuth.ts";
export { createEmailCodes, type EmailCodes } from "./emailCode.ts";
export { createSecurityAlerts, type SecurityAlerts } from "./securityAlerts.ts";
export { createGoogleDeletionAuthorization, verifyGoogleDeletionCode } from "./googleDeletion.ts";

export const authPublicPath = getPublicUrl(env.BETTER_AUTH_URL).path;

export const authCapabilities = getAuthCapabilities({
  GOOGLE_CLIENT_ID: env.GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET: env.GOOGLE_CLIENT_SECRET,
  emailEnabled,
});

const cache = emailEnabled
  ? new OpenBeaconCache({
      redisUrl: redisUrlSchema.parse(process.env["REDIS_URL"]),
      hashSecret: env.REDIS_HASH_SECRET,
    })
  : null;

export const emailCodes = cache
  ? createEmailCodes({
      db,
      secret: env.BETTER_AUTH_SECRET,
      rateLimits: cache.rateLimits,
      limitRequestsPerIp: env.EMAIL_CODE_IP_LIMIT,
      sendCodeEmail,
      sendAccountExistsEmail,
      sendGoogleSignInEmail,
    })
  : null;

export const securityAlerts = cache
  ? createSecurityAlerts({ db, sendSecurityAlertEmail, alertsTurnedOff: cache.alertsTurnedOff })
  : null;

export const auth = createAuth({ emailCodes, securityAlerts });

export type AuthType = {
  user: typeof auth.$Infer.Session.user | null;
  session: typeof auth.$Infer.Session.session | null;
};
