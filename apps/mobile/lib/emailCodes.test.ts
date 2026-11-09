import { describe, expect, mock, test } from "bun:test";

mock.module("./auth-client.ts", () => ({ authClient: { $fetch: () => undefined } }));

const { codeEntryErrorMessage, emailCodeErrorMessage, invalidCodeMessage } =
  await import("./emailCodes.ts");

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

  test("keeps the normal message for the first wrong code", () => {
    expect(codeEntryErrorMessage(invalidCodeMessage, 1, hint)).toBe(invalidCodeMessage);
  });

  test("adds the hint once codes keep being rejected", () => {
    expect(codeEntryErrorMessage(invalidCodeMessage, 2, hint)).toBe(
      "The code is wrong or has expired. Check it, or send a new code. If new codes keep being rejected, wait a few hours and try again.",
    );
  });

  test("leaves other errors alone however many codes were rejected", () => {
    expect(codeEntryErrorMessage("Something went wrong. Please try again.", 5, hint)).toBe(
      "Something went wrong. Please try again.",
    );
  });
});
