import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { OpenBeaconCache } from "@openbeacon/cache";

process.env.GOOGLE_CLIENT_ID = "google-deletion-test-client";
process.env.GOOGLE_CLIENT_SECRET = "google-deletion-test-secret";

const { prisma } = await import("@openbeacon/database");
const { appRouter } = await import("../root.ts");
let rateLimitTime = 0;
const cache = new OpenBeaconCache({
  redisUrl: process.env["REDIS_URL"] ?? "redis://localhost:6379",
  keyPrefix: `test-${crypto.randomUUID()}`,
  now: () => rateLimitTime,
});
const id = `google-deletion-${crypto.randomUUID()}`;
const sessionId = `${id}-session`;
const email = `${id}@example.test`;
const googleSubject = `${id}-subject`;
const originalFetch = globalThis.fetch;
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const { privateKey: otherPrivateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = {
  ...publicKey.export({ format: "jwk" }),
  kid: "google-deletion-test",
  alg: "RS256",
  use: "sig",
};
const tokens = new Map<string, { token: string; verifier: string }>();
const caller = (session = sessionId) =>
  appRouter.createCaller({
    cache,
    db: prisma,
    clientIp: "127.0.0.1",
    session: { user: { id, email }, session: { id: session } },
  } as Parameters<typeof appRouter.createCaller>[0]);
const jwt = (claims: Record<string, unknown>, invalidSignature = false) => {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const message = `${encode({ alg: "RS256", kid: jwk.kid })}.${encode({ iss: "https://accounts.google.com", aud: process.env.GOOGLE_CLIENT_ID, sub: googleSubject, iat: now, exp: now + 300, ...claims })}`;
  return `${message}.${sign("RSA-SHA256", Buffer.from(message), invalidSignature ? otherPrivateKey : privateKey).toString("base64url")}`;
};
const begin = async () => {
  rateLimitTime += 61_000;
  const start = await caller().account.beginGoogleDeletionVerification();
  const challenge = await prisma.googleDeletionChallenge.findUniqueOrThrow({
    where: { id: createHash("sha256").update(start.state).digest("hex") },
  });
  const url = new URL(start.url);
  expect(url.searchParams.get("nonce")).toBe(challenge.nonce);
  expect(url.searchParams.get("code_challenge")).toBe(
    createHash("sha256").update(challenge.codeVerifier).digest("base64url"),
  );
  return { ...start, challenge };
};

describe.skipIf(process.env["OPENBEACON_INTEGRATION"] !== "1")(
  "Google deletion verification with PostgreSQL",
  () => {
    beforeAll(async () => {
      await prisma.user.create({ data: { id, email, name: "Google user" } });
      await prisma.account.create({
        data: { id: `${id}-account`, userId: id, providerId: "google", accountId: googleSubject },
      });
      await prisma.session.createMany({
        data: [sessionId, `${id}-other`].map((session) => ({
          id: session,
          userId: id,
          token: `${session}-token`,
          expiresAt: new Date(Date.now() + 3_600_000),
        })),
      });
      globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        if (url === "https://www.googleapis.com/oauth2/v3/certs")
          return Response.json({ keys: [jwk] });
        if (url === "https://oauth2.googleapis.com/token") {
          const form = new URLSearchParams(String(init?.body));
          const code = form.get("code") ?? "";
          const issued = tokens.get(code);
          tokens.delete(code);
          if (!issued || form.get("code_verifier") !== issued.verifier)
            return new Response(null, { status: 400 });
          return Response.json({ id_token: issued.token });
        }
        throw new Error("Unexpected network request");
      }) as typeof fetch;
    });
    afterAll(async () => {
      globalThis.fetch = originalFetch;
      await prisma.user.deleteMany({ where: { id } });
      await prisma.$disconnect();
    });

    test("rejects wrong or expired state, a different session, wrong account, nonce, audience and issuer", async () => {
      let start = await begin();
      await expect(
        caller().account.requestDeletion({ google: { state: "wrong", code: "unused" } }),
      ).rejects.toThrow();
      await expect(
        caller(`${id}-other`).account.requestDeletion({
          google: { state: start.state, code: "unused" },
        }),
      ).rejects.toThrow();
      await prisma.googleDeletionChallenge.update({
        where: { id: start.challenge.id },
        data: { expiresAt: new Date(0) },
      });
      await expect(
        caller().account.requestDeletion({ google: { state: start.state, code: "unused" } }),
      ).rejects.toThrow();
      for (const [name, claims] of Object.entries({
        wrongAccount: { sub: "different" },
        wrongNonce: { nonce: "wrong" },
        missingNonce: { nonce: undefined },
        wrongAudience: { aud: "different" },
        wrongIssuer: { iss: "https://invalid.example" },
        expired: { exp: 1 },
      })) {
        start = await begin();
        tokens.set(name, {
          token: jwt({ nonce: start.challenge.nonce, ...claims }),
          verifier: start.challenge.codeVerifier,
        });
        await expect(
          caller().account.requestDeletion({ google: { state: start.state, code: name } }),
        ).rejects.toThrow();
        expect((await prisma.user.findUniqueOrThrow({ where: { id } })).pendingDeletion).toBe(
          false,
        );
      }
      start = await begin();
      tokens.set("invalidSignature", {
        token: jwt({ nonce: start.challenge.nonce }, true),
        verifier: start.challenge.codeVerifier,
      });
      await expect(
        caller().account.requestDeletion({
          google: { state: start.state, code: "invalidSignature" },
        }),
      ).rejects.toThrow();
      expect((await prisma.user.findUniqueOrThrow({ where: { id } })).pendingDeletion).toBe(false);
      expect(await prisma.session.count({ where: { userId: id } })).toBe(2);
    }, 20_000);

    test("verifies the linked subject, consumes the challenge and revokes every session", async () => {
      const start = await begin();
      tokens.set("valid", {
        token: jwt({ nonce: start.challenge.nonce }),
        verifier: start.challenge.codeVerifier,
      });
      const result = await caller().account.requestDeletion({
        google: { state: start.state, code: "valid" },
      });
      expect(result.deletionDate.getTime()).toBeGreaterThan(Date.now());
      expect((await prisma.user.findUniqueOrThrow({ where: { id } })).pendingDeletion).toBe(true);
      expect(await prisma.session.count({ where: { userId: id } })).toBe(0);
      expect(await prisma.googleDeletionChallenge.count({ where: { userId: id } })).toBe(0);
      await expect(
        caller().account.requestDeletion({ google: { state: start.state, code: "valid" } }),
      ).rejects.toThrow();
    });
  },
);
