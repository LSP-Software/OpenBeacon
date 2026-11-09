import { tryCatch } from "@openbeacon/shared";
import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthEndpoint, getIP } from "better-auth/api";
import { z } from "zod";
import { type EmailCodes, normalizeEmail } from "./emailCode.ts";

export const emailCodePlugin = (codes: EmailCodes | null) =>
  ({
    id: "email-code",
    endpoints: {
      requestSignUpCode: createAuthEndpoint(
        "/email-code/request-sign-up-code",
        { method: "POST", body: z.object({ email: z.email() }) },
        async (ctx) => {
          if (!codes) throw new APIError("NOT_FOUND");
          await sendInBackground({
            codes,
            ctx,
            description: "a sign-up code",
            send: async (email) => {
              const user = await ctx.context.internalAdapter.findUserByEmail(email, {
                includeAccounts: true,
              });
              if (!user) {
                await codes.send({ purpose: "sign-up", subject: email, to: email });
                return;
              }
              await codes.sendAccountExists({
                to: user.user.email,
                userId: user.user.id,
                hasPassword: hasPassword(user),
              });
            },
          });
          return ctx.json({ success: true });
        },
      ),
      verifySignUpCode: createAuthEndpoint(
        "/email-code/verify-sign-up-code",
        { method: "POST", body: z.object({ email: z.email(), code: z.string() }) },
        async (ctx) => {
          if (!codes) throw new APIError("NOT_FOUND");
          const email = normalizeEmail(ctx.body.email);
          const result = await codes.check({
            purpose: "sign-up",
            subject: email,
            code: ctx.body.code,
          });
          if (!result.valid) throw invalidCode();
          return ctx.json({
            signUpToken: await codes.issueToken({ purpose: "sign-up", value: email }),
          });
        },
      ),
      requestEmailVerification: createAuthEndpoint(
        "/email-code/request-email-verification",
        {
          method: "POST",
          body: z.object({ email: z.email(), password: z.string().min(1) }),
        },
        async (ctx) => {
          if (!codes) throw new APIError("NOT_FOUND");
          await sendInBackground({
            codes,
            ctx,
            description: "an email verification code",
            send: async (email) => {
              const user = await ctx.context.internalAdapter.findUserByEmail(email, {
                includeAccounts: true,
              });
              const hash = user?.accounts.find(
                (account) => account.providerId === "credential",
              )?.password;
              if (
                !user ||
                !hash ||
                user.user.emailVerified ||
                ctx.body.password.length > ctx.context.password.config.maxPasswordLength ||
                !(await ctx.context.password.verify({ hash, password: ctx.body.password }))
              ) {
                return;
              }
              await codes.send({
                purpose: "email-verification",
                subject: email,
                to: user.user.email,
                userId: user.user.id,
              });
            },
          });
          return ctx.json({ success: true });
        },
      ),
      verifyEmail: createAuthEndpoint(
        "/email-code/verify-email",
        { method: "POST", body: z.object({ email: z.email(), code: z.string() }) },
        async (ctx) => {
          if (!codes) throw new APIError("NOT_FOUND");
          const email = normalizeEmail(ctx.body.email);
          const result = await codes.check({
            purpose: "email-verification",
            subject: email,
            code: ctx.body.code,
          });
          const user = result.valid
            ? await ctx.context.internalAdapter.findUserByEmail(email)
            : null;
          if (!user) throw invalidCode();
          await ctx.context.internalAdapter.updateUser(user.user.id, { emailVerified: true });
          return ctx.json({ success: true });
        },
      ),
      requestPasswordResetCode: createAuthEndpoint(
        "/email-code/request-password-reset",
        { method: "POST", body: z.object({ email: z.email() }) },
        async (ctx) => {
          if (!codes) throw new APIError("NOT_FOUND");
          await sendInBackground({
            codes,
            ctx,
            description: "a password reset code",
            send: async (email) => {
              const user = await ctx.context.internalAdapter.findUserByEmail(email, {
                includeAccounts: true,
              });
              if (!hasPassword(user)) return;
              await codes.send({
                purpose: "password-reset",
                subject: email,
                to: user.user.email,
                userId: user.user.id,
              });
            },
          });
          return ctx.json({ success: true });
        },
      ),
      verifyPasswordResetCode: createAuthEndpoint(
        "/email-code/verify-password-reset-code",
        { method: "POST", body: z.object({ email: z.email(), code: z.string() }) },
        async (ctx) => {
          if (!codes) throw new APIError("NOT_FOUND");
          const email = normalizeEmail(ctx.body.email);
          const result = await codes.check({
            purpose: "password-reset",
            subject: email,
            code: ctx.body.code,
          });
          const user = result.valid
            ? await ctx.context.internalAdapter.findUserByEmail(email, {
                includeAccounts: true,
              })
            : null;
          if (!hasPassword(user)) throw invalidCode();
          await ctx.context.internalAdapter.updateUser(user.user.id, { emailVerified: true });
          return ctx.json({
            resetToken: await codes.issueToken({ purpose: "password-reset", value: user.user.id }),
          });
        },
      ),
    },
  }) satisfies BetterAuthPlugin;

const sendInBackground = async ({
  codes,
  ctx,
  description,
  send,
}: {
  codes: EmailCodes;
  ctx: {
    body: { email: string };
    request?: Request | undefined;
    headers?: Headers | undefined;
    context: {
      options: Parameters<typeof getIP>[1];
      runInBackground: (task: Promise<unknown>) => void;
    };
  };
  description: string;
  send: (email: string) => Promise<void>;
}) => {
  const email = normalizeEmail(ctx.body.email);
  const source = ctx.request ?? ctx.headers;
  const allowed = await codes.allowRequest({
    email,
    ip: source ? getIP(source, ctx.context.options) : null,
  });
  if (!allowed) {
    throw new APIError("TOO_MANY_REQUESTS", {
      message: "Too many requests. Please try again later.",
    });
  }
  ctx.context.runInBackground(
    tryCatch(send(email)).then((result) => {
      if (result.error) console.error(`[email-code] could not send ${description}`);
    }),
  );
};

const invalidCode = () =>
  new APIError("BAD_REQUEST", {
    message: "The code is wrong or has expired",
    code: "INVALID_CODE",
  });

const hasPassword = <User extends { accounts: { providerId: string }[] }>(
  user: User | null,
): user is User => user?.accounts.some((account) => account.providerId === "credential") ?? false;
