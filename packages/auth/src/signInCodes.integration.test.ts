import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { createIntegrationTestCache } from "@openbeacon/cache/integration";
import { prisma } from "@openbeacon/database";
import type { EmailCodePurpose } from "@openbeacon/email";
import { signInCodeHeader, signInTokenHeader } from "@openbeacon/shared";
import { z } from "zod";
import { clientIpHeader, createAuth } from "./createAuth.ts";
import {
  createEmailCodes,
  emailCodeMaxAttempts,
  emailCodeRequestLimits,
  emailCodeWrongGuessLimit,
} from "./emailCode.ts";
import { passwordFailureLimit } from "./passwordAttempts.ts";

const prefix = `sign-in-codes-${crypto.randomUUID()}`;
const password = "correct horse battery";
let clockMs = Date.now();
const sent: { to: string; purpose: EmailCodePurpose; code: string }[] = [];
const tasks: Promise<unknown>[] = [];

const rateLimits = createIntegrationTestCache(() => clockMs).rateLimits;
const codes = createEmailCodes({
  minCheckMs: 0,
  db: prisma,
  secret: "integration-sign-in-code-secret-0000000000",
  rateLimits,
  sendCodeEmail: async (email) => {
    sent.push(email);
  },
  sendAccountExistsEmail: async () => {},
  sendGoogleSignInEmail: async () => {},
  now: () => new Date(clockMs),
});
const auth = createAuth({
  emailCodes: codes,
  securityAlerts: null,
  rateLimits,
  runInBackground: (task) => tasks.push(task),
});
const emailOff = createAuth({
  emailCodes: null,
  securityAlerts: null,
  rateLimits,
  runInBackground: (task) => tasks.push(task),
});

let ipCounter = 0;
const nextIp = () => {
  ipCounter += 1;
  return `203.0.${Math.floor(ipCounter / 250)}.${(ipCounter % 250) + 1}`;
};

const post = async (
  path: string,
  body: unknown,
  {
    headers = {},
    handler = auth.handler,
  }: { headers?: Record<string, string>; handler?: (request: Request) => Promise<Response> } = {},
) => {
  const response = await handler(
    new Request(`http://localhost:3000/api/auth${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", [clientIpHeader]: nextIp(), ...headers },
      body: JSON.stringify(body),
    }),
  );
  await Promise.all(tasks.splice(0));
  const text = await response.text();
  return {
    status: response.status,
    body: text ? (JSON.parse(text) as Record<string, unknown>) : null,
    cookie: response.headers.get("set-cookie")?.split(";")[0] ?? null,
  };
};

const signIn = (
  email: string,
  options: {
    attempt?: string;
    code?: string;
    signInToken?: string;
    cookie?: string;
    handler?: (request: Request) => Promise<Response>;
  } = {},
) =>
  post(
    "/sign-in/email",
    { email, password: options.attempt ?? password },
    {
      headers: {
        ...(options.code ? { [signInCodeHeader]: options.code } : {}),
        ...(options.signInToken ? { [signInTokenHeader]: options.signInToken } : {}),
        ...(options.cookie ? { cookie: options.cookie, origin: "http://localhost:3000" } : {}),
      },
      ...(options.handler ? { handler: options.handler } : {}),
    },
  );

const latestSignInCode = (email: string) =>
  sent.findLast((message) => message.to === email && message.purpose === "sign-in")?.code ?? "";

const wrongCodeFor = (code: string) => ((Number(code) + 1) % 1_000_000).toString().padStart(6, "0");

let accountCounter = 0;
const createAccount = async (label: string, signInCodes = true) => {
  accountCounter += 1;
  const email = `${prefix}-${label}-${accountCounter}@example.test`;
  const signUpToken = await codes.issueToken({ purpose: "sign-up", value: email });
  const result = await auth.api.signUpEmail({
    body: { email, password, name: "Code Tester", signUpToken },
  });
  await prisma.session.deleteMany({ where: { userId: result.user.id } });
  await prisma.user.update({ where: { id: result.user.id }, data: { signInCodes } });
  return { email, userId: result.user.id };
};

const signInWithCode = async (email: string) => {
  expect((await signIn(email)).status).toBe(403);
  const signedIn = await signIn(email, { code: latestSignInCode(email) });
  expect(signedIn.status).toBe(200);
  return signedIn;
};

const linkDevice = async (
  userId: string,
  cookie: string,
  state: "active" | "pending" | "revoked" = "active",
) => {
  const token = decodeURIComponent(cookie.split("=")[1] ?? "").split(".")[0] ?? "";
  const device = await prisma.userDevice.create({
    data: {
      id: `${prefix}-device-${crypto.randomUUID()}`,
      userId,
      publicKey: "key",
      publicKeyAlgorithm: "test",
      name: "Pixel 8",
      icon: "phone",
      activatedAt: state === "pending" ? null : new Date(),
      revokedAt: state === "revoked" ? new Date() : null,
    },
  });
  await prisma.session.update({ where: { token }, data: { deviceId: device.id } });
  return device.id;
};

beforeEach(() => {
  clockMs = Date.now();
  sent.length = 0;
});

afterAll(async () => {
  if (process.env["OPENBEACON_INTEGRATION"] !== "1") return;
  await prisma.user.deleteMany({ where: { email: { startsWith: prefix } } });
  await prisma.$disconnect();
});

describe.skipIf(process.env["OPENBEACON_INTEGRATION"] !== "1")("sign-in codes", () => {
  test("an account with codes off signs in with just its password and gets no email", async () => {
    const { email } = await createAccount("off", false);
    expect((await signIn(email)).status).toBe(200);
    expect(sent).toEqual([]);
  });

  test("the right password emails a code and creates no session", async () => {
    const { email, userId } = await createAccount("required");
    const result = await signIn(email);
    expect(result.status).toBe(403);
    expect(result.body).toMatchObject({ code: "SIGN_IN_CODE_REQUIRED", codeSent: true });
    expect(result.cookie).toBeNull();
    expect(sent).toEqual([expect.objectContaining({ to: email, purpose: "sign-in" })]);
    expect(await prisma.session.count({ where: { userId } })).toBe(0);
  });

  test("a wrong password sends no code", async () => {
    const { email } = await createAccount("wrong-password");
    const result = await signIn(email, { attempt: "not the password" });
    expect(result.status).toBe(401);
    expect(sent).toEqual([]);
  });

  test("the emailed code sent with the password signs in once", async () => {
    const { email, userId } = await createAccount("code");
    await signIn(email);
    const code = latestSignInCode(email);
    expect((await signIn(email, { code })).status).toBe(200);
    expect(await prisma.session.count({ where: { userId } })).toBe(1);

    const reused = await signIn(email, { code });
    expect(reused.status).toBe(400);
    expect(reused.body).toMatchObject({ code: "INVALID_CODE" });
  });

  test("a code still needs the right password", async () => {
    const { email } = await createAccount("code-password");
    await signIn(email);
    const code = latestSignInCode(email);
    expect((await signIn(email, { code, attempt: "not the password" })).status).toBe(401);
    expect((await signIn(email, { code })).status).toBe(200);
  });

  test("a code for one account doesn't sign in another", async () => {
    const first = await createAccount("code-owner");
    const second = await createAccount("code-other");
    await signIn(first.email);
    const code = latestSignInCode(first.email);
    const other = await signIn(second.email, { code });
    expect(other.status).toBe(400);
    expect(other.body).toMatchObject({ code: "INVALID_CODE" });
    expect((await signIn(first.email, { code })).status).toBe(200);
  });

  test("a wrong code is refused and sends no new code", async () => {
    const { email, userId } = await createAccount("wrong-code");
    await signIn(email);
    const code = latestSignInCode(email);
    sent.length = 0;
    const result = await signIn(email, { code: wrongCodeFor(code) });
    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({ code: "INVALID_CODE" });
    expect(result.cookie).toBeNull();
    expect(sent).toEqual([]);
    expect(await prisma.session.count({ where: { userId } })).toBe(0);
    expect((await signIn(email, { code })).status).toBe(200);
  });

  test("guesses without the password don't use up the owner's code", async () => {
    const { email } = await createAccount("guesser");
    await signIn(email);
    const code = latestSignInCode(email);
    for (let attempt = 0; attempt <= emailCodeMaxAttempts; attempt++) {
      const guess = await signIn(email, { code: wrongCodeFor(code), attempt: "not the password" });
      expect(guess.status).toBe(401);
    }
    expect((await signIn(email, { code })).status).toBe(200);
  });

  test("after the daily wrong guess limit, which needs the password, the right code is refused", async () => {
    const { email } = await createAccount("guess-limit");
    let guesses = 0;
    while (guesses < emailCodeWrongGuessLimit.limit) {
      clockMs += emailCodeRequestLimits.perAddress.windowMs;
      expect((await signIn(email)).body).toMatchObject({ codeSent: true });
      const code = latestSignInCode(email);
      for (let attempt = 0; attempt < emailCodeMaxAttempts; attempt++) {
        expect((await signIn(email, { code: wrongCodeFor(code) })).status).toBe(400);
        guesses += 1;
      }
    }
    clockMs += emailCodeRequestLimits.perAddress.windowMs;
    expect((await signIn(email)).body).toMatchObject({ codeSent: true });
    const refused = await signIn(email, { code: latestSignInCode(email) });
    expect(refused.status).toBe(400);
    expect(refused.body).toMatchObject({ code: "INVALID_CODE" });
  });

  test("a wrong code doesn't use up password attempts", async () => {
    const { email } = await createAccount("code-attempts");
    await signIn(email);
    const code = latestSignInCode(email);
    for (let attempt = 0; attempt <= passwordFailureLimit.limit; attempt++) {
      expect((await signIn(email, { code: wrongCodeFor(code) })).body).toMatchObject({
        code: "INVALID_CODE",
      });
    }
    expect((await signIn(email)).body).toMatchObject({ code: "SIGN_IN_CODE_REQUIRED" });
  });

  test("past the request limit the app is still asked for a code, but none is sent", async () => {
    const { email } = await createAccount("limited");
    for (let attempt = 0; attempt < emailCodeRequestLimits.perAddress.limit; attempt++) {
      expect((await signIn(email)).body).toMatchObject({ codeSent: true });
    }
    const limited = await signIn(email);
    expect(limited.status).toBe(403);
    expect(limited.body).toMatchObject({ code: "SIGN_IN_CODE_REQUIRED", codeSent: false });
    expect(sent).toHaveLength(emailCodeRequestLimits.perAddress.limit);
    expect((await signIn(email, { code: latestSignInCode(email) })).status).toBe(200);
  });

  test("asking for a code doesn't use up password attempts", async () => {
    const { email } = await createAccount("attempts");
    for (let attempt = 0; attempt < 12; attempt++) {
      expect((await signIn(email)).body).toMatchObject({ code: "SIGN_IN_CODE_REQUIRED" });
    }
  });

  test("a code-required attempt doesn't cancel a scheduled deletion", async () => {
    const { email, userId } = await createAccount("deletion");
    const deletionDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await prisma.user.update({
      where: { id: userId },
      data: { pendingDeletion: true, deletionDate },
    });
    expect((await signIn(email)).status).toBe(403);
    expect(
      await prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { pendingDeletion: true, deletionCancellationPending: true },
      }),
    ).toEqual({ pendingDeletion: true, deletionCancellationPending: false });
  });

  test("confirming it's you from an active phone needs only the password", async () => {
    const { email, userId } = await createAccount("reconfirm");
    const first = await signInWithCode(email);
    await linkDevice(userId, first.cookie ?? "");
    sent.length = 0;
    const again = await signIn(email, { cookie: first.cookie ?? "" });
    expect(again.status).toBe(200);
    expect(sent).toEqual([]);
  });

  test("a session from a phone that isn't set up still needs a code", async () => {
    const { email, userId } = await createAccount("reconfirm-pending");
    const first = await signInWithCode(email);
    await linkDevice(userId, first.cookie ?? "", "pending");
    expect((await signIn(email, { cookie: first.cookie ?? "" })).body).toMatchObject({
      code: "SIGN_IN_CODE_REQUIRED",
    });
  });

  test("a session from a revoked phone still needs a code", async () => {
    const { email, userId } = await createAccount("reconfirm-revoked");
    const first = await signInWithCode(email);
    await linkDevice(userId, first.cookie ?? "", "revoked");
    sent.length = 0;
    const again = await signIn(email, { cookie: first.cookie ?? "" });
    expect(again.status).toBe(403);
    expect(again.body).toMatchObject({ code: "SIGN_IN_CODE_REQUIRED" });
  });

  test("another account's session doesn't skip the code", async () => {
    const owner = await createAccount("reconfirm-owner");
    const other = await createAccount("reconfirm-other", false);
    const otherSession = await signIn(other.email);
    await linkDevice(other.userId, otherSession.cookie ?? "");
    expect((await signIn(owner.email, { cookie: otherSession.cookie ?? "" })).body).toMatchObject({
      code: "SIGN_IN_CODE_REQUIRED",
    });
  });

  test("with email off, sign-in is refused instead of skipping the code", async () => {
    const { email, userId } = await createAccount("email-off");
    const result = await signIn(email, { handler: emailOff.handler });
    expect(result.status).toBe(403);
    expect(result.body).toMatchObject({ code: "SIGN_IN_CODES_UNAVAILABLE" });
    expect(await prisma.session.count({ where: { userId } })).toBe(0);
  });

  test("a password reset code also gives a sign-in token", async () => {
    const { email } = await createAccount("reset");
    await post("/email-code/request-password-reset", { email });
    const code = sent.findLast((message) => message.purpose === "password-reset")?.code ?? "";
    const verified = await post("/email-code/verify-password-reset-code", { email, code });
    const { resetToken, signInToken } = z
      .object({ resetToken: z.string(), signInToken: z.string() })
      .parse(verified.body);
    const newPassword = "a brand new passphrase";
    expect((await post("/reset-password", { token: resetToken, newPassword })).status).toBe(200);
    const signedIn = await signIn(email, { attempt: newPassword, signInToken });
    expect(signedIn.status).toBe(200);
    expect(sent.filter((message) => message.purpose === "sign-in")).toEqual([]);
    const reused = await signIn(email, { attempt: newPassword, signInToken });
    expect(reused.status).toBe(403);
    expect(reused.body).toMatchObject({ code: "SIGN_IN_CODE_REQUIRED" });
  });

  test("a password reset code gives no sign-in token when codes are off", async () => {
    const { email } = await createAccount("reset-off", false);
    await post("/email-code/request-password-reset", { email });
    const code = sent.findLast((message) => message.purpose === "password-reset")?.code ?? "";
    const verified = await post("/email-code/verify-password-reset-code", { email, code });
    expect(verified.body).not.toHaveProperty("signInToken");
  });
});
