import { afterAll, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { createHash } from "node:crypto";
import { OpenBeaconCache } from "@openbeacon/cache";
import { FakeRedis } from "@openbeacon/cache/testing";
import { prisma } from "@openbeacon/database";
import type { EmailCodePurpose } from "@openbeacon/email";
import { clientIpHeader, createAuth } from "./createAuth.ts";
import {
  createEmailCodes,
  emailCodeLifetimeMs,
  emailCodeMaxAttempts,
  emailCodeRequestLimits,
} from "./emailCode.ts";

class TestCache extends OpenBeaconCache {
  protected override createRedisClient(): FakeRedis {
    return new FakeRedis();
  }
}

const prefix = `email-code-${crypto.randomUUID()}`;
const password = "correct horse battery";
let clockMs = Date.now();
let sendFailure: Error | null = null;
const sent: { to: string; purpose: EmailCodePurpose; code: string; userId?: string }[] = [];
const tasks: Promise<unknown>[] = [];

const codes = createEmailCodes({
  db: prisma,
  secret: "integration-email-code-secret-000000000000",
  rateLimits: new TestCache({ redisUrl: "redis://localhost:6379", now: () => clockMs }).rateLimits,
  sendCodeEmail: async (email) => {
    if (sendFailure) throw sendFailure;
    sent.push(email);
  },
  now: () => new Date(clockMs),
});
const auth = createAuth({ emailCodes: codes, runInBackground: (task) => tasks.push(task) });

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

const resetWithCode = (body: { email: string; code: string; newPassword: string }) =>
  request("/email-code/reset-password", { body, ip: nextIp() });

const createPasswordAccount = async (label: string) => {
  const email = nextAddress(label);
  const result = await auth.api.signUpEmail({ body: { email, password, name: "Code Tester" } });
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

const wrongCodeFor = (code: string) => ((Number(code) + 1) % 1_000_000).toString().padStart(6, "0");

const codeRows = (purpose: EmailCodePurpose, subject: string) =>
  prisma.verification.findMany({ where: { identifier: `email-code:${purpose}:${subject}` } });

beforeEach(() => {
  clockMs = Date.now();
  sendFailure = null;
  sent.length = 0;
});

afterAll(async () => {
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
    const guesses = Array.from({ length: 30 }, (_, index) =>
      ((Number(code) + index + 1) % 1_000_000).toString().padStart(6, "0"),
    );
    const results = await Promise.all(
      guesses.map((guess) => codes.check({ purpose: "sign-up", subject, code: guess })),
    );
    expect(
      results.filter((result) => result.valid === false && result.reason === "invalid"),
    ).toHaveLength(emailCodeMaxAttempts);
    const [row] = await codeRows("sign-up", subject);
    expect(row?.attempts).toBe(emailCodeMaxAttempts);
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

  test("codes are stored as a keyed hash, not the code or its plain SHA-256", async () => {
    const subject = nextAddress("hashed");
    const code = await issueCode("sign-up", subject);
    const [row] = await codeRows("sign-up", subject);
    expect(row?.value).not.toContain(code);
    expect(row?.value).not.toBe(createHash("sha256").update(code).digest("hex"));
    expect(row?.value).toMatch(/^[0-9a-f]{64}$/);
    expect(row?.expiresAt.getTime()).toBe(clockMs + emailCodeLifetimeMs);
  });

  test("a code checked in a transaction that rolls back can be used again", async () => {
    const subject = `${prefix}-rollback-user`;
    const code = await issueCode("recovery-reset", subject);
    await prisma
      .$transaction(async (tx) => {
        expect(await codes.check({ purpose: "recovery-reset", subject, code, tx })).toEqual({
          valid: true,
        });
        throw new Error("version conflict");
      })
      .catch(() => {});
    expect(await codes.check({ purpose: "recovery-reset", subject, code })).toEqual({
      valid: true,
    });
  });

  test("wrong attempts made inside a transaction that rolls back still count", async () => {
    const subject = `${prefix}-rollback-attempts-user`;
    const code = await issueCode("recovery-reset", subject);
    for (let attempt = 0; attempt < emailCodeMaxAttempts; attempt++) {
      await prisma
        .$transaction(async (tx) => {
          await codes.check({ purpose: "recovery-reset", subject, code: wrongCodeFor(code), tx });
          throw new Error("rolled back");
        })
        .catch(() => {});
    }
    expect(await codes.check({ purpose: "recovery-reset", subject, code })).toEqual({
      valid: false,
      reason: "locked",
    });
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

  test("an IP can request 20 codes per hour across addresses", async () => {
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

  test("unknown addresses are limited the same way as real ones", async () => {
    const { email } = await createPasswordAccount("limit-known");
    const unknown = nextAddress("limit-unknown");
    const known = [];
    const missing = [];
    for (let index = 0; index <= emailCodeRequestLimits.perAddress.limit; index++) {
      known.push(await requestResetCode(email));
      missing.push(await requestResetCode(unknown));
    }
    expect(missing).toEqual(known);
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
    expect(errors).toEqual([["[email-code] could not send a password reset code"]]);
  });

  test("the right code resets the password once", async () => {
    const { email, userId } = await createPasswordAccount("reset-ok");
    await requestResetCode(email);
    const code = sent[0]?.code ?? "";
    const newPassword = "a brand new passphrase";
    expect((await resetWithCode({ email, code, newPassword })).status).toBe(200);
    expect(await signsInWith(email, newPassword)).toBe(true);
    expect(await signsInWith(email, password)).toBe(false);
    const reused = await resetWithCode({ email, code, newPassword: "yet another passphrase" });
    expect(reused.status).toBe(400);
    expect(await signsInWith(email, newPassword)).toBe(true);
    expect(
      await prisma.verification.count({
        where: { identifier: { startsWith: "reset-password:" }, value: userId },
      }),
    ).toBe(0);
  });

  test("every failed reset gives the same error and leaves the password alone", async () => {
    const { email } = await createPasswordAccount("reset-fail");
    const google = await createGoogleOnlyAccount("reset-fail-google");
    await requestResetCode(email);
    const code = sent[0]?.code ?? "";
    const newPassword = "a brand new passphrase";
    const googleCode = await issueCode("password-reset", google.email);
    const signUpCode = await issueCode("sign-up", email);
    const failures = [
      await resetWithCode({ email, code: wrongCodeFor(code), newPassword }),
      await resetWithCode({ email: nextAddress("reset-fail-unknown"), code, newPassword }),
      await resetWithCode({ email: google.email, code: googleCode, newPassword }),
      await resetWithCode({ email, code: signUpCode, newPassword }),
    ];
    expect(failures.map((failure) => failure.status)).toEqual([400, 400, 400, 400]);
    expect(new Set(failures.map((failure) => failure.body)).size).toBe(1);
    expect(JSON.parse(failures[0]?.body ?? "{}")).toMatchObject({ code: "INVALID_CODE" });
    expect(await signsInWith(email, password)).toBe(true);
    expect(await prisma.account.count({ where: { userId: google.userId } })).toBe(1);
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
    await requestResetCode(email);
    const findUserByEmail = (await auth.$context).internalAdapter.findUserByEmail;
    const unlinkAfterLookup = spyOn(
      (await auth.$context).internalAdapter,
      "findUserByEmail",
    ).mockImplementation(async (...args) => {
      const user = await findUserByEmail(...args);
      await prisma.account.deleteMany({ where: { userId, providerId: "credential" } });
      return user;
    });
    const result = await resetWithCode({
      email,
      code: sent[0]?.code ?? "",
      newPassword: "a brand new passphrase",
    }).finally(() => unlinkAfterLookup.mockRestore());
    expect(result.status).toBe(400);
    expect(JSON.parse(result.body)).toMatchObject({ code: "PASSWORD_NOT_ALLOWED" });
    expect(
      await prisma.account.findMany({ where: { userId }, select: { providerId: true } }),
    ).toEqual([{ providerId: "google" }]);
  });

  test("a reset token for a Google-only account can't add a password", async () => {
    const google = await createGoogleOnlyAccount("reset-token-google");
    const token = crypto.randomUUID();
    await prisma.verification.create({
      data: {
        id: `${prefix}-reset-token-google`,
        identifier: `reset-password:${token}`,
        value: google.userId,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    await expect(
      auth.api.resetPassword({ body: { token, newPassword: "a brand new passphrase" } }),
    ).rejects.toMatchObject({ body: { code: "PASSWORD_NOT_ALLOWED" } });
    expect(await prisma.account.count({ where: { userId: google.userId } })).toBe(1);
  });

  test("an expired code can't reset the password", async () => {
    const { email } = await createPasswordAccount("reset-expired");
    await requestResetCode(email);
    clockMs += emailCodeLifetimeMs;
    const result = await resetWithCode({
      email,
      code: sent[0]?.code ?? "",
      newPassword: "a brand new passphrase",
    });
    expect(result.status).toBe(400);
    expect(await signsInWith(email, password)).toBe(true);
  });

  test("a password that's too short doesn't use up the code", async () => {
    const { email } = await createPasswordAccount("reset-short");
    await requestResetCode(email);
    const code = sent[0]?.code ?? "";
    const short = await resetWithCode({ email, code, newPassword: "short" });
    expect(short.status).toBe(400);
    expect(JSON.parse(short.body)).toMatchObject({ code: "PASSWORD_TOO_SHORT" });
    expect((await resetWithCode({ email, code, newPassword: "long enough now" })).status).toBe(200);
  });
});

describe.skipIf(process.env["OPENBEACON_INTEGRATION"] !== "1")("email routes", () => {
  test("code endpoints return 404 when email is off", async () => {
    const { email } = await createPasswordAccount("email-off");
    const off = createAuth({ emailCodes: null, runInBackground: (task) => tasks.push(task) });
    const requested = await request(
      "/email-code/request-password-reset",
      { body: { email }, ip: nextIp() },
      off.handler,
    );
    const reset = await request(
      "/email-code/reset-password",
      { body: { email, code: "000000", newPassword: "a brand new passphrase" }, ip: nextIp() },
      off.handler,
    );
    expect([requested.status, reset.status]).toEqual([404, 404]);
  });

  test("better-auth routes that could send email are switched off", async () => {
    const { email } = await createPasswordAccount("disabled-routes");
    const token = crypto.randomUUID();
    await prisma.verification.create({
      data: {
        id: `${prefix}-callback`,
        identifier: `reset-password:${token}`,
        value: "unused",
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    const responses = await Promise.all([
      request("/send-verification-email", { body: { email }, ip: nextIp() }),
      request("/verify-email?token=x", { method: "GET", ip: nextIp() }),
      request("/request-password-reset", { body: { email }, ip: nextIp() }),
      request("/reset-password", {
        body: { token, newPassword: "a brand new passphrase" },
        ip: nextIp(),
      }),
      request(`/reset-password/${token}?callbackURL=openbeacon://`, {
        method: "GET",
        ip: nextIp(),
      }),
      request("/change-email", { body: { newEmail: nextAddress("new") }, ip: nextIp() }),
      request("/delete-user", { body: {}, ip: nextIp() }),
      request("/delete-user/callback?token=x", { method: "GET", ip: nextIp() }),
    ]);
    expect(responses.map((response) => response.status)).toEqual([
      404, 404, 404, 404, 404, 404, 404, 404,
    ]);
    expect(await signsInWith(email, password)).toBe(true);
  });
});
