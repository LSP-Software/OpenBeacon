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

export const passwordFailureLimitFor = (email: string) => ({
  ...passwordFailureLimit,
  identifier: { type: "email" as const, value: normalizeEmail(email) },
});

const takePasswordAttempt = async (rateLimits: PasswordAttemptLimits, email: string) => {
  const result = await rateLimits.consume(passwordFailureLimitFor(email), {
    whenUnavailable: "deny",
  });
  return result.unavailable ? "unavailable" : result.allowed ? "allowed" : "locked";
};

const giveBackPasswordAttempt = async (rateLimits: PasswordAttemptLimits, email: string) => {
  const refunded = await tryCatch(rateLimits.refund(passwordFailureLimitFor(email)));
  if (refunded.error) console.error("[password-attempts] could not give back a password attempt");
};

export const reservePasswordAttempt = async (rateLimits: PasswordAttemptLimits, email: string) => {
  const attempt = await takePasswordAttempt(rateLimits, email);
  if (attempt === "unavailable") {
    throw new APIError("SERVICE_UNAVAILABLE", {
      message: "Passwords can't be checked right now. Try again shortly.",
      code: "PASSWORD_CHECK_UNAVAILABLE",
    });
  }
  if (attempt === "locked") {
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
  await giveBackPasswordAttempt(rateLimits, email);
};

export const checkPasswordWithinLimit = async ({
  rateLimits,
  email,
  check,
}: {
  rateLimits: PasswordAttemptLimits;
  email: string;
  check: () => Promise<boolean>;
}): Promise<"correct" | "incorrect" | "locked" | "unavailable"> => {
  const attempt = await takePasswordAttempt(rateLimits, email);
  if (attempt !== "allowed") return attempt;
  const correct = await tryCatch(check());
  if (correct.error || correct.data) await giveBackPasswordAttempt(rateLimits, email);
  if (correct.error) throw correct.error;
  return correct.data ? "correct" : "incorrect";
};
