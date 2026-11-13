import { afterAll, describe, expect, test } from "bun:test";
import { createIntegrationTestCache } from "@openbeacon/cache/integration";
import { prisma } from "@openbeacon/database";
import { z } from "zod";
import { clientIpHeader, createAuth } from "./createAuth.ts";
import { passwordFailureLimit } from "./passwordAttempts.ts";

const prefix = `password-attempts-${crypto.randomUUID()}`;
const password = "correct horse battery";
const auth = createAuth({
  emailCodes: null,
  securityAlerts: null,
  rateLimits: createIntegrationTestCache(Date.now).rateLimits,
});

let counter = 0;
const createAccount = async () => {
  counter += 1;
  const email = `${prefix}-${counter}@example.test`;
  await auth.api.signUpEmail({ body: { email, password, name: "Password User" } });
  return email;
};

const post = async (path: string, body: unknown, cookie?: string) => {
  counter += 1;
  const response = await auth.handler(
    new Request(`http://localhost:3000/api/auth${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [clientIpHeader]: `198.51.${Math.floor(counter / 250)}.${(counter % 250) + 1}`,
        ...(cookie ? { cookie, origin: "http://localhost:3000" } : {}),
      },
      body: JSON.stringify(body),
    }),
  );
  const parsed = z
    .object({ code: z.string().optional(), message: z.string().optional() })
    .safeParse(await response.clone().json());
  return {
    status: response.status,
    code: parsed.data?.code ?? null,
    message: parsed.data?.message ?? null,
    response,
  };
};

const signIn = (email: string, attempt: string) =>
  post("/sign-in/email", { email, password: attempt });

const signInOnActivePhone = async (email: string) => {
  const { response } = await signIn(email, password);
  const { token } = z.object({ token: z.string() }).parse(await response.json());
  const session = await prisma.session.findUniqueOrThrow({ where: { token } });
  await prisma.userDevice.create({
    data: {
      id: `${session.id}-device`,
      userId: session.userId,
      publicKey: "public-key",
      publicKeyAlgorithm: "x25519",
      name: "Phone",
      icon: "phone",
      activatedAt: new Date(),
    },
  });
  await prisma.session.update({
    where: { id: session.id },
    data: { deviceId: `${session.id}-device` },
  });
  return response.headers.get("set-cookie")?.split(";")[0] ?? "";
};

const changePassword = (cookie: string, currentPassword: string) =>
  post("/change-password", { currentPassword, newPassword: "a brand new passphrase" }, cookie);

describe.skipIf(process.env["OPENBEACON_INTEGRATION"] !== "1")(
  "password failure limit with PostgreSQL and Redis",
  () => {
    afterAll(async () => {
      await prisma.user.deleteMany({ where: { email: { startsWith: prefix } } });
      await prisma.$disconnect();
    });

    test("after 10 wrong passwords the right one is refused too", async () => {
      const email = await createAccount();
      for (let index = 0; index < passwordFailureLimit.limit; index++) {
        expect((await signIn(email, "not the password")).code).toBe("INVALID_EMAIL_OR_PASSWORD");
      }

      expect(await signIn(email, password)).toMatchObject({
        status: 429,
        code: "TOO_MANY_PASSWORD_ATTEMPTS",
        message: "Too many attempts. Try again in 15 minutes.",
      });
    });

    test("the limit follows the normalised email", async () => {
      const email = await createAccount();
      for (let index = 0; index < passwordFailureLimit.limit; index++) {
        await signIn(index % 2 ? email.toUpperCase() : email, "not the password");
      }

      expect((await signIn(email, password)).code).toBe("TOO_MANY_PASSWORD_ATTEMPTS");
    });

    test("successful sign-ins don't count", async () => {
      const email = await createAccount();
      for (let index = 0; index < passwordFailureLimit.limit + 5; index++) {
        expect((await signIn(email, password)).status).toBe(200);
      }
      for (let index = 0; index < passwordFailureLimit.limit - 1; index++) {
        await signIn(email, "not the password");
      }

      expect((await signIn(email, password)).status).toBe(200);
    });

    test("one locked account doesn't lock another", async () => {
      const locked = await createAccount();
      const other = await createAccount();
      for (let index = 0; index < passwordFailureLimit.limit; index++) {
        await signIn(locked, "not the password");
      }

      expect((await signIn(locked, password)).code).toBe("TOO_MANY_PASSWORD_ATTEMPTS");
      expect((await signIn(other, password)).status).toBe(200);
    });

    test("parallel guesses can't get past the limit", async () => {
      const email = await createAccount();
      const results = await Promise.all(
        Array.from({ length: passwordFailureLimit.limit * 3 }, () =>
          signIn(email, "not the password"),
        ),
      );

      expect(results.filter((result) => result.code === "INVALID_EMAIL_OR_PASSWORD")).toHaveLength(
        passwordFailureLimit.limit,
      );
    });

    test("wrong current passwords on change-password share the account's limit", async () => {
      const email = await createAccount();
      const cookie = await signInOnActivePhone(email);
      for (let index = 0; index < passwordFailureLimit.limit / 2; index++) {
        expect((await changePassword(cookie, "not the password")).code).toBe("INVALID_PASSWORD");
        await signIn(email, "not the password");
      }

      expect(await changePassword(cookie, password)).toMatchObject({
        status: 429,
        code: "TOO_MANY_PASSWORD_ATTEMPTS",
      });
      expect((await signIn(email, password)).code).toBe("TOO_MANY_PASSWORD_ATTEMPTS");
    });

    test("a successful password change doesn't count", async () => {
      const email = await createAccount();
      const cookie = await signInOnActivePhone(email);
      for (let index = 0; index < passwordFailureLimit.limit - 1; index++) {
        await signIn(email, "not the password");
      }

      expect((await changePassword(cookie, password)).status).toBe(200);
      expect((await signIn(email, "a brand new passphrase")).status).toBe(200);
    });
  },
);
