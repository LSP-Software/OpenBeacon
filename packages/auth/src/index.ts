import { sharedCache } from "@openbeacon/cache";
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
import { createFcmClient, resolveFcmSettings } from "./fcm.ts";
import { getPublicUrl } from "./publicUrl.ts";
import { createPushSender } from "./push.ts";
import { createSecurityAlerts } from "./securityAlerts.ts";

export { clientIpHeader } from "./createAuth.ts";
export { createEmailCodes, type EmailCodes } from "./emailCode.ts";
export { createSecurityAlerts, type SecurityAlerts } from "./securityAlerts.ts";
export { createPushSender, type PushSender } from "./push.ts";
export { checkPasswordWithinLimit, passwordFailureLimitFor } from "./passwordAttempts.ts";
export { createGoogleDeletionAuthorization, verifyGoogleDeletionCode } from "./googleDeletion.ts";

export const authPublicPath = getPublicUrl(env.BETTER_AUTH_URL).path;

export const authCapabilities = getAuthCapabilities({
  GOOGLE_CLIENT_ID: env.GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET: env.GOOGLE_CLIENT_SECRET,
  emailEnabled,
});

const cache = emailEnabled ? sharedCache() : null;

export const emailCodes = cache
  ? createEmailCodes({
      db,
      secret: env.BETTER_AUTH_SECRET,
      rateLimits: cache.rateLimits,
      sendCodeEmail,
      sendAccountExistsEmail,
      sendGoogleSignInEmail,
    })
  : null;

const { settings: fcmSettings } = resolveFcmSettings({
  FCM_PROJECT_ID: env.FCM_PROJECT_ID,
  FCM_CLIENT_EMAIL: env.FCM_CLIENT_EMAIL,
  FCM_PRIVATE_KEY: env.FCM_PRIVATE_KEY,
});

export const fcm = fcmSettings ? createFcmClient(fcmSettings) : null;

export const push = createPushSender({ db, fcm });

export const securityAlerts = createSecurityAlerts({
  db,
  push,
  sendSecurityAlertEmail: emailEnabled ? sendSecurityAlertEmail : null,
  alertsTurnedOff: {
    add: async (input) => sharedCache().alertsTurnedOff.add(input),
    take: async (input) => sharedCache().alertsTurnedOff.take(input),
    pending: async () => sharedCache().alertsTurnedOff.pending(),
  },
});

export const auth = createAuth({
  emailCodes,
  securityAlerts,
  rateLimits: {
    consume: (input, options) => sharedCache().rateLimits.consume(input, options),
    refund: (input) => sharedCache().rateLimits.refund(input),
  },
});

export type AuthType = {
  user: typeof auth.$Infer.Session.user | null;
  session: typeof auth.$Infer.Session.session | null;
};
