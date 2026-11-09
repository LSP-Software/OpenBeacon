import { expo } from "@better-auth/expo";
import { Prisma } from "@openbeacon/database";
import { accountNameSchema } from "@openbeacon/schemas";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { db } from "./db.ts";
import type { EmailCodes } from "./emailCode.ts";
import { emailCodePlugin } from "./emailCodePlugin.ts";
import { env } from "./env.ts";

export const clientIpHeader = "x-openbeacon-client-ip";

export const createAuth = ({
  emailCodes,
  runInBackground,
}: {
  emailCodes: EmailCodes | null;
  runInBackground?: (task: Promise<unknown>) => void;
}) =>
  betterAuth({
    plugins: [expo(), emailCodePlugin(emailCodes)],
    disabledPaths: [
      "/send-verification-email",
      "/verify-email",
      "/request-password-reset",
      "/reset-password",
      "/change-email",
      "/delete-user",
      "/delete-user/callback",
    ],
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path === "/reset-password/:token") throw new APIError("NOT_FOUND");
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
          before: async (user) => {
            const result = accountNameSchema.safeParse(user.name);
            if (!result.success)
              throw new APIError("BAD_REQUEST", {
                message: result.error.issues[0]?.message ?? "Invalid name",
              });
            return { data: { ...user, name: result.data } };
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
    database: prismaAdapter(db, {
      provider: "postgresql",
    }),
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    emailAndPassword: {
      enabled: true,
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
