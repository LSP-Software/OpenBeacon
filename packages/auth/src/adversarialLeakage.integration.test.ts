import { afterAll, describe, expect, test } from "bun:test";
import { createIntegrationTestCache } from "@openbeacon/cache/integration";
import { prisma } from "@openbeacon/database";
import { clientIpHeader, createAuth } from "./createAuth.ts";
import { createEmailCodes } from "./emailCode.ts";

const prefix = `adv-leak-${crypto.randomUUID()}`;
const password = "correct horse battery";
const tasks: Promise<unknown>[] = [];
const sent: { to: string; code: string }[] = [];

const codes = createEmailCodes({
  db: prisma,
  secret: "integration-email-code-secret-000000000000",
  rateLimits: createIntegrationTestCache(() => Date.now()).rateLimits,
  sendCodeEmail: async (email) => {
    sent.push(email);
  },
  sendAccountExistsEmail: async () => {},
  sendGoogleSignInEmail: async () => {},
});
const auth = createAuth({
  emailCodes: codes,
  securityAlerts: null,
  rateLimits: createIntegrationTestCache(() => Date.now()).rateLimits,
  runInBackground: (task) => tasks.push(task),
});

let addressCounter = 0;
const nextAddress = (label: string) => {
  addressCounter += 1;
  return `${prefix}-${label}-${addressCounter}@example.test`;
};

const request = async (path: string, body: unknown) => {
  const response = await auth.handler(
    new Request(`http://localhost:3000/api/auth${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", [clientIpHeader]: "198.51.100.7" },
      body: JSON.stringify(body),
    }),
  );
  await Promise.all(tasks.splice(0));
  return { status: response.status, body: await response.text() };
};

const createPasswordAccount = async (label: string) => {
  const email = nextAddress(label);
  const signUpToken = await codes.issueToken({ purpose: "sign-up", value: email });
  await auth.api.signUpEmail({ body: { email, password, name: "Leak Tester", signUpToken } });
  return email;
};

const createGoogleOnlyAccount = async (label: string) => {
  const email = nextAddress(label);
  const user = await prisma.user.create({
    data: { id: `${prefix}-${label}`, email, name: "Google Tester", emailVerified: true },
  });
  await prisma.account.create({
    data: {
      id: `${prefix}-${label}-account`,
      userId: user.id,
      providerId: "google",
      accountId: `${prefix}-${label}-google`,
    },
  });
  return email;
};

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

const timeWrongCodes = async (path: string, emails: { known: string; unknown: string }) => {
  const known: number[] = [];
  const unknown: number[] = [];
  for (let attempt = 0; attempt < 15; attempt++) {
    for (const [email, times] of [
      [emails.known, known],
      [emails.unknown, unknown],
    ] as const) {
      const started = performance.now();
      const result = await request(path, { email, code: "000000" });
      times.push(performance.now() - started);
      expect(result.status).toBe(400);
    }
  }
  return { known: median(known), unknown: median(unknown) };
};

afterAll(async () => {
  if (process.env["OPENBEACON_INTEGRATION"] !== "1") return;
  await prisma.verification.deleteMany({ where: { identifier: { contains: prefix } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: prefix } } });
  await prisma.$disconnect();
});

describe.skipIf(process.env["OPENBEACON_INTEGRATION"] !== "1")(
  "adversarial: whether an email has an account",
  () => {
    test("sign-in and code requests answer the same for a password account, a Google account and an unknown address", async () => {
      const passwordEmail = await createPasswordAccount("same-password");
      const googleEmail = await createGoogleOnlyAccount("same-google");
      const unknownEmail = nextAddress("same-unknown");
      const answers = async (email: string) => [
        await request("/sign-in/email", { email, password: "not the password" }),
        await request("/email-code/request-sign-up-code", { email }),
        await request("/email-code/request-password-reset", { email }),
        await request("/email-code/request-email-verification", {
          email,
          password: "not the password",
        }),
        await request("/email-code/verify-sign-up-code", { email, code: "000000" }),
        await request("/email-code/verify-password-reset-code", { email, code: "000000" }),
        await request("/email-code/verify-email", { email, code: "000000" }),
      ];
      const unknown = await answers(unknownEmail);
      expect(await answers(passwordEmail)).toEqual(unknown);
      expect(await answers(googleEmail)).toEqual(unknown);
    });

    test.skip("ADV-IL-1 (open bug): a wrong password reset code is answered measurably slower for an address with a password account, so timing tells an outsider the account exists", async () => {
      const known = await createPasswordAccount("reset-timing");
      const unknown = nextAddress("reset-timing-unknown");
      await request("/email-code/request-password-reset", { email: known });
      await request("/email-code/request-password-reset", { email: unknown });

      const medians = await timeWrongCodes("/email-code/verify-password-reset-code", {
        known,
        unknown,
      });

      expect(medians.known).toBeLessThan(medians.unknown * 1.5 + 0.5);
    });

    test.skip("ADV-IL-1 (open bug): a wrong sign-up code is answered measurably faster for an address that already has an account, so timing tells an outsider the account exists", async () => {
      const known = await createPasswordAccount("signup-timing");
      const unknown = nextAddress("signup-timing-unknown");
      await request("/email-code/request-sign-up-code", { email: known });
      await request("/email-code/request-sign-up-code", { email: unknown });

      const medians = await timeWrongCodes("/email-code/verify-sign-up-code", {
        known,
        unknown,
      });

      expect(medians.unknown).toBeLessThan(medians.known * 1.5 + 0.5);
    });
  },
);
