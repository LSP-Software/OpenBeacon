import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { generateKeyPairSync, sign } from "node:crypto";

process.env.GOOGLE_CLIENT_ID = "google-sign-in-test-client";
process.env.GOOGLE_CLIENT_SECRET = "google-sign-in-test-secret";

const { prisma } = await import("@openbeacon/database");
const { createIntegrationTestCache } = await import("@openbeacon/cache/integration");
const { clientIpHeader, createAuth } = await import("./createAuth.ts");

const prefix = `google-sign-in-${crypto.randomUUID()}`;
const originalFetch = globalThis.fetch;
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: prefix, alg: "RS256", use: "sig" };
const auth = createAuth({
  emailCodes: null,
  securityAlerts: null,
  rateLimits: createIntegrationTestCache(Date.now).rateLimits,
});

const googleIdToken = (email: string) => {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const message = `${encode({ alg: "RS256", kid: jwk.kid })}.${encode({
    iss: "https://accounts.google.com",
    aud: process.env.GOOGLE_CLIENT_ID,
    sub: `${email}-subject`,
    email,
    email_verified: true,
    name: "Google User",
    iat: now,
    exp: now + 300,
  })}`;
  return `${message}.${sign("RSA-SHA256", Buffer.from(message), privateKey).toString("base64url")}`;
};

const signInWithGoogle = (email: string) =>
  auth.handler(
    new Request("http://localhost:3000/api/auth/sign-in/social", {
      method: "POST",
      headers: { "content-type": "application/json", [clientIpHeader]: "192.0.2.1" },
      body: JSON.stringify({ provider: "google", idToken: { token: googleIdToken(email) } }),
    }),
  );

describe.skipIf(process.env["OPENBEACON_INTEGRATION"] !== "1")(
  "Google sign-in with PostgreSQL",
  () => {
    beforeAll(() => {
      globalThis.fetch = (async (input: string | URL | Request) => {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        if (url === "https://www.googleapis.com/oauth2/v3/certs")
          return Response.json({ keys: [jwk] });
        throw new Error("Unexpected network request");
      }) as typeof fetch;
    });

    afterAll(async () => {
      globalThis.fetch = originalFetch;
      await prisma.user.deleteMany({ where: { email: { startsWith: prefix } } });
      await prisma.$disconnect();
    });

    test("a new email can sign up with Google", async () => {
      const email = `${prefix}-new@example.test`;
      const response = await signInWithGoogle(email);
      expect(response.status).toBe(200);
      expect(
        await prisma.account.findMany({
          where: { user: { email } },
          select: { providerId: true },
        }),
      ).toEqual([{ providerId: "google" }]);
    });

    test("Google can't be added to an account that signs in with a password", async () => {
      const email = `${prefix}-password@example.test`;
      const user = await prisma.user.create({
        data: { id: `${prefix}-password`, email, name: "Password User", emailVerified: true },
      });
      await prisma.account.create({
        data: {
          id: `${prefix}-credential`,
          userId: user.id,
          providerId: "credential",
          accountId: user.id,
          password: "not-a-real-hash",
        },
      });

      const response = await signInWithGoogle(email);

      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({ code: "OAUTH_LINK_ERROR" });
      expect(
        await prisma.account.findMany({
          where: { userId: user.id },
          select: { providerId: true },
        }),
      ).toEqual([{ providerId: "credential" }]);
      expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0);
    });
  },
);
