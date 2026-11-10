import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { OpenBeaconCache } from "@openbeacon/cache";
import { prisma } from "@openbeacon/database";
import type { EmailCodePurpose, SecurityAlert } from "@openbeacon/email";
import { z } from "zod";
import { clientIpHeader, createAuth } from "./createAuth.ts";
import {
  createEmailCodes,
  emailCodeLifetimeMs,
  emailCodeMaxAttempts,
  emailCodeRequestLimits,
  emailCodeTokens,
  emailCodeWrongGuessLimit,
} from "./emailCode.ts";
import { createSecurityAlerts } from "./securityAlerts.ts";

const prefix = `email-code-${crypto.randomUUID()}`;
const password = "correct horse battery";
let clockMs = Date.now();
let sendFailure: Error | null = null;
let sendGate: Promise<void> | null = null;
const sent: { to: string; purpose: EmailCodePurpose; code: string; userId?: string }[] = [];
const accountExistsSent: { to: string; userId: string; hasPassword: boolean }[] = [];
const googleSignInSent: { to: string; userId: string }[] = [];
const tasks: Promise<unknown>[] = [];
const alerts: { to: string; userId: string; alert: SecurityAlert }[] = [];
let alertFailure: Error | null = null;

const codes = createEmailCodes({
  db: prisma,
  secret: "integration-email-code-secret-000000000000",
  rateLimits: new OpenBeaconCache({
    redisUrl: process.env["REDIS_URL"] ?? "redis://localhost:6379",
    keyPrefix: `test-${crypto.randomUUID()}`,
    now: () => clockMs,
  }).rateLimits,
  limitRequestsPerIp: true,
  sendCodeEmail: async (email) => {
    if (sendFailure) throw sendFailure;
    await sendGate;
    sent.push(email);
  },
  sendAccountExistsEmail: async (email) => {
    await sendGate;
    accountExistsSent.push(email);
  },
  sendGoogleSignInEmail: async (email) => {
    await sendGate;
    googleSignInSent.push(email);
  },
  now: () => new Date(clockMs),
});
const securityAlerts = createSecurityAlerts({
  db: prisma,
  sendSecurityAlertEmail: async ({ to, userId, alert }) => {
    if (alertFailure) throw alertFailure;
    alerts.push({ to, userId, alert });
  },
  runInBackground: (task) => tasks.push(task),
});
const auth = createAuth({
  emailCodes: codes,
  securityAlerts,
  runInBackground: (task) => tasks.push(task),
});
const emailOff = createAuth({
  emailCodes: null,
  securityAlerts: null,
  runInBackground: (task) => tasks.push(task),
});

let ipCounter = 0;
const nextIp = () => {
  ipCounter += 1;
  return `198.51.${Math.floor(ipCounter / 250)}.${(ipCounter % 250) + 1}`;
};
let addressCounter = 0;
const nextAddress = (label: string) => {
  addressCounter += 1;
  return `${prefix}-${label}-${addressCounter}@example.test`;
};

const request = async (
  path: string,
  { body, ip, method = "POST" }: { body?: unknown; ip: string; method?: "GET" | "POST" },
  handler = auth.handler,
) => {
  const response = await handler(
    new Request(`http://localhost:3000/api/auth${path}`, {
      method,
      headers: { "content-type": "application/json", [clientIpHeader]: ip },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );
  await Promise.all(tasks.splice(0));
  return { status: response.status, body: await response.text() };
};

const requestResetCode = (email: string, ip = nextIp()) =>
  request("/email-code/request-password-reset", { body: { email }, ip });

const verifyResetCode = (email: string, code: string) =>
  request("/email-code/verify-password-reset-code", { body: { email, code }, ip: nextIp() });

const resetPassword = (token: string, newPassword: string, handler = auth.handler) =>
  request("/reset-password", { body: { token, newPassword }, ip: nextIp() }, handler);

const resetTokenFor = async (email: string) => {
  await requestResetCode(email);
  const code = sent.findLast((message) => message.to === email)?.code ?? "";
  const verified = await verifyResetCode(email, code);
  expect(verified.status).toBe(200);
  return z.object({ resetToken: z.string() }).parse(JSON.parse(verified.body)).resetToken;
};

const resetTokenRows = (userId: string) =>
  prisma.verification.findMany({ where: { value: userId } });

const createResetToken = async (userId: string) => {
  const token = crypto.randomUUID();
  await (
    await auth.$context
  ).internalAdapter.createVerificationValue({
    identifier: `reset-password:${token}`,
    value: userId,
    expiresAt: new Date(Date.now() + 60_000),
  });
  return token;
};

const createPasswordAccount = async (label: string) => {
  const email = nextAddress(label);
  const signUpToken = await codes.issueToken({ purpose: "sign-up", value: email });
  const result = await auth.api.signUpEmail({
    body: { email, password, name: "Code Tester", signUpToken },
  });
  return { email, userId: result.user.id };
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
  return { email, userId: user.id };
};

const signsInWith = async (email: string, attempt: string) => {
  const result = await request("/sign-in/email", {
    body: { email, password: attempt },
    ip: nextIp(),
  });
  return result.status === 200;
};

const issueCode = async (purpose: EmailCodePurpose, subject: string) => {
  await codes.send({ purpose, subject, to: "owner@example.test" });
  const email = sent.at(-1);
  if (!email) throw new Error("No code was sent");
  return email.code;
};

const wrongCodeFor = (code: string, offset = 1) =>
  ((Number(code) + offset) % 1_000_000).toString().padStart(6, "0");

const spendWrongGuesses = async (purpose: EmailCodePurpose, subject: string, count: number) => {
  let code = "";
  for (let guess = 0; guess < count; guess++) {
    if (guess % emailCodeMaxAttempts === 0) code = await issueCode(purpose, subject);
    expect(await codes.check({ purpose, subject, code: wrongCodeFor(code) })).toEqual({
      valid: false,
      reason: "invalid",
    });
  }
};

const codeRows = (purpose: EmailCodePurpose, subject: string) =>
  prisma.verification.findMany({ where: { identifier: `email-code:${purpose}:${subject}` } });

beforeEach(() => {
  clockMs = Date.now();
  sendFailure = null;
  sendGate = null;
  sent.length = 0;
  accountExistsSent.length = 0;
  googleSignInSent.length = 0;
  alerts.length = 0;
  alertFailure = null;
});

afterAll(async () => {
  if (process.env["OPENBEACON_INTEGRATION"] !== "1") return;
  await prisma.verification.deleteMany({ where: { identifier: { contains: prefix } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: prefix } } });
  await prisma.$disconnect();
});

describe.skipIf(process.env["OPENBEACON_INTEGRATION"] !== "1")("email codes", () => {
  test("a code works once and a reused code is rejected", async () => {
    const subject = nextAddress("reuse");
    const code = await issueCode("sign-up", subject);
    expect(await codes.check({ purpose: "sign-up", subject, code })).toEqual({ valid: true });
    expect(await codes.check({ purpose: "sign-up", subject, code })).toEqual({
      valid: false,
      reason: "invalid",
    });
    expect(await codeRows("sign-up", subject)).toHaveLength(0);
  });

  test("a wrong code is rejected and the right one still works after it", async () => {
    const subject = nextAddress("wrong");
    const code = await issueCode("password-reset", subject);
    for (const attempt of [wrongCodeFor(code), "12345", "abcdef", ` ${code}`]) {
      expect(await codes.check({ purpose: "password-reset", subject, code: attempt })).toEqual({
        valid: false,
        reason: "invalid",
      });
    }
    expect(await codes.check({ purpose: "password-reset", subject, code })).toEqual({
      valid: true,
    });
  });

  test("an expired code is rejected and removed", async () => {
    const subject = nextAddress("expired");
    const code = await issueCode("sign-up", subject);
    clockMs += emailCodeLifetimeMs;
    expect(await codes.check({ purpose: "sign-up", subject, code })).toEqual({
      valid: false,
      reason: "expired",
    });
    expect(await codeRows("sign-up", subject)).toHaveLength(0);
    expect(await codes.check({ purpose: "sign-up", subject, code })).toEqual({
      valid: false,
      reason: "invalid",
    });
  });

  test("a code is still accepted just before it expires", async () => {
    const subject = nextAddress("edge");
    const code = await issueCode("sign-up", subject);
    clockMs += emailCodeLifetimeMs - 1;
    expect(await codes.check({ purpose: "sign-up", subject, code })).toEqual({ valid: true });
  });

  test("too many wrong attempts lock the code, even against the right code", async () => {
    const subject = nextAddress("locked");
    const code = await issueCode("sign-up", subject);
    for (let attempt = 0; attempt < emailCodeMaxAttempts; attempt++) {
      expect(await codes.check({ purpose: "sign-up", subject, code: wrongCodeFor(code) })).toEqual({
        valid: false,
        reason: "invalid",
      });
    }
    expect(await codes.check({ purpose: "sign-up", subject, code })).toEqual({
      valid: false,
      reason: "locked",
    });
    const [row] = await codeRows("sign-up", subject);
    expect(row?.attempts).toBe(emailCodeMaxAttempts);
  });

  test("parallel guesses can't get past the attempt limit", async () => {
    const subject = nextAddress("parallel-guesses");
    const code = await issueCode("sign-up", subject);
    const results = await Promise.all(
      Array.from({ length: 30 }, (_, index) =>
        codes.check({ purpose: "sign-up", subject, code: wrongCodeFor(code, index + 1) }),
      ),
    );
    expect(results.every((result) => !result.valid)).toBe(true);
    const [row] = await codeRows("sign-up", subject);
    expect(row?.attempts).toBeGreaterThanOrEqual(1);
    expect(row?.attempts).toBeLessThanOrEqual(emailCodeMaxAttempts);
  });

  test("parallel submissions of the right code succeed only once", async () => {
    const subject = nextAddress("parallel-right");
    const code = await issueCode("sign-up", subject);
    const results = await Promise.all(
      Array.from({ length: 5 }, () => codes.check({ purpose: "sign-up", subject, code })),
    );
    expect(results.filter((result) => result.valid)).toHaveLength(1);
  });

  test("a code for one purpose can't be used for another", async () => {
    const email = nextAddress("purpose");
    const code = await issueCode("password-reset", email);
    expect(await codes.check({ purpose: "sign-up", subject: email, code })).toEqual({
      valid: false,
      reason: "invalid",
    });
    const userId = `${prefix}-purpose-user`;
    const recoveryCode = await issueCode("recovery-reset", userId);
    expect(
      await codes.check({ purpose: "password-reset", subject: userId, code: recoveryCode }),
    ).toEqual({ valid: false, reason: "invalid" });
    expect(await codes.check({ purpose: "password-reset", subject: email, code })).toEqual({
      valid: true,
    });
    expect(
      await codes.check({ purpose: "recovery-reset", subject: userId, code: recoveryCode }),
    ).toEqual({ valid: true });
  });

  test("a new code replaces the previous one for the same purpose and address", async () => {
    const subject = nextAddress("replaced");
    const first = await issueCode("sign-up", subject);
    const second = await issueCode("sign-up", subject);
    const other = await issueCode("password-reset", subject);
    expect(await codeRows("sign-up", subject)).toHaveLength(1);
    if (first !== second) {
      expect(await codes.check({ purpose: "sign-up", subject, code: first })).toEqual({
        valid: false,
        reason: "invalid",
      });
    }
    expect(await codes.check({ purpose: "sign-up", subject, code: second })).toEqual({
      valid: true,
    });
    expect(await codes.check({ purpose: "password-reset", subject, code: other })).toEqual({
      valid: true,
    });
  });

  test("a new code resets the attempt count", async () => {
    const subject = nextAddress("replaced-locked");
    const first = await issueCode("sign-up", subject);
    for (let attempt = 0; attempt < emailCodeMaxAttempts; attempt++) {
      await codes.check({ purpose: "sign-up", subject, code: wrongCodeFor(first) });
    }
    const second = await issueCode("sign-up", subject);
    expect(await codes.check({ purpose: "sign-up", subject, code: second })).toEqual({
      valid: true,
    });
  });

  test("wrong guesses across several codes are capped", async () => {
    const subject = nextAddress("capped");
    await spendWrongGuesses("password-reset", subject, emailCodeWrongGuessLimit.limit);
    const code = await issueCode("password-reset", subject);
    expect(await codes.check({ purpose: "password-reset", subject, code })).toEqual({
      valid: false,
      reason: "locked",
    });
    const [row] = await codeRows("password-reset", subject);
    expect(row?.attempts).toBe(0);
  });

  test("the cap refills one guess at a time across the day", async () => {
    const subject = nextAddress("capped-refill");
    await spendWrongGuesses("password-reset", subject, emailCodeWrongGuessLimit.limit);
    clockMs += emailCodeWrongGuessLimit.windowMs / emailCodeWrongGuessLimit.limit - 1;
    const code = await issueCode("password-reset", subject);
    expect(await codes.check({ purpose: "password-reset", subject, code })).toEqual({
      valid: false,
      reason: "locked",
    });
    clockMs += 1;
    expect(
      await codes.check({ purpose: "password-reset", subject, code: wrongCodeFor(code) }),
    ).toEqual({ valid: false, reason: "invalid" });
    expect(await codes.check({ purpose: "password-reset", subject, code })).toEqual({
      valid: false,
      reason: "locked",
    });
    const [row] = await codeRows("password-reset", subject);
    expect(row?.attempts).toBe(1);
  });

  test("right codes don't use up the wrong guess allowance", async () => {
    const subject = nextAddress("capped-right");
    await spendWrongGuesses("sign-up", subject, emailCodeWrongGuessLimit.limit - 1);
    for (let round = 0; round < emailCodeWrongGuessLimit.limit; round++) {
      const code = await issueCode("sign-up", subject);
      expect(await codes.check({ purpose: "sign-up", subject, code })).toEqual({ valid: true });
    }
    await spendWrongGuesses("sign-up", subject, 1);
    const code = await issueCode("sign-up", subject);
    expect(await codes.check({ purpose: "sign-up", subject, code })).toEqual({
      valid: false,
      reason: "locked",
    });
  });

  test("parallel guesses can't get past the cap", async () => {
    const subject = nextAddress("capped-parallel");
    await spendWrongGuesses("sign-up", subject, emailCodeWrongGuessLimit.limit - 1);
    const code = await issueCode("sign-up", subject);
    const results = await Promise.all(
      Array.from({ length: 30 }, (_, index) =>
        codes.check({ purpose: "sign-up", subject, code: wrongCodeFor(code, index + 1) }),
      ),
    );
    expect(results.every((result) => !result.valid)).toBe(true);
    const [row] = await codeRows("sign-up", subject);
    expect(row?.attempts).toBe(1);
    expect(await codes.check({ purpose: "sign-up", subject, code })).toEqual({
      valid: false,
      reason: "locked",
    });
  });

  test("a wrong guess counts against the code and fails when the cap can't be recorded", async () => {
    const subject = nextAddress("capped-redis-down");
    const flakyCodes = createEmailCodes({
      db: prisma,
      secret: "integration-email-code-secret-000000000000",
      rateLimits: {
        peek: async ({ limit }) => ({
          allowed: true,
          limit,
          remaining: limit,
          retryAfterMs: 0,
          resetAfterMs: 0,
        }),
        consume: async () => {
          throw new Error("Redis is down");
        },
      },
      limitRequestsPerIp: false,
      sendCodeEmail: async () => {},
      sendAccountExistsEmail: async () => {},
      sendGoogleSignInEmail: async () => {},
      now: () => new Date(clockMs),
    });
    const code = await issueCode("sign-up", subject);
    const errors: unknown[][] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => errors.push(args);
    const wrong = await flakyCodes
      .check({ purpose: "sign-up", subject, code: wrongCodeFor(code) })
      .finally(() => {
        console.error = originalError;
      });
    expect(wrong).toEqual({ valid: false, reason: "invalid" });
    expect(errors).toEqual([["[email-code] could not record a sign-up wrong guess"]]);
    const [row] = await codeRows("sign-up", subject);
    expect(row?.attempts).toBe(1);
  });

  test("the cap only applies to its own purpose and subject", async () => {
    const email = nextAddress("capped-scope");
    const userId = `${prefix}-capped-scope-user`;
    await spendWrongGuesses("password-reset", email, emailCodeWrongGuessLimit.limit);
    await spendWrongGuesses("recovery-reset", userId, emailCodeWrongGuessLimit.limit);
    const signUpCode = await issueCode("sign-up", email);
    expect(await codes.check({ purpose: "sign-up", subject: email, code: signUpCode })).toEqual({
      valid: true,
    });
    const other = nextAddress("capped-scope-other");
    const otherCode = await issueCode("password-reset", other);
    expect(
      await codes.check({ purpose: "password-reset", subject: other, code: otherCode }),
    ).toEqual({ valid: true });
    const otherUserId = `${prefix}-capped-scope-other-user`;
    const recoveryCode = await issueCode("recovery-reset", otherUserId);
    expect(
      await codes.check({ purpose: "recovery-reset", subject: otherUserId, code: recoveryCode }),
    ).toEqual({ valid: true });
    const cappedRecoveryCode = await issueCode("recovery-reset", userId);
    expect(
      await codes.check({ purpose: "recovery-reset", subject: userId, code: cappedRecoveryCode }),
    ).toEqual({ valid: false, reason: "locked" });
  });

  test("parallel requests leave exactly one code", async () => {
    const subject = nextAddress("parallel-issue");
    await Promise.all(
      Array.from({ length: 5 }, () =>
        codes.send({ purpose: "sign-up", subject, to: "owner@example.test" }),
      ),
    );
    const rows = await codeRows("sign-up", subject);
    expect(rows).toHaveLength(1);
  });

  test("email subjects ignore case and surrounding spaces", async () => {
    const subject = nextAddress("case");
    const code = await issueCode("sign-up", `  ${subject.toUpperCase()} `);
    expect(await codes.check({ purpose: "sign-up", subject, code })).toEqual({ valid: true });
  });

  test("a token for one purpose can't be checked or spent as another", async () => {
    const value = `${prefix}-token-purpose`;
    const purposes = Object.keys(emailCodeTokens) as (keyof typeof emailCodeTokens)[];
    for (const purpose of purposes) {
      const token = await codes.issueToken({ purpose, value });
      for (const other of purposes.filter((candidate) => candidate !== purpose)) {
        expect(await codes.hasToken({ purpose: other, token, value })).toBe(false);
        expect(await codes.consumeToken({ purpose: other, token, value })).toBe(false);
      }
      expect(await codes.consumeToken({ purpose, token, value })).toBe(true);
    }
  });

  test("codes are stored as a keyed hash, not the code or its plain SHA-256", async () => {
    const subject = nextAddress("hashed");
    const code = await issueCode("sign-up", subject);
    const [row] = await codeRows("sign-up", subject);
    expect(row?.value).not.toContain(code);
    expect(row?.value).not.toBe(createHash("sha256").update(code).digest("hex"));
    expect(row?.value).toMatch(/^[0-9a-f]{64}$/);
    expect(row?.expiresAt.getTime()).toBe(clockMs + emailCodeLifetimeMs);
  });
});

describe.skipIf(process.env["OPENBEACON_INTEGRATION"] !== "1")("email code rate limits", () => {
  test("an address can request 3 codes per 15 minutes, from any IP", async () => {
    const { email } = await createPasswordAccount("address-limit");
    const allowed = emailCodeRequestLimits.perAddress.limit;
    for (let index = 0; index < allowed; index++) {
      expect((await requestResetCode(email)).status).toBe(200);
    }
    expect(sent).toHaveLength(allowed);
    expect((await requestResetCode(email)).status).toBe(429);
    expect((await requestResetCode(email.toUpperCase())).status).toBe(429);
    expect(sent).toHaveLength(allowed);

    clockMs += emailCodeRequestLimits.perAddress.windowMs / allowed;
    expect((await requestResetCode(email)).status).toBe(200);
    expect((await requestResetCode(email)).status).toBe(429);
    expect(sent).toHaveLength(allowed + 1);
  });

  test("each purpose has its own allowance for an address", async () => {
    const { email } = await createPasswordAccount("purpose-limit");
    for (let index = 0; index < emailCodeRequestLimits.perAddress.limit; index++) {
      expect((await requestSignUpCode(email)).status).toBe(200);
    }
    expect((await requestSignUpCode(email)).status).toBe(429);
    for (let index = 0; index < emailCodeRequestLimits.perAddress.limit; index++) {
      expect((await requestResetCode(email)).status).toBe(200);
    }
    expect((await requestResetCode(email)).status).toBe(429);
    expect(await codes.allowRequest({ purpose: "recovery-reset", email, ip: nextIp() })).toBe(true);
  });

  test("with the IP limit off, one IP can request codes for any number of addresses", async () => {
    const unlimitedCodes = createEmailCodes({
      db: prisma,
      secret: "integration-email-code-secret-000000000000",
      rateLimits: new OpenBeaconCache({
        redisUrl: process.env["REDIS_URL"] ?? "redis://localhost:6379",
        keyPrefix: `test-${crypto.randomUUID()}`,
        now: () => clockMs,
      }).rateLimits,
      limitRequestsPerIp: false,
      sendCodeEmail: async () => {},
      sendAccountExistsEmail: async () => {},
      sendGoogleSignInEmail: async () => {},
      now: () => new Date(clockMs),
    });
    const ip = nextIp();
    const purposes = ["sign-up", "password-reset", "email-verification", "recovery-reset"] as const;
    const results = [];
    for (let index = 0; index < emailCodeRequestLimits.perIp.limit + 5; index++) {
      results.push(
        await unlimitedCodes.allowRequest({
          purpose: purposes[index % purposes.length] ?? "sign-up",
          email: nextAddress("ip-limit-off"),
          ip,
        }),
      );
    }
    expect(results).toHaveLength(25);
    expect(results.every(Boolean)).toBe(true);
  });

  test("with the IP limit on, an IP can request 20 codes per hour across addresses", async () => {
    const ip = nextIp();
    const allowed = emailCodeRequestLimits.perIp.limit;
    for (let index = 0; index < allowed; index++) {
      expect((await requestResetCode(nextAddress("ip-limit"), ip)).status).toBe(200);
    }
    const limited = await requestResetCode(nextAddress("ip-limit"), ip);
    expect(limited.status).toBe(429);
    expect((await requestResetCode(nextAddress("ip-limit"), nextIp())).status).toBe(200);
  });

  test("a blocked IP doesn't use up the address's allowance", async () => {
    const { email } = await createPasswordAccount("ip-first");
    const ip = nextIp();
    for (let index = 0; index < emailCodeRequestLimits.perIp.limit; index++) {
      await requestResetCode(nextAddress("ip-first-filler"), ip);
    }
    for (let index = 0; index < 5; index++) {
      expect((await requestResetCode(email, ip)).status).toBe(429);
    }
    expect((await requestResetCode(email)).status).toBe(200);
    expect(sent.filter((message) => message.to === email)).toHaveLength(1);
  });

  test("unknown and Google-only addresses are limited the same way as password accounts", async () => {
    const { email } = await createPasswordAccount("limit-known");
    const google = await createGoogleOnlyAccount("limit-google");
    const unknown = nextAddress("limit-unknown");
    const known = [];
    const googleOnly = [];
    const missing = [];
    for (let index = 0; index <= emailCodeRequestLimits.perAddress.limit; index++) {
      known.push(await requestResetCode(email));
      googleOnly.push(await requestResetCode(google.email));
      missing.push(await requestResetCode(unknown));
    }
    expect(missing).toEqual(known);
    expect(googleOnly).toEqual(known);
    expect(known.map((response) => response.status)).toEqual([200, 200, 200, 429]);
  });
});

describe.skipIf(process.env["OPENBEACON_INTEGRATION"] !== "1")("password reset codes", () => {
  test("a password account gets a code at its address", async () => {
    const { email, userId } = await createPasswordAccount("reset-sent");
    const response = await requestResetCode(email.toUpperCase());
    expect(response).toEqual({ status: 200, body: JSON.stringify({ success: true }) });
    expect(sent).toEqual([
      { to: email, purpose: "password-reset", code: expect.any(String), userId },
    ]);
    expect(sent[0]?.code).toMatch(/^\d{6}$/);
  });

  test("the response is the same for unknown, Google-only and password accounts", async () => {
    const known = await requestResetCode((await createPasswordAccount("same-password")).email);
    const google = await requestResetCode((await createGoogleOnlyAccount("same-google")).email);
    const unknown = await requestResetCode(nextAddress("same-unknown"));
    expect(google).toEqual(known);
    expect(unknown).toEqual(known);
    expect(sent).toHaveLength(1);
  });

  test("a Google-only account gets a Google sign-in email and no code", async () => {
    const google = await createGoogleOnlyAccount("reset-google");
    await requestResetCode(google.email.toUpperCase());
    expect(googleSignInSent).toEqual([{ to: google.email, userId: google.userId }]);
    expect(sent).toEqual([]);
    expect(accountExistsSent).toEqual([]);
    expect(await codeRows("password-reset", google.email)).toEqual([]);
  });

  test("every request endpoint answers before any email is sent", async () => {
    const passwordAccount = await createPasswordAccount("background-password");
    const googleAccount = await createGoogleOnlyAccount("background-google");
    const unverified = await createUnverifiedAccount("background-unverified");
    const { promise, resolve } = Promise.withResolvers<void>();
    sendGate = promise;
    const requests = [
      { path: "/email-code/request-sign-up-code", body: { email: nextAddress("background-new") } },
      { path: "/email-code/request-sign-up-code", body: { email: passwordAccount.email } },
      { path: "/email-code/request-password-reset", body: { email: passwordAccount.email } },
      { path: "/email-code/request-password-reset", body: { email: googleAccount.email } },
      {
        path: "/email-code/request-email-verification",
        body: { email: unverified.email, password },
      },
    ];

    for (const { path, body } of requests) {
      const response = await auth.handler(
        new Request(`http://localhost:3000/api/auth${path}`, {
          method: "POST",
          headers: { "content-type": "application/json", [clientIpHeader]: nextIp() },
          body: JSON.stringify(body),
        }),
      );
      expect(response.status).toBe(200);
    }
    expect([...sent, ...accountExistsSent, ...googleSignInSent]).toEqual([]);

    resolve();
    await Promise.all(tasks.splice(0));
    expect(sent.map(({ purpose }) => purpose).toSorted()).toEqual([
      "email-verification",
      "password-reset",
      "sign-up",
    ]);
    expect(accountExistsSent).toHaveLength(1);
    expect(googleSignInSent).toHaveLength(1);
  });

  test("password accounts and unknown addresses get no Google sign-in email", async () => {
    await requestResetCode((await createPasswordAccount("reset-no-google")).email);
    await requestResetCode(nextAddress("reset-no-google-unknown"));
    expect(googleSignInSent).toEqual([]);
  });

  test("a failed send doesn't change the response", async () => {
    const { email } = await createPasswordAccount("send-failure");
    const unknown = await requestResetCode(nextAddress("send-failure-unknown"));
    sendFailure = new Error("SMTP could not send email");
    const errors: unknown[][] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => errors.push(args);
    const failed = await requestResetCode(email).finally(() => {
      console.error = originalError;
    });
    expect(failed).toEqual(unknown);
    expect(errors).toEqual([["[email-code] could not send a password-reset email"]]);
  });

  test("the right code gives a reset token that resets the password once", async () => {
    const { email } = await createPasswordAccount("reset-ok");
    await requestResetCode(email);
    const code = sent[0]?.code ?? "";
    const verified = await verifyResetCode(email.toUpperCase(), code);
    expect(verified.status).toBe(200);
    const { resetToken } = z.object({ resetToken: z.string() }).parse(JSON.parse(verified.body));
    expect(JSON.parse((await verifyResetCode(email, code)).body)).toMatchObject({
      code: "INVALID_CODE",
    });

    const newPassword = "a brand new passphrase";
    expect((await resetPassword(resetToken, newPassword)).status).toBe(200);
    expect(await signsInWith(email, newPassword)).toBe(true);
    expect(await signsInWith(email, password)).toBe(false);
    const reused = await resetPassword(resetToken, "yet another passphrase");
    expect(reused.status).toBe(400);
    expect(await signsInWith(email, newPassword)).toBe(true);
  });

  test("every failed code check gives the same error and no reset token", async () => {
    const { email, userId } = await createPasswordAccount("reset-fail");
    const google = await createGoogleOnlyAccount("reset-fail-google");
    await requestResetCode(email);
    const code = sent[0]?.code ?? "";
    const googleCode = await issueCode("password-reset", google.email);
    const signUpCode = await issueCode("sign-up", email);
    const failures = [
      await verifyResetCode(email, wrongCodeFor(code)),
      await verifyResetCode(nextAddress("reset-fail-unknown"), code),
      await verifyResetCode(google.email, googleCode),
      await verifyResetCode(email, signUpCode),
    ];
    expect(failures.map((failure) => failure.status)).toEqual([400, 400, 400, 400]);
    expect(new Set(failures.map((failure) => failure.body)).size).toBe(1);
    expect(JSON.parse(failures[0]?.body ?? "{}")).toMatchObject({ code: "INVALID_CODE" });
    expect(await resetTokenRows(userId)).toEqual([]);
    expect(await resetTokenRows(google.userId)).toEqual([]);
  });

  test("a capped check gives the same error as a wrong code", async () => {
    const { email, userId } = await createPasswordAccount("reset-capped");
    const failures: Awaited<ReturnType<typeof verifyResetCode>>[] = [];
    for (let round = 0; round < emailCodeWrongGuessLimit.limit / emailCodeMaxAttempts; round++) {
      expect((await requestResetCode(email)).status).toBe(200);
      const code = sent.findLast((message) => message.to === email)?.code ?? "";
      for (let guess = 0; guess < emailCodeMaxAttempts; guess++) {
        failures.push(await verifyResetCode(email, wrongCodeFor(code)));
      }
    }
    expect((await requestResetCode(email)).status).toBe(200);
    const capped = await verifyResetCode(
      email,
      sent.findLast((message) => message.to === email)?.code ?? "",
    );
    expect(capped.status).toBe(400);
    expect(new Set([...failures, capped].map((failure) => failure.body)).size).toBe(1);
    expect(await resetTokenRows(userId)).toEqual([]);
  });

  test("an expired code gives no reset token", async () => {
    const { email } = await createPasswordAccount("reset-expired");
    await requestResetCode(email);
    clockMs += emailCodeLifetimeMs;
    expect((await verifyResetCode(email, sent[0]?.code ?? "")).status).toBe(400);
  });

  test("reset tokens are stored as a hash and last 5 minutes", async () => {
    const { email, userId } = await createPasswordAccount("reset-token-stored");
    const token = await resetTokenFor(email);
    const rows = await resetTokenRows(userId);
    expect(rows.map((row) => row.identifier)).toEqual([
      createHash("sha256").update(`reset-password:${token}`).digest("base64url"),
    ]);
    expect(rows[0]?.expiresAt.getTime()).toBe(
      clockMs + emailCodeTokens["password-reset"].lifetimeMs,
    );
  });

  test("an expired reset token can't reset the password", async () => {
    const { email, userId } = await createPasswordAccount("reset-token-expired");
    const token = await resetTokenFor(email);
    await prisma.verification.updateMany({
      where: { value: userId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const result = await resetPassword(token, "a brand new passphrase");
    expect(result.status).toBe(400);
    expect(JSON.parse(result.body)).toMatchObject({ code: "INVALID_TOKEN" });
    expect(await signsInWith(email, password)).toBe(true);
  });

  test("a password that's too short doesn't use up the reset token", async () => {
    const { email } = await createPasswordAccount("reset-short");
    const token = await resetTokenFor(email);
    const short = await resetPassword(token, "short");
    expect(short.status).toBe(400);
    expect(JSON.parse(short.body)).toMatchObject({ code: "PASSWORD_TOO_SHORT" });
    expect((await resetPassword(token, "long enough now")).status).toBe(200);
  });

  test("a reset can't add a password if the account loses its password login first", async () => {
    const { email, userId } = await createPasswordAccount("reset-unlinked");
    await prisma.account.create({
      data: {
        id: `${prefix}-reset-unlinked-google`,
        userId,
        providerId: "google",
        accountId: `${prefix}-reset-unlinked-google`,
      },
    });
    const token = await resetTokenFor(email);
    await prisma.account.deleteMany({ where: { userId, providerId: "credential" } });
    const result = await resetPassword(token, "a brand new passphrase");
    expect(result.status).toBe(400);
    expect(JSON.parse(result.body)).toMatchObject({ code: "PASSWORD_NOT_ALLOWED" });
    expect(
      await prisma.account.findMany({ where: { userId }, select: { providerId: true } }),
    ).toEqual([{ providerId: "google" }]);
  });

  test("a reset token for a Google-only account can't add a password", async () => {
    const google = await createGoogleOnlyAccount("reset-token-google");
    const token = await createResetToken(google.userId);
    const result = await resetPassword(token, "a brand new passphrase");
    expect(JSON.parse(result.body)).toMatchObject({ code: "PASSWORD_NOT_ALLOWED" });
    expect(await prisma.account.count({ where: { userId: google.userId } })).toBe(1);
  });

  test("a reset signs out every session", async () => {
    const { email, userId } = await createPasswordAccount("reset-revokes");
    const cookies = [];
    for (let index = 0; index < 2; index++) {
      const response = await auth.handler(
        new Request("http://localhost:3000/api/auth/sign-in/email", {
          method: "POST",
          headers: { "content-type": "application/json", [clientIpHeader]: nextIp() },
          body: JSON.stringify({ email, password }),
        }),
      );
      expect(response.status).toBe(200);
      cookies.push(response.headers.get("set-cookie")?.split(";")[0] ?? "");
    }
    const sessionFor = async (cookie: string) => {
      const response = await auth.handler(
        new Request("http://localhost:3000/api/auth/get-session", {
          headers: { cookie, [clientIpHeader]: nextIp() },
        }),
      );
      return response.json();
    };
    for (const cookie of cookies) {
      expect(await sessionFor(cookie)).toMatchObject({ user: { id: userId } });
    }

    const reset = await resetPassword(await resetTokenFor(email), "a brand new passphrase");
    expect(reset.status).toBe(200);
    for (const cookie of cookies) {
      expect(await sessionFor(cookie)).toBeNull();
    }
    expect(await prisma.session.count({ where: { userId } })).toBe(0);
  });

  test("a correct reset code marks an unverified account verified, even without a reset", async () => {
    const { email } = await createUnverifiedAccount("reset-verifies");
    await resetTokenFor(email);
    expect((await prisma.user.findUnique({ where: { email } }))?.emailVerified).toBe(true);
    expect(await signsInWith(email, password)).toBe(true);
  });

  test("a wrong reset code leaves an unverified account unverified", async () => {
    const { email } = await createUnverifiedAccount("reset-fail-unverified");
    await requestResetCode(email);
    const result = await verifyResetCode(email, wrongCodeFor(sent[0]?.code ?? ""));
    expect(result.status).toBe(400);
    expect((await prisma.user.findUnique({ where: { email } }))?.emailVerified).toBe(false);
  });
});

describe.skipIf(process.env["OPENBEACON_INTEGRATION"] !== "1")("email routes", () => {
  test("code endpoints return 404 when email is off", async () => {
    const { email } = await createPasswordAccount("email-off");
    const routes: { path: string; body: Record<string, string> }[] = [
      { path: "/email-code/request-sign-up-code", body: { email } },
      { path: "/email-code/verify-sign-up-code", body: { email, code: "000000" } },
      { path: "/email-code/request-email-verification", body: { email, password } },
      { path: "/email-code/verify-email", body: { email, code: "000000" } },
      { path: "/email-code/request-password-reset", body: { email } },
      { path: "/email-code/verify-password-reset-code", body: { email, code: "000000" } },
      { path: "/reset-password", body: { token: "x", newPassword: "a brand new passphrase" } },
    ];
    const responses = await Promise.all(
      routes.map(({ path, body }) => request(path, { body, ip: nextIp() }, emailOff.handler)),
    );
    expect(responses.map((response) => response.status)).toEqual([
      404, 404, 404, 404, 404, 404, 404,
    ]);
  });

  test("better-auth routes that could send email are switched off", async () => {
    const { email, userId } = await createPasswordAccount("disabled-routes");
    const token = await createResetToken(userId);
    const responses = await Promise.all([
      request("/send-verification-email", { body: { email }, ip: nextIp() }),
      request("/verify-email?token=x", { method: "GET", ip: nextIp() }),
      request("/request-password-reset", { body: { email }, ip: nextIp() }),
      request(`/reset-password/${token}?callbackURL=openbeacon://`, {
        method: "GET",
        ip: nextIp(),
      }),
      request("/change-email", { body: { newEmail: nextAddress("new") }, ip: nextIp() }),
      request("/delete-user", { body: {}, ip: nextIp() }),
      request("/delete-user/callback?token=x", { method: "GET", ip: nextIp() }),
    ]);
    expect(responses.map((response) => response.status)).toEqual([
      404, 404, 404, 404, 404, 404, 404,
    ]);
    expect(await signsInWith(email, password)).toBe(true);
  });

  test("better-auth routes that list or sign out other sessions without a fresh sign-in are switched off", async () => {
    const responses = await Promise.all([
      request("/revoke-other-sessions", { body: {}, ip: nextIp() }),
      request("/revoke-sessions", { body: {}, ip: nextIp() }),
      request("/list-sessions", { method: "GET", ip: nextIp() }),
    ]);
    expect(responses.map((response) => response.status)).toEqual([404, 404, 404]);
  });
});

const requestSignUpCode = (email: string, ip = nextIp()) =>
  request("/email-code/request-sign-up-code", { body: { email }, ip });

const signUp = (
  body: { email: string; password: string; name: string; signUpToken?: string },
  handler = auth.handler,
) => request("/sign-up/email", { body, ip: nextIp() }, handler);

const verifiedSignUpToken = async (email: string) => {
  await requestSignUpCode(email);
  const code = sent.findLast((message) => message.to === email)?.code ?? "";
  const verified = await request("/email-code/verify-sign-up-code", {
    body: { email, code },
    ip: nextIp(),
  });
  expect(verified.status).toBe(200);
  const { signUpToken } = z.object({ signUpToken: z.string() }).parse(JSON.parse(verified.body));
  return signUpToken;
};

const createUnverifiedAccount = async (label: string) => {
  const email = nextAddress(label);
  const response = await emailOff.handler(
    new Request("http://localhost:3000/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json", [clientIpHeader]: nextIp() },
      body: JSON.stringify({ email, password, name: "Unverified Tester" }),
    }),
  );
  expect(response.status).toBe(200);
  return { email, cookie: response.headers.get("set-cookie")?.split(";")[0] ?? "" };
};

describe.skipIf(process.env["OPENBEACON_INTEGRATION"] !== "1")("sign-up verification", () => {
  test("a verified address can sign up and the account starts verified", async () => {
    const email = nextAddress("signup-ok");
    const response = await requestSignUpCode(email.toUpperCase());
    expect(response).toEqual({ status: 200, body: JSON.stringify({ success: true }) });
    expect(sent).toEqual([{ to: email, purpose: "sign-up", code: expect.any(String) }]);
    const signUpToken = await verifiedSignUpToken(email);
    const created = await signUp({ email, password, name: "New Tester", signUpToken });
    expect(created.status).toBe(200);
    const user = await prisma.user.findUnique({ where: { email } });
    expect(user?.emailVerified).toBe(true);
    expect(await signsInWith(email, password)).toBe(true);
  });

  test("sign-up without a token is rejected the same way for new and existing addresses", async () => {
    const existing = await createPasswordAccount("signup-no-token-existing");
    const email = nextAddress("signup-no-token");
    const fresh = await signUp({ email, password, name: "New Tester" });
    const taken = await signUp({ email: existing.email, password, name: "New Tester" });
    expect(fresh.status).toBe(400);
    expect(JSON.parse(fresh.body)).toMatchObject({ code: "INVALID_SIGN_UP_TOKEN" });
    expect(taken).toEqual(fresh);
    expect(await prisma.user.count({ where: { email } })).toBe(0);
  });

  test("a token for another address is rejected and stays usable for its own", async () => {
    const owner = nextAddress("signup-owner");
    const other = nextAddress("signup-other");
    const signUpToken = await verifiedSignUpToken(owner);
    const stolen = await signUp({ email: other, password, name: "New Tester", signUpToken });
    expect(stolen.status).toBe(400);
    expect(JSON.parse(stolen.body)).toMatchObject({ code: "INVALID_SIGN_UP_TOKEN" });
    expect(await prisma.user.count({ where: { email: other } })).toBe(0);
    expect((await signUp({ email: owner, password, name: "New Tester", signUpToken })).status).toBe(
      200,
    );
  });

  test("a token works once", async () => {
    const email = nextAddress("signup-reuse");
    const signUpToken = await verifiedSignUpToken(email);
    expect((await signUp({ email, password, name: "New Tester", signUpToken })).status).toBe(200);
    await prisma.user.deleteMany({ where: { email } });
    const reused = await signUp({ email, password, name: "New Tester", signUpToken });
    expect(reused.status).toBe(400);
    expect(JSON.parse(reused.body)).toMatchObject({ code: "INVALID_SIGN_UP_TOKEN" });
    expect(await prisma.user.count({ where: { email } })).toBe(0);
  });

  test("parallel sign-ups with one token create one account", async () => {
    const email = nextAddress("signup-parallel");
    const signUpToken = await verifiedSignUpToken(email);
    const results = await Promise.all(
      Array.from({ length: 3 }, () => signUp({ email, password, name: "New Tester", signUpToken })),
    );
    expect(results.filter((result) => result.status === 200)).toHaveLength(1);
    expect(await prisma.user.count({ where: { email } })).toBe(1);
  });

  test("a token expires", async () => {
    const email = nextAddress("signup-expired");
    const signUpToken = await verifiedSignUpToken(email);
    clockMs += emailCodeTokens["sign-up"].lifetimeMs;
    const expired = await signUp({ email, password, name: "New Tester", signUpToken });
    expect(expired.status).toBe(400);
    expect(await prisma.user.count({ where: { email } })).toBe(0);
  });

  test("a password that's too short doesn't use up the token", async () => {
    const email = nextAddress("signup-short");
    const signUpToken = await verifiedSignUpToken(email);
    const short = await signUp({ email, password: "short", name: "New Tester", signUpToken });
    expect(short.status).toBe(400);
    expect((await signUp({ email, password, name: "New Tester", signUpToken })).status).toBe(200);
  });

  test("a wrong sign-up code gives no token", async () => {
    const email = nextAddress("signup-wrong-code");
    await requestSignUpCode(email);
    const code = sent[0]?.code ?? "";
    const wrong = await request("/email-code/verify-sign-up-code", {
      body: { email, code: wrongCodeFor(code) },
      ip: nextIp(),
    });
    const unknown = await request("/email-code/verify-sign-up-code", {
      body: { email: nextAddress("signup-wrong-unknown"), code },
      ip: nextIp(),
    });
    expect(wrong.status).toBe(400);
    expect(JSON.parse(wrong.body)).toMatchObject({ code: "INVALID_CODE" });
    expect(unknown).toEqual(wrong);
  });

  test("an existing account gets an 'already have an account' email instead of a code", async () => {
    const passwordAccount = await createPasswordAccount("exists-password");
    const googleAccount = await createGoogleOnlyAccount("exists-google");
    const fresh = await requestSignUpCode(nextAddress("exists-new"));
    const withPassword = await requestSignUpCode(passwordAccount.email.toUpperCase());
    const withGoogle = await requestSignUpCode(googleAccount.email);
    expect(withPassword).toEqual(fresh);
    expect(withGoogle).toEqual(fresh);
    expect(sent).toHaveLength(1);
    expect(accountExistsSent).toEqual([
      { to: passwordAccount.email, userId: passwordAccount.userId, hasPassword: true },
      { to: googleAccount.email, userId: googleAccount.userId, hasPassword: false },
    ]);
    const tryCode = await request("/email-code/verify-sign-up-code", {
      body: { email: passwordAccount.email, code: sent[0]?.code ?? "" },
      ip: nextIp(),
    });
    expect(tryCode.status).toBe(400);
  });

  test("existing and new addresses are rate limited the same way", async () => {
    const { email } = await createPasswordAccount("signup-limit-known");
    const unknown = nextAddress("signup-limit-unknown");
    const known = [];
    const missing = [];
    for (let index = 0; index <= emailCodeRequestLimits.perAddress.limit; index++) {
      known.push(await requestSignUpCode(email));
      missing.push(await requestSignUpCode(unknown));
    }
    expect(missing).toEqual(known);
    expect(known.map((response) => response.status)).toEqual([200, 200, 200, 429]);
  });

  test("with email off, sign-up works without a token and signs in straight away", async () => {
    const email = nextAddress("signup-email-off");
    const created = await signUp({ email, password, name: "New Tester" }, emailOff.handler);
    expect(created.status).toBe(200);
    expect(JSON.parse(created.body)).toMatchObject({ token: expect.any(String) });
    const user = await prisma.user.findUnique({ where: { email } });
    expect(user?.emailVerified).toBe(false);
    const signedIn = await request(
      "/sign-in/email",
      { body: { email, password }, ip: nextIp() },
      emailOff.handler,
    );
    expect(signedIn.status).toBe(200);
  });
});

describe.skipIf(process.env["OPENBEACON_INTEGRATION"] !== "1")("unverified accounts", () => {
  test("verify with a code at their next sign-in", async () => {
    const { email } = await createUnverifiedAccount("unverified-sign-in");
    const blocked = await request("/sign-in/email", { body: { email, password }, ip: nextIp() });
    expect(blocked.status).toBe(403);
    expect(JSON.parse(blocked.body)).toMatchObject({ code: "EMAIL_NOT_VERIFIED" });

    const requested = await request("/email-code/request-email-verification", {
      body: { email, password },
      ip: nextIp(),
    });
    expect(requested).toEqual({ status: 200, body: JSON.stringify({ success: true }) });
    expect(sent).toEqual([
      {
        to: email,
        purpose: "email-verification",
        code: expect.any(String),
        userId: expect.any(String),
      },
    ]);
    const code = sent[0]?.code ?? "";
    const wrong = await request("/email-code/verify-email", {
      body: { email, code: wrongCodeFor(code) },
      ip: nextIp(),
    });
    expect(JSON.parse(wrong.body)).toMatchObject({ code: "INVALID_CODE" });
    const verified = await request("/email-code/verify-email", {
      body: { email, code },
      ip: nextIp(),
    });
    expect(verified.status).toBe(200);
    expect(await signsInWith(email, password)).toBe(true);
  });

  test("a wrong password gets the usual error, not the verification one", async () => {
    const { email } = await createUnverifiedAccount("unverified-wrong-password");
    const result = await request("/sign-in/email", {
      body: { email, password: "not the password" },
      ip: nextIp(),
    });
    expect(result.status).toBe(401);
  });

  test("only an unverified account with the right password gets a verification code", async () => {
    const unverified = await createUnverifiedAccount("verify-only-unverified");
    const attempts = [
      { email: unverified.email, password },
      { email: unverified.email, password: "not the password" },
      { email: unverified.email.toUpperCase(), password: "x".repeat(200) },
      { email: (await createPasswordAccount("verify-only-verified")).email, password },
      { email: (await createGoogleOnlyAccount("verify-only-google")).email, password },
      { email: nextAddress("verify-only-unknown"), password },
    ];
    const responses = await Promise.all(
      attempts.map((body) =>
        request("/email-code/request-email-verification", { body, ip: nextIp() }),
      ),
    );
    expect(new Set(responses.map((response) => JSON.stringify(response))).size).toBe(1);
    expect(sent.map((message) => message.to)).toEqual([unverified.email]);
  });

  test("keep their existing sessions when email is switched on", async () => {
    const { cookie } = await createUnverifiedAccount("unverified-session");
    const response = await auth.handler(
      new Request("http://localhost:3000/api/auth/get-session", {
        headers: { cookie, [clientIpHeader]: nextIp() },
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ user: { emailVerified: false } });
  });
});

describe.skipIf(process.env["OPENBEACON_INTEGRATION"] !== "1")("password alerts", () => {
  const signIn = async (email: string) => {
    const response = await auth.handler(
      new Request("http://localhost:3000/api/auth/sign-in/email", {
        method: "POST",
        headers: { "content-type": "application/json", [clientIpHeader]: nextIp() },
        body: JSON.stringify({ email, password }),
      }),
    );
    return response.headers.get("set-cookie")?.split(";")[0] ?? "";
  };

  const changePassword = async (cookie: string, currentPassword: string) => {
    const response = await auth.handler(
      new Request("http://localhost:3000/api/auth/change-password", {
        method: "POST",
        headers: { "content-type": "application/json", cookie, [clientIpHeader]: nextIp() },
        body: JSON.stringify({ currentPassword, newPassword: "a brand new passphrase" }),
      }),
    );
    await Promise.all(tasks.splice(0));
    return response.status;
  };

  test("a reset sends one alert, even with every optional alert turned off", async () => {
    const { email, userId } = await createPasswordAccount("reset-alert");
    await prisma.user.update({
      where: { id: userId },
      data: { alertNewDevice: false, alertDeletionScheduled: false },
    });

    expect((await resetPassword(await resetTokenFor(email), "a brand new passphrase")).status).toBe(
      200,
    );
    expect(alerts).toEqual([{ to: email, userId, alert: { type: "password-reset" } }]);
  });

  test("a password change sends one alert", async () => {
    const { email, userId } = await createPasswordAccount("change-alert");

    expect(await changePassword(await signIn(email), password)).toBe(200);
    expect(alerts).toEqual([{ to: email, userId, alert: { type: "password-changed" } }]);
  });

  test("a failed password change sends no alert", async () => {
    const { email } = await createPasswordAccount("change-alert-wrong");

    expect(await changePassword(await signIn(email), "not the password")).toBe(400);
    expect(alerts).toEqual([]);
  });

  test("a failed alert doesn't fail the change or the reset", async () => {
    const { email } = await createPasswordAccount("alert-failure");
    alertFailure = new Error("SMTP is down");

    expect(await changePassword(await signIn(email), password)).toBe(200);
    expect((await resetPassword(await resetTokenFor(email), "another new passphrase")).status).toBe(
      200,
    );
    expect(await signsInWith(email, "another new passphrase")).toBe(true);
  });
});
