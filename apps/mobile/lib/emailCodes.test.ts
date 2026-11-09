import { describe, expect, mock, test } from "bun:test";

mock.module("./auth-client.ts", () => ({ authClient: { $fetch: () => undefined } }));

const { emailCodeErrorMessage } = await import("./emailCodes.ts");

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
