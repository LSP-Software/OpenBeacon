import { expo } from "@better-auth/expo";
import { Prisma, prisma as db, readDatabaseTime } from "@openbeacon/database";
import { accountNameFromProfile, accountNameSchema } from "@openbeacon/schemas";
import { googleSignInNonce } from "@openbeacon/shared";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import {
  APIError,
  createAuthMiddleware,
  getAuthoritativeSessionFromCtx,
  isAPIError,
} from "better-auth/api";
import { type EmailCodes, normalizeEmail } from "./emailCode.ts";
import { emailCodePlugin } from "./emailCodePlugin.ts";
import { env } from "./env.ts";
import { verifyGoogleIdToken } from "./googleIdToken.ts";
import {
  createGoogleSignInChallenges,
  googleSignInChallengePlugin,
} from "./googleSignInChallenge.ts";
import {
  type PasswordAttemptLimits,
  reservePasswordAttempt,
  settlePasswordAttempt,
} from "./passwordAttempts.ts";
import { getPublicUrl } from "./publicUrl.ts";
import type { SecurityAlerts } from "./securityAlerts.ts";
import { checkSignInCode } from "./signInCodeGate.ts";

export const clientIpHeader = "x-openbeacon-client-ip";

export const createAuth = ({
  emailCodes,
  securityAlerts,
  rateLimits,
  runInBackground,
}: {
  emailCodes: EmailCodes | null;
  securityAlerts: SecurityAlerts | null;
  rateLimits: PasswordAttemptLimits;
  runInBackground?: (task: Promise<unknown>) => void;
}) => {
  const passwordChangeDevices = new Map<string, string>();
  const google =
    env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? {
          clientId: env.GOOGLE_CLIENT_ID,
          clientSecret: env.GOOGLE_CLIENT_SECRET,
          challenges: createGoogleSignInChallenges({ db, secret: env.BETTER_AUTH_SECRET }),
        }
      : null;
  return betterAuth({
    plugins: [
      expo(),
      emailCodePlugin(emailCodes),
      googleSignInChallengePlugin(google?.challenges ?? null),
    ],
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
      "/account-info",
      "/get-access-token",
      "/link-social",
      "/refresh-token",
      "/unlink-account",
      "/update-session",
      "/verify-password",
      "/expo-authorization-proxy",
      "/error",
      "/ok",
    ],
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (
          ctx.path === "/reset-password/:token" ||
          ctx.path === "/callback/:id" ||
          (ctx.path === "/sign-in/social" && !ctx.body?.idToken)
        ) {
          throw new APIError("NOT_FOUND");
        }
        if (ctx.path === "/change-password") {
          const session = await getAuthoritativeSessionFromCtx(ctx);
          const linked =
            session &&
            (await db.session.findUnique({
              where: { id: session.session.id },
              select: { device: { select: { id: true, activatedAt: true, revokedAt: true } } },
            }));
          if (session && (!linked?.device?.activatedAt || linked.device.revokedAt)) {
            throw new APIError("FORBIDDEN", { message: "Finish setting up this phone first." });
          }
          if (session) {
            await reservePasswordAttempt(rateLimits, session.user.email);
            if (linked?.device) passwordChangeDevices.set(session.session.id, linked.device.id);
          }
        }
        const signInEmail: unknown = ctx.body?.email;
        if (ctx.path === "/sign-in/email" && typeof signInEmail === "string") {
          await reservePasswordAttempt(rateLimits, signInEmail);
        }
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
        const passwordEmail: unknown =
          ctx.path === "/sign-in/email"
            ? ctx.body?.email
            : ctx.path === "/change-password"
              ? ctx.context.session?.user.email
              : undefined;
        if (typeof passwordEmail === "string") {
          await settlePasswordAttempt(rateLimits, passwordEmail, ctx.context.returned);
        }
        const userId = ctx.context.session?.user.id;
        const sessionId = ctx.context.session?.session.id;
        const changedOn = sessionId ? passwordChangeDevices.get(sessionId) : undefined;
        if (sessionId) passwordChangeDevices.delete(sessionId);
        if (ctx.path === "/change-password" && userId && !isAPIError(ctx.context.returned)) {
          securityAlerts?.send(userId, { type: "password-changed" }, changedOn ?? null);
        }
      }),
    },
    rateLimit: { enabled: false },
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
          before: async (session, context) => {
            if (context?.path === "/sign-in/email") {
              await checkSignInCode({
                db,
                emailCodes,
                userId: session.userId,
                context,
                runInBackground: (task) =>
                  runInBackground ? runInBackground(task) : context.context.runInBackground(task),
              });
            }
            return { data: { ...session, createdAt: await readDatabaseTime(db) } };
          },
          after: async (session) => {
            const expired = await db.$transaction(async (tx) => {
              await tx.$queryRaw(
                Prisma.sql`SELECT id FROM "User" WHERE id = ${session.userId} FOR NO KEY UPDATE`,
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
            if (context?.path !== "/sign-up/email") {
              return { data: { ...user, name: accountNameFromProfile(user.name), image: null } };
            }
            const result = accountNameSchema.safeParse(user.name);
            if (!result.success)
              throw new APIError("BAD_REQUEST", {
                message: result.error.issues[0]?.message ?? "Invalid name",
              });
            if (!emailCodes) return { data: { ...user, name: result.data, image: null } };
            const signUpToken: unknown = context.body?.signUpToken;
            const consumed =
              typeof signUpToken === "string" &&
              (await emailCodes.consumeToken({
                purpose: "sign-up",
                token: signUpToken,
                value: normalizeEmail(user.email),
              }));
            if (!consumed) throw invalidSignUpToken();
            return { data: { ...user, name: result.data, image: null, emailVerified: true } };
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
    user: {
      additionalFields: {
        imageKeySealed: { type: "string", required: false, input: false },
      },
    },
    account: { accountLinking: { enabled: false } },
    session: { expiresIn: 7 * 24 * 60 * 60, updateAge: 24 * 60 * 60, freshAge: 30 * 60 },
    verification: {
      storeIdentifier: { default: "plain", overrides: { "reset-password:": "hashed" } },
    },
    database: prismaAdapter(db, {
      provider: "postgresql",
    }),
    secret: env.BETTER_AUTH_SECRET,
    baseURL: `${getPublicUrl(env.BETTER_AUTH_URL).baseUrl}/api/auth`,
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: emailCodes !== null,
      revokeSessionsOnPasswordReset: true,
      onPasswordReset: async ({ user }) => {
        securityAlerts?.send(user.id, { type: "password-reset" });
      },
    },
    socialProviders: google
      ? {
          google: {
            clientId: google.clientId,
            clientSecret: google.clientSecret,
            scope: ["email", "profile"],
            mapProfileToUser: () => ({ image: undefined }),
            verifyIdToken: async (token, challenge) => {
              if (!challenge || !google.challenges.isGenuine(challenge)) return false;
              const payload = await verifyGoogleIdToken({
                token,
                audience: google.clientId,
                nonce: googleSignInNonce({ serverUrl: env.BETTER_AUTH_URL, challenge }),
              });
              if (payload === "wrong-nonce") {
                console.warn(
                  `[google-sign-in] refused a Google sign-in because the phone asked Google for it on behalf of a different server address. If phones can't sign in with Google, set BETTER_AUTH_URL to the exact address phones use, with the same scheme, host and port. It is ${new URL(env.BETTER_AUTH_URL).origin} now.`,
                );
                return false;
              }
              return (
                payload?.["email_verified"] === true && (await google.challenges.use(challenge))
              );
            },
          },
        }
      : undefined,
    trustedOrigins: [
      "openbeacon://",
      ...(process.env["NODE_ENV"] === "development" ? ["exp://", "exp://**"] : []),
    ],
  });
};

const invalidSignUpToken = () =>
  new APIError("BAD_REQUEST", {
    message: "Verify your email address before creating an account",
    code: "INVALID_SIGN_UP_TOKEN",
  });
