import { expo } from "@better-auth/expo";
import { Prisma } from "@openbeacon/database";
import { accountNameSchema } from "@openbeacon/schemas";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError, createAuthMiddleware, isAPIError } from "better-auth/api";
import { db } from "./db.ts";
import { type EmailCodes, normalizeEmail } from "./emailCode.ts";
import { emailCodePlugin } from "./emailCodePlugin.ts";
import { env } from "./env.ts";
import type { SecurityAlerts } from "./securityAlerts.ts";

export const clientIpHeader = "x-openbeacon-client-ip";

export const createAuth = ({
  emailCodes,
  securityAlerts,
  runInBackground,
}: {
  emailCodes: EmailCodes | null;
  securityAlerts: SecurityAlerts | null;
  runInBackground?: (task: Promise<unknown>) => void;
}) =>
  betterAuth({
    plugins: [expo(), emailCodePlugin(emailCodes)],
    disabledPaths: [
      "/send-verification-email",
      "/verify-email",
      "/request-password-reset",
      ...(emailCodes ? [] : ["/reset-password"]),
      "/change-email",
      "/update-user",
      "/revoke-other-sessions",
      "/revoke-sessions",
      "/list-sessions",
      "/delete-user",
      "/delete-user/callback",
    ],
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path === "/reset-password/:token") throw new APIError("NOT_FOUND");
        if (ctx.path === "/sign-up/email" && emailCodes) {
          const { email, signUpToken } = ctx.body ?? {};
          const verified =
            typeof email === "string" &&
            typeof signUpToken === "string" &&
            (await emailCodes.hasToken({
              purpose: "sign-up",
              token: signUpToken,
              value: normalizeEmail(email),
            }));
          if (!verified) throw invalidSignUpToken();
        }
      }),
      after: createAuthMiddleware(async (ctx) => {
        const userId = ctx.context.session?.user.id;
        if (ctx.path === "/change-password" && userId && !isAPIError(ctx.context.returned)) {
          securityAlerts?.send(userId, { type: "password-changed" });
        }
      }),
    },
    advanced: {
      ipAddress: { ipAddressHeaders: [clientIpHeader] },
      ...(runInBackground ? { backgroundTasks: { handler: runInBackground } } : {}),
    },
    databaseHooks: {
      account: {
        create: {
          before: async (account, context) => {
            if (account.providerId === "credential" && context?.path !== "/sign-up/email") {
              throw new APIError("BAD_REQUEST", {
                message: "Passwords can only be added when signing up",
                code: "PASSWORD_NOT_ALLOWED",
              });
            }
          },
        },
      },
      session: {
        create: {
          after: async (session) => {
            const expired = await db.$transaction(async (tx) => {
              await tx.$queryRaw(
                Prisma.sql`SELECT id FROM "User" WHERE id = ${session.userId} FOR UPDATE`,
              );
              const [user] = await tx.$queryRaw<
                Array<{ pendingDeletion: boolean; deletionExpired: boolean }>
              >(
                Prisma.sql`SELECT "pendingDeletion", ("deletionDate" IS NULL OR "deletionDate" <= (clock_timestamp() AT TIME ZONE 'UTC')) AS "deletionExpired" FROM "User" WHERE id = ${session.userId}`,
              );
              const activeSession = await tx.session.findUnique({
                where: { id: session.id },
                select: { id: true },
              });
              if (!user || !activeSession)
                throw new APIError("UNAUTHORIZED", {
                  message: "Session is no longer valid.",
                });
              if (user.pendingDeletion && user.deletionExpired) {
                await tx.session.deleteMany({ where: { id: session.id } });
                return true;
              }
              if (user.pendingDeletion) {
                await tx.user.update({
                  where: { id: session.userId },
                  data: {
                    pendingDeletion: false,
                    deletionDate: null,
                    deletionRetryAt: null,
                    deletionCancellationPending: true,
                  },
                });
              }
              return false;
            });
            if (expired)
              throw new APIError("FORBIDDEN", {
                message: "This account is scheduled for deletion and can no longer be accessed.",
              });
          },
        },
      },
      user: {
        create: {
          before: async (user, context) => {
            const result = accountNameSchema.safeParse(user.name);
            if (!result.success)
              throw new APIError("BAD_REQUEST", {
                message: result.error.issues[0]?.message ?? "Invalid name",
              });
            if (context?.path !== "/sign-up/email" || !emailCodes) {
              return { data: { ...user, name: result.data } };
            }
            const signUpToken: unknown = context.body?.signUpToken;
            const consumed =
              typeof signUpToken === "string" &&
              (await emailCodes.consumeToken({
                purpose: "sign-up",
                token: signUpToken,
                value: normalizeEmail(user.email),
              }));
            if (!consumed) throw invalidSignUpToken();
            return { data: { ...user, name: result.data, emailVerified: true } };
          },
        },
        update: {
          before: async (user) => {
            if (user.name === undefined) return { data: user };
            const result = accountNameSchema.safeParse(user.name);
            if (!result.success)
              throw new APIError("BAD_REQUEST", {
                message: result.error.issues[0]?.message ?? "Invalid name",
              });
            return { data: { ...user, name: result.data } };
          },
        },
      },
    },
    session: { freshAge: 30 * 60 },
    verification: {
      storeIdentifier: { default: "plain", overrides: { "reset-password:": "hashed" } },
    },
    database: prismaAdapter(db, {
      provider: "postgresql",
    }),
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: emailCodes !== null,
      revokeSessionsOnPasswordReset: true,
      onPasswordReset: async ({ user }) => {
        securityAlerts?.send(user.id, { type: "password-reset" });
      },
    },
    socialProviders:
      env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
        ? {
            google: {
              clientId: env.GOOGLE_CLIENT_ID,
              clientSecret: env.GOOGLE_CLIENT_SECRET,
              scope: ["email", "profile"],
            },
          }
        : undefined,
    trustedOrigins: [
      "openbeacon://",
      ...(process.env["NODE_ENV"] === "development" ? ["exp://", "exp://**"] : []),
    ],
  });

const invalidSignUpToken = () =>
  new APIError("BAD_REQUEST", {
    message: "Verify your email address before creating an account",
    code: "INVALID_SIGN_UP_TOKEN",
  });
