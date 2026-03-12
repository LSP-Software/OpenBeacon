import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { db } from "./db.ts";

export const auth = betterAuth({
  database: prismaAdapter(db, {
    provider: "postgresql",
  }),
  // TODO: use env package
  // biome-ignore lint/complexity/useLiteralKeys: TS4111 requires bracket notation for index signatures
  secret: process.env["BETTER_AUTH_SECRET"],
  // TODO: use env package
  // biome-ignore lint/complexity/useLiteralKeys: TS4111 requires bracket notation for index signatures
  baseURL: process.env["BETTER_AUTH_URL"],
  emailAndPassword: {
    // TODO: Should only support magic links
    enabled: true,
  },
  trustedOrigins: [
    "openbeacon://",
    ...(process.env.NODE_ENV === "development"
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
