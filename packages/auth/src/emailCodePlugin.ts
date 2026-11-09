import { randomUUID } from "node:crypto";
import { tryCatch } from "@openbeacon/shared";
import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthEndpoint, getIP, resetPassword } from "better-auth/api";
import { z } from "zod";
import type { EmailCodes } from "./emailCode.ts";

export const emailCodePlugin = (codes: EmailCodes | null) =>
  ({
    id: "email-code",
    endpoints: {
      requestPasswordResetCode: createAuthEndpoint(
        "/email-code/request-password-reset",
        { method: "POST", body: z.object({ email: z.email() }) },
        async (ctx) => {
          if (!codes) throw new APIError("NOT_FOUND");
          const email = ctx.body.email.trim().toLowerCase();
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
          const send = async () => {
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
          };
          ctx.context.runInBackground(
            tryCatch(send()).then((result) => {
              if (result.error) console.error("[email-code] could not send a password reset code");
            }),
          );
          return ctx.json({ success: true });
        },
      ),
      resetPasswordWithCode: createAuthEndpoint(
        "/email-code/reset-password",
        {
          method: "POST",
          body: z.object({
            email: z.email(),
            code: z.string(),
            newPassword: z.string(),
          }),
        },
        async (ctx) => {
          if (!codes) throw new APIError("NOT_FOUND");
          const { minPasswordLength, maxPasswordLength } = ctx.context.password.config;
          if (ctx.body.newPassword.length < minPasswordLength) {
            throw new APIError("BAD_REQUEST", {
              message: "Password too short",
              code: "PASSWORD_TOO_SHORT",
            });
          }
          if (ctx.body.newPassword.length > maxPasswordLength) {
            throw new APIError("BAD_REQUEST", {
              message: "Password too long",
              code: "PASSWORD_TOO_LONG",
            });
          }
          const email = ctx.body.email.trim().toLowerCase();
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
          if (!hasPassword(user)) {
            throw new APIError("BAD_REQUEST", {
              message: "The code is wrong or has expired",
              code: "INVALID_CODE",
            });
          }
          const token = randomUUID();
          await ctx.context.internalAdapter.createVerificationValue({
            identifier: `reset-password:${token}`,
            value: user.user.id,
            expiresAt: new Date(Date.now() + 60 * 1000),
          });
          return resetPassword({
            ...ctx,
            params: {},
            body: { token, newPassword: ctx.body.newPassword },
            query: undefined,
          });
        },
      ),
    },
  }) satisfies BetterAuthPlugin;

const hasPassword = <User extends { accounts: { providerId: string }[] }>(
  user: User | null,
): user is User => user?.accounts.some((account) => account.providerId === "credential") ?? false;
