import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { generateKeyPairSync, sign } from "node:crypto";

process.env.GOOGLE_CLIENT_ID = "adversarial-auth-test-client";
process.env.GOOGLE_CLIENT_SECRET = "adversarial-auth-test-secret";

const { prisma } = await import("@openbeacon/database");
const { createIntegrationTestCache } = await import("@openbeacon/cache/integration");
const { clientIpHeader, createAuth } = await import("./createAuth.ts");
const { createEmailCodes, emailCodeMaxAttempts, emailCodeWrongGuessLimit } =
  await import("./emailCode.ts");

const prefix = `adversarial-auth-${crypto.randomUUID()}`;
const password = "correct horse battery";
const originalFetch = globalThis.fetch;
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: prefix, alg: "RS256", use: "sig" };
const sent: { to: string; code: string }[] = [];
const tasks: Promise<unknown>[] = [];
const codes = createEmailCodes({
  db: prisma,
  secret: "adversarial-email-code-secret-0000000000",
  rateLimits: createIntegrationTestCache(Date.now).rateLimits,
  sendCodeEmail: async ({ to, code }) => {
    sent.push({ to, code });
  },
  sendAccountExistsEmail: async () => {},
  sendGoogleSignInEmail: async () => {},
});
const auth = createAuth({
  emailCodes: codes,
  securityAlerts: null,
  rateLimits: createIntegrationTestCache(Date.now).rateLimits,
  runInBackground: (task) => tasks.push(task),
});

let counter = 0;
const nextAddress = (label: string) => {
  counter += 1;
  return `${prefix}-${label}-${counter}@example.test`;
};

const post = async (path: string, body: unknown, cookie?: string) => {
  const response = await auth.handler(
    new Request(`http://localhost:3000/api/auth${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [clientIpHeader]: "192.0.2.10",
        ...(cookie ? { cookie, origin: "http://localhost:3000" } : {}),
      },
      body: JSON.stringify(body),
    }),
  );
  await Promise.all(tasks.splice(0));
  return response;
};

const createPasswordAccount = async (label: string) => {
  const email = nextAddress(label);
  const signUpToken = await codes.issueToken({ purpose: "sign-up", value: email });
  const result = await auth.api.signUpEmail({
    body: { email, password, name: "Adversarial Tester", signUpToken },
  });
  return { email, userId: result.user.id };
};

const signIn = async (email: string) => {
  const response = await post("/sign-in/email", { email, password });
  expect(response.status).toBe(200);
  const { token } = (await response.json()) as { token: string };
  return { cookie: response.headers.get("set-cookie")?.split(";")[0] ?? "", token };
};

const latestCodeFor = (email: string) => sent.findLast((message) => message.to === email)?.code;

const wrongCodeFor = (code: string) => ((Number(code) + 1) % 1_000_000).toString().padStart(6, "0");

const googleIdToken = ({ email, emailVerified }: { email: string; emailVerified: boolean }) => {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const message = `${encode({ alg: "RS256", kid: jwk.kid })}.${encode({
    iss: "https://accounts.google.com",
    aud: process.env.GOOGLE_CLIENT_ID,
    sub: `${email}-subject`,
    email,
    email_verified: emailVerified,
    name: "Google User",
    iat: now,
    exp: now + 300,
  })}`;
  return `${message}.${sign("RSA-SHA256", Buffer.from(message), privateKey).toString("base64url")}`;
};

describe.skipIf(process.env["OPENBEACON_INTEGRATION"] !== "1")(
  "adversarial better-auth routes with PostgreSQL and Redis",
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
      await prisma.verification.deleteMany({ where: { identifier: { contains: prefix } } });
      await prisma.verification.deleteMany({ where: { value: { startsWith: prefix } } });
      await prisma.user.deleteMany({ where: { email: { startsWith: prefix } } });
      await prisma.$disconnect();
    }, 30_000);

    test.skip("ADV-AU-2 (open bug): an anonymous caller can block someone's password reset for 24 hours by guessing wrong codes — the owner's own fresh code should still work", async () => {
      const { email } = await createPasswordAccount("reset-lockout");
      for (let round = 0; round < emailCodeWrongGuessLimit.limit / emailCodeMaxAttempts; round++) {
        expect((await post("/email-code/request-password-reset", { email })).status).toBe(200);
        const code = latestCodeFor(email) ?? "";
        for (let guess = 0; guess < emailCodeMaxAttempts; guess++) {
          expect(
            (
              await post("/email-code/verify-password-reset-code", {
                email,
                code: wrongCodeFor(code),
              })
            ).status,
          ).toBe(400);
        }
      }

      expect((await post("/email-code/request-password-reset", { email })).status).toBe(200);
      const ownersCode = latestCodeFor(email) ?? "";
      const owner = await post("/email-code/verify-password-reset-code", {
        email,
        code: ownersCode,
      });

      expect(owner.status).toBe(200);
    }, 30_000);

    test.skip("ADV-AU-3 (open bug): Google sign-in with an unverified email claims that address — should be refused and create no account", async () => {
      const email = nextAddress("google-unverified");
      const response = await post("/sign-in/social", {
        provider: "google",
        idToken: { token: googleIdToken({ email, emailVerified: false }) },
      });

      expect(response.status).not.toBe(200);
      expect(await prisma.user.count({ where: { email } })).toBe(0);
    });

    test("revoke-session ignores another account's session token", async () => {
      const attacker = await createPasswordAccount("revoke-attacker");
      const victim = await createPasswordAccount("revoke-victim");
      const { cookie } = await signIn(attacker.email);
      const { token } = await signIn(victim.email);

      const response = await post("/revoke-session", { token }, cookie);

      expect(response.status).toBe(200);
      expect(await prisma.session.count({ where: { token } })).toBe(1);
    });

    test("a signed-out session can't be used again", async () => {
      const { email } = await createPasswordAccount("signed-out");
      const { cookie, token } = await signIn(email);

      expect((await post("/sign-out", {}, cookie)).status).toBe(200);

      expect(await prisma.session.count({ where: { token } })).toBe(0);
      expect(await auth.api.getSession({ headers: new Headers({ cookie }) })).toBeNull();
    });

    test("routes that would add a password, link Google or change the email stay off", async () => {
      const { email } = await createPasswordAccount("routes-off");
      const { cookie } = await signIn(email);
      const statuses = await Promise.all(
        [
          ["/set-password", { newPassword: "another passphrase" }],
          ["/link-social", { provider: "google" }],
          ["/change-email", { newEmail: nextAddress("routes-off-new") }],
          ["/update-user", { image: "https://example.test/picture.png" }],
          ["/list-sessions", {}],
        ].map(async ([path, body]) => (await post(String(path), body, cookie)).status),
      );

      expect(statuses).toEqual([404, 404, 404, 404, 404]);
    });
  },
);
