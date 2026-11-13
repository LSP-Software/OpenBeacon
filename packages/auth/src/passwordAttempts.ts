import type { OpenBeaconCache } from "@openbeacon/cache";
import { tryCatch } from "@openbeacon/shared";
import { APIError, isAPIError } from "better-auth/api";
import { normalizeEmail } from "./emailCode.ts";

export const passwordFailureLimit = {
  namespace: "auth.passwordFailure",
  limit: 10,
  windowMs: 15 * 60 * 1000,
};

export type PasswordAttemptLimits = Pick<OpenBeaconCache["rateLimits"], "consume" | "refund">;

const limitFor = (email: string) => ({
  ...passwordFailureLimit,
  identifier: { type: "email" as const, value: normalizeEmail(email) },
});

export const reservePasswordAttempt = async (rateLimits: PasswordAttemptLimits, email: string) => {
  const result = await rateLimits.consume(limitFor(email), { whenUnavailable: "deny" });
  if (result.unavailable) {
    throw new APIError("SERVICE_UNAVAILABLE", {
      message: "Passwords can't be checked right now. Try again shortly.",
      code: "PASSWORD_CHECK_UNAVAILABLE",
    });
  }
  if (!result.allowed) {
    throw new APIError("TOO_MANY_REQUESTS", {
      message: "Too many attempts. Try again in 15 minutes.",
      code: "TOO_MANY_PASSWORD_ATTEMPTS",
    });
  }
};

export const settlePasswordAttempt = async (
  rateLimits: PasswordAttemptLimits,
  email: string,
  returned: unknown,
) => {
  const code = isAPIError(returned) ? returned.body?.code : undefined;
  if (code === "INVALID_EMAIL_OR_PASSWORD" || code === "INVALID_PASSWORD") return;
  const refunded = await tryCatch(rateLimits.refund(limitFor(email)));
  if (refunded.error) console.error("[password-attempts] could not give back a password attempt");
};
