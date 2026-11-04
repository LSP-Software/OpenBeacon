import { expo } from "@better-auth/expo";
import { accountNameSchema } from "@openbeacon/schemas";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError } from "better-auth/api";
import { getAuthCapabilities } from "./capabilities.ts";
import { db } from "./db.ts";
import { env } from "./env.ts";

const googleClientId = env.GOOGLE_CLIENT_ID;
const googleClientSecret = env.GOOGLE_CLIENT_SECRET;

export const authCapabilities = getAuthCapabilities({
  GOOGLE_CLIENT_ID: googleClientId,
  GOOGLE_CLIENT_SECRET: googleClientSecret,
});

export const auth = betterAuth({
  plugins: [expo()],
  databaseHooks: {
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
    // TODO: Should only support magic links
    enabled: true,
  },
  socialProviders:
    authCapabilities.google && googleClientId && googleClientSecret
      ? {
          google: {
            clientId: googleClientId,
            clientSecret: googleClientSecret,
            scope: ["email", "profile"],
          },
        }
      : undefined,
  trustedOrigins: [
    "openbeacon://",
    ...(process.env["NODE_ENV"] === "development"
      ? [
          "exp://", // Trust all Expo URLs (prefix matching)
          "exp://**", // Trust all Expo URLs (wildcard matching)
        ]
      : []),
  ],
});

export type AuthType = {
  user: typeof auth.$Infer.Session.user | null;
  session: typeof auth.$Infer.Session.session | null;
};
