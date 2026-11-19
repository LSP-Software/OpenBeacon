import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { generateKeyPairSync, sign } from "node:crypto";
import { z } from "zod";

process.env.GOOGLE_CLIENT_ID = "google-sign-in-test-client";
process.env.GOOGLE_CLIENT_SECRET = "google-sign-in-test-secret";

const { prisma } = await import("@openbeacon/database");
const { createIntegrationTestCache } = await import("@openbeacon/cache/integration");
const { clientIpHeader, createAuth } = await import("./createAuth.ts");
const { createGoogleSignInChallenges } = await import("./googleSignInChallenge.ts");
const { env } = await import("./env.ts");
const { googleSignInNonce } = await import("@openbeacon/shared");

const prefix = `google-sign-in-${crypto.randomUUID()}`;
const originalFetch = globalThis.fetch;
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: prefix, alg: "RS256", use: "sig" };
const auth = createAuth({
  emailCodes: null,
  securityAlerts: null,
  rateLimits: createIntegrationTestCache(Date.now).rateLimits,
});

const googleIdToken = (email: string, claims: Record<string, unknown> = {}) => {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const message = `${encode({ alg: "RS256", kid: jwk.kid })}.${encode({
    iss: "https://accounts.google.com",
    aud: process.env.GOOGLE_CLIENT_ID,
    sub: `${email}-subject`,
    email,
    email_verified: true,
    name: "Google User",
    picture: "https://lh3.googleusercontent.com/a/photo",
    iat: now,
    exp: now + 300,
    ...claims,
  })}`;
  return `${message}.${sign("RSA-SHA256", Buffer.from(message), privateKey).toString("base64url")}`;
};

const postSignInSocial = (body: unknown) =>
  auth.handler(
    new Request("http://localhost:3000/api/auth/sign-in/social", {
      method: "POST",
      headers: { "content-type": "application/json", [clientIpHeader]: "192.0.2.1" },
      body: JSON.stringify(body),
    }),
  );

const requestChallenge = async () => {
  const response = await auth.handler(
    new Request("http://localhost:3000/api/auth/google-sign-in/challenge", {
      method: "POST",
      headers: { [clientIpHeader]: "192.0.2.1" },
    }),
  );
  expect(response.status).toBe(200);
  return z.object({ challenge: z.string() }).parse(await response.json()).challenge;
};

const serverUrl = env.BETTER_AUTH_URL;

const signInWithChallenge = (
  email: string,
  challenge: string,
  {
    claims = {},
    nonceServerUrl = serverUrl,
  }: { claims?: Record<string, unknown>; nonceServerUrl?: string } = {},
) =>
  postSignInSocial({
    provider: "google",
    idToken: {
      token: googleIdToken(email, {
        nonce: googleSignInNonce({ serverUrl: nonceServerUrl, challenge }),
        ...claims,
      }),
      nonce: challenge,
    },
  });

const signInWithGoogle = async (email: string, claims: Record<string, unknown> = {}) =>
  signInWithChallenge(email, await requestChallenge(), { claims });

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

    test("a Google account whose email isn't verified can't sign in or claim the address", async () => {
      const email = `${prefix}-unverified@example.test`;
      for (const emailVerified of [false, "true", undefined]) {
        expect((await signInWithGoogle(email, { email_verified: emailVerified })).status).toBe(401);
      }
      expect(await prisma.user.count({ where: { email } })).toBe(0);
    });

    test("the redirect sign-in the app never uses is switched off and stores nothing", async () => {
      const marker = `${prefix}-redirect-marker`;
      const response = await postSignInSocial({
        provider: "google",
        disableRedirect: true,
        additionalData: { marker },
      });
      expect(response.status).toBe(404);
      expect(await prisma.verification.count({ where: { value: { contains: marker } } })).toBe(0);
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

    test("a Google display name names refuse still signs up, with the name cleaned or replaced", async () => {
      for (const [suffix, name, stored] of [
        ["bidi-only", "\u202E\u2066\u2069", "OpenBeacon user"],
        ["override", "Ali\u202Ece", "Alice"],
        ["long", "b".repeat(120), "b".repeat(100)],
      ] as const) {
        const email = `${prefix}-${suffix}@example.test`;
        expect((await signInWithGoogle(email, { name })).status).toBe(200);
        expect((await prisma.user.findUniqueOrThrow({ where: { email } })).name).toBe(stored);
      }
    });

    test("Google sign-in never copies the Google photo and returns the sealed picture key", async () => {
      const email = `${prefix}-photo@example.test`;
      expect((await signInWithGoogle(email)).status).toBe(200);
      const user = await prisma.user.findUniqueOrThrow({ where: { email } });
      expect(user).toMatchObject({ image: null, name: "Google User", email });

      const picture = "https://cdn.example.com/file/bucket/user/x/uploads/avatar/picture";
      await prisma.user.update({
        where: { id: user.id },
        data: { image: picture, imageKeySealed: "sealed-copy" },
      });
      const later = await signInWithGoogle(email);

      expect(later.status).toBe(200);
      expect((await later.json()).user).toMatchObject({
        image: picture,
        imageKeySealed: "sealed-copy",
      });
      expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).image).toBe(picture);
    });

    test("a token with no challenge, or a challenge but no nonce in the token, can't sign in", async () => {
      const email = `${prefix}-no-nonce@example.test`;
      const challenge = await requestChallenge();
      const tokens = [
        { token: googleIdToken(email) },
        { token: googleIdToken(email, { nonce: challenge }) },
        { token: googleIdToken(email), nonce: challenge },
        {
          token: googleIdToken(email, { nonce: googleSignInNonce({ serverUrl, challenge }) }),
        },
      ];
      for (const idToken of tokens) {
        expect((await postSignInSocial({ provider: "google", idToken })).status).toBe(401);
      }
      expect(await prisma.user.count({ where: { email } })).toBe(0);
    });

    test("a token another server asked Google for can't sign in here", async () => {
      const email = `${prefix}-replay@example.test`;
      const warn = spyOn(console, "warn").mockImplementation(() => {});
      const relayed = await signInWithChallenge(email, await requestChallenge(), {
        nonceServerUrl: "https://hostile.example",
      });
      const warnings = warn.mock.calls
        .map((call) => String(call[0]))
        .filter((message) => message.startsWith("[google-sign-in]"));
      warn.mockRestore();
      expect(relayed.status).toBe(401);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("BETTER_AUTH_URL");
      expect(warnings[0]).not.toContain(email);

      const otherServer = createGoogleSignInChallenges({ db: prisma, secret: "x".repeat(32) });
      const foreign = await signInWithChallenge(email, await otherServer.issue());
      expect(foreign.status).toBe(401);
      expect(await prisma.user.count({ where: { email } })).toBe(0);
    });

    test("a challenge signs in once only", async () => {
      const email = `${prefix}-reuse@example.test`;
      const challenge = await requestChallenge();
      const first = await signInWithChallenge(email, challenge);
      expect(first.status).toBe(200);
      const sessions = await prisma.session.count({ where: { user: { email } } });

      expect((await signInWithChallenge(email, challenge)).status).toBe(401);
      expect(
        (await signInWithChallenge(email, challenge, { claims: { name: "Another Token" } })).status,
      ).toBe(401);
      expect(await prisma.session.count({ where: { user: { email } } })).toBe(sessions);
    });

    test("a token that fails verification leaves its challenge usable", async () => {
      const email = `${prefix}-retry@example.test`;
      const challenge = await requestChallenge();
      expect(
        (await signInWithChallenge(email, challenge, { claims: { aud: "other" } })).status,
      ).toBe(401);
      expect((await signInWithChallenge(email, challenge)).status).toBe(200);
    });

    test("an expired challenge can't sign in", async () => {
      const email = `${prefix}-expired@example.test`;
      const withLifetime = (lifetimeMs: number) =>
        createGoogleSignInChallenges({ db: prisma, secret: env.BETTER_AUTH_SECRET, lifetimeMs });
      const expired = await withLifetime(-1_000).issue();
      const current = await withLifetime(60_000).issue();

      expect((await signInWithChallenge(email, expired)).status).toBe(401);
      expect(await prisma.user.count({ where: { email } })).toBe(0);
      expect((await signInWithChallenge(email, current)).status).toBe(200);
    });

    test("a challenge with a changed expiry or signature can't be used", async () => {
      const challenges = createGoogleSignInChallenges({
        db: prisma,
        secret: env.BETTER_AUTH_SECRET,
      });
      const [expiry, random, mac] = (await challenges.issue()).split(".");
      const otherMac = mac?.startsWith("A") ? `B${mac.slice(1)}` : `A${mac?.slice(1) ?? ""}`;
      for (const tampered of [
        `${String(Number(expiry) + 60_000)}.${random}.${mac}`,
        `${expiry}.${random}.${otherMac}`,
        `${expiry}.${random}`,
      ]) {
        expect(await challenges.use(tampered)).toBe(false);
      }
      expect(await challenges.use(`${expiry}.${random}.${mac}`)).toBe(true);
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
