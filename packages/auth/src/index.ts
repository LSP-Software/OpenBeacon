import { OpenBeaconCache, redisUrlSchema } from "@openbeacon/cache";
import {
  emailEnabled,
  sendAccountExistsEmail,
  sendCodeEmail,
  sendSecurityAlertEmail,
} from "@openbeacon/email";
import { getAuthCapabilities } from "./capabilities.ts";
import { createAuth } from "./createAuth.ts";
import { db } from "./db.ts";
import { createEmailCodes } from "./emailCode.ts";
import { env } from "./env.ts";
import { createSecurityAlerts } from "./securityAlerts.ts";

export { clientIpHeader } from "./createAuth.ts";
export { createEmailCodes, type EmailCodes } from "./emailCode.ts";
export { createSecurityAlerts, type SecurityAlerts } from "./securityAlerts.ts";
export { createGoogleDeletionAuthorization, verifyGoogleDeletionCode } from "./googleDeletion.ts";

export const authCapabilities = getAuthCapabilities({
  GOOGLE_CLIENT_ID: env.GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET: env.GOOGLE_CLIENT_SECRET,
  emailEnabled,
});

export const emailCodes = emailEnabled
  ? createEmailCodes({
      db,
      secret: env.BETTER_AUTH_SECRET,
      rateLimits: new OpenBeaconCache({
        redisUrl: redisUrlSchema.parse(process.env["REDIS_URL"]),
      }).rateLimits,
      sendCodeEmail,
      sendAccountExistsEmail,
    })
  : null;

export const securityAlerts = emailEnabled
  ? createSecurityAlerts({ db, sendSecurityAlertEmail })
  : null;

export const auth = createAuth({ emailCodes, securityAlerts });

export type AuthType = {
  user: typeof auth.$Infer.Session.user | null;
  session: typeof auth.$Infer.Session.session | null;
};
