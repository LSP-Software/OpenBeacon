import { describe, expect, mock, test } from "bun:test";

mock.module("./auth-client.ts", () => ({ authClient: { $fetch: () => undefined } }));

const {
  codeEntryErrorMessage,
  emailCodeErrorMessage,
  invalidCodeMessage,
  noCodeRejections,
  readSignInError,
  recordCodeRejection,
  recordNewCode,
  signInCodeEntryError,
} = await import("./emailCodes.ts");

describe("emailCodeErrorMessage", () => {
  test("tells the user to wait when rate limited", () => {
    expect(emailCodeErrorMessage({ status: 429, message: "Too many requests" })).toBe(
      "Too many codes have been requested. Try again in a few minutes.",
    );
  });

  test("suggests a new code when the code is wrong, expired or locked", () => {
    expect(
      emailCodeErrorMessage({
        status: 400,
        code: "INVALID_CODE",
        message: "The code is wrong or has expired",
      }),
    ).toBe("The code is wrong or has expired. Check it, or send a new code.");
  });

  test("passes other server messages through", () => {
    expect(
      emailCodeErrorMessage({ status: 400, code: "OTHER", message: "Email is not valid" }),
    ).toBe("Email is not valid");
  });

  test("falls back to a generic message", () => {
    expect(emailCodeErrorMessage({ status: 500 })).toBe("Something went wrong. Please try again.");
  });
});

describe("codeEntryErrorMessage", () => {
  const hint = "If new codes keep being rejected, wait a few hours and try again.";
  const rejectTimes = (
    times: number,
    rejections: ReturnType<typeof recordCodeRejection> = noCodeRejections,
  ) =>
    Array.from({ length: times }).reduce<ReturnType<typeof recordCodeRejection>>(
      (current) => recordCodeRejection(current),
      rejections,
    );
  const withHint = `${invalidCodeMessage} ${hint}`;

  test("keeps the normal message while guesses on the first code are under the per code lock", () => {
    expect(codeEntryErrorMessage(invalidCodeMessage, rejectTimes(1), hint)).toBe(
      invalidCodeMessage,
    );
    expect(codeEntryErrorMessage(invalidCodeMessage, rejectTimes(5), hint)).toBe(
      invalidCodeMessage,
    );
  });

  test("adds the hint after more than 5 rejections, when only the daily cap explains them", () => {
    expect(codeEntryErrorMessage(invalidCodeMessage, rejectTimes(6), hint)).toBe(withHint);
  });

  test("keeps the normal message when a new code is only rejected after a resend that followed no wrong guesses", () => {
    const rejections = rejectTimes(1, recordNewCode(noCodeRejections));
    expect(codeEntryErrorMessage(invalidCodeMessage, rejections, hint)).toBe(invalidCodeMessage);
  });

  test("keeps the normal message when the same code is rejected again, as after a refused resend", () => {
    expect(codeEntryErrorMessage(invalidCodeMessage, rejectTimes(2), hint)).toBe(
      invalidCodeMessage,
    );
  });

  test("adds the hint once a new code is rejected after an earlier code was", () => {
    const rejections = rejectTimes(1, recordNewCode(rejectTimes(1)));
    expect(codeEntryErrorMessage(invalidCodeMessage, rejections, hint)).toBe(withHint);
  });

  test("counts each code once however many times it is rejected", () => {
    expect(rejectTimes(3, recordNewCode(rejectTimes(2)))).toEqual({
      total: 5,
      codes: 2,
      currentCodeRejected: true,
    });
  });

  test("leaves other errors alone however many codes were rejected", () => {
    const rejections = rejectTimes(6, recordNewCode(rejectTimes(1)));
    expect(codeEntryErrorMessage("Something went wrong. Please try again.", rejections, hint)).toBe(
      "Something went wrong. Please try again.",
    );
  });
});

describe("readSignInError", () => {
  test("treats no error as signed in", () => {
    expect(readSignInError(null)).toEqual({ kind: "signedIn" });
  });

  test("asks for a code with no notice when the server sent one", () => {
    expect(readSignInError({ status: 403, code: "SIGN_IN_CODE_REQUIRED", codeSent: true })).toEqual(
      { kind: "codeRequired", notice: undefined },
    );
  });

  test("asks for a code with a notice when the per-address limit stopped a new email", () => {
    const outcome = readSignInError({
      status: 403,
      code: "SIGN_IN_CODE_REQUIRED",
      codeSent: false,
    });
    expect(outcome.kind === "codeRequired" && outcome.notice).toContain("Use the last code");
  });

  test("tells a wrong code apart from a wrong password", () => {
    expect(readSignInError({ status: 400, code: "INVALID_CODE" })).toEqual({
      kind: "invalidCode",
    });
    expect(
      readSignInError({
        status: 401,
        code: "INVALID_EMAIL_OR_PASSWORD",
        message: "Invalid email or password",
      }),
    ).toEqual({ kind: "wrongPassword", message: "Invalid email or password" });
  });

  test("passes the server's message through for codes the server can't send", () => {
    expect(
      readSignInError({
        status: 403,
        code: "SIGN_IN_CODES_UNAVAILABLE",
        message: "This server can't send email right now.",
      }),
    ).toEqual({
      kind: "failed",
      code: "SIGN_IN_CODES_UNAVAILABLE",
      message: "This server can't send email right now.",
    });
  });

  test("asks to check the connection when the request never reached the server", () => {
    expect(readSignInError(new TypeError("Network request failed"))).toEqual({
      kind: "failed",
      code: undefined,
      message: "Check your connection and try again.",
    });
  });
});

describe("signInCodeEntryError", () => {
  test("reports a new code as sent after a resend only when one really was", () => {
    expect(signInCodeEntryError({ kind: "codeRequired", notice: undefined }, false)).toBe(
      undefined,
    );
    expect(signInCodeEntryError({ kind: "codeRequired", notice: "Limit" }, false)).toBe("Limit");
  });

  test("never treats a submitted code that needs replacing as a success", () => {
    expect(signInCodeEntryError({ kind: "codeRequired", notice: undefined }, true)).toBe(
      "We've emailed you a new code. Enter the new one.",
    );
    expect(signInCodeEntryError({ kind: "codeRequired", notice: "Limit" }, true)).toBe("Limit");
  });

  test("returns the shared invalid code message so repeated rejection hints work", () => {
    expect(signInCodeEntryError({ kind: "invalidCode" }, true)).toBe(invalidCodeMessage);
  });

  test("shows other failures inline", () => {
    expect(
      signInCodeEntryError({ kind: "failed", code: undefined, message: "Offline" }, true),
    ).toBe("Offline");
  });
});
