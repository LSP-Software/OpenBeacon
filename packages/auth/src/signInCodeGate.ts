import type { PrismaClient } from "@openbeacon/database";
import { signInCodeHeader, signInTokenHeader, tryCatch } from "@openbeacon/shared";
import { APIError, getAuthoritativeSessionFromCtx } from "better-auth/api";
import type { EmailCodes } from "./emailCode.ts";

export const checkSignInCode = async ({
  db,
  emailCodes,
  userId,
  context,
  runInBackground,
}: {
  db: Pick<PrismaClient, "user" | "session">;
  emailCodes: EmailCodes | null;
  userId: string;
  context: Parameters<typeof getAuthoritativeSessionFromCtx>[0];
  runInBackground: (task: Promise<unknown>) => void;
}) => {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { email: true, signInCodes: true },
  });
  if (!user?.signInCodes) return;

  const current = await tryCatch(getAuthoritativeSessionFromCtx(context));
  if (current.data?.user.id === userId) {
    const linked = await db.session.findUnique({
      where: { id: current.data.session.id },
      select: { device: { select: { activatedAt: true, revokedAt: true } } },
    });
    if (linked?.device?.activatedAt && !linked.device.revokedAt) return;
  }

  if (!emailCodes) {
    throw new APIError("FORBIDDEN", {
      message:
        "This server can't email you a sign-in code right now. Ask whoever runs your OpenBeacon server to turn off sign-in codes for your account.",
      code: "SIGN_IN_CODES_UNAVAILABLE",
    });
  }

  const signInToken = context.headers?.get(signInTokenHeader);
  if (
    signInToken &&
    (await emailCodes.consumeToken({ purpose: "sign-in", token: signInToken, value: userId }))
  ) {
    return;
  }

  const code = context.headers?.get(signInCodeHeader);
  if (code) {
    const checked = await emailCodes.check({ purpose: "sign-in", subject: user.email, code });
    if (checked.valid) return;
    throw new APIError("BAD_REQUEST", {
      message: "The code is wrong or has expired",
      code: "INVALID_CODE",
    });
  }

  const allowed = await emailCodes.allowRequest({ purpose: "sign-in", email: user.email });
  if (allowed === "unavailable") {
    throw new APIError("TOO_MANY_REQUESTS", {
      message: "Codes can't be sent right now. Try again in a minute.",
    });
  }
  if (allowed === "allowed") {
    runInBackground(
      tryCatch(
        emailCodes.send({ purpose: "sign-in", subject: user.email, to: user.email, userId }),
      ).then((result) => {
        if (result.error) console.error("[email-code] could not send a sign-in email");
      }),
    );
  }
  throw new APIError("FORBIDDEN", {
    message: "Enter the code we emailed you to finish signing in.",
    code: "SIGN_IN_CODE_REQUIRED",
    codeSent: allowed === "allowed",
  });
};
