import { expect, test } from "bun:test";
import { passwordErrorMessage } from "./passwordErrorMessage.ts";

test("a password lockout shows the app's copy, whatever the server says", () => {
  expect(
    passwordErrorMessage(
      { code: "TOO_MANY_PASSWORD_ATTEMPTS", message: "Rate limit exceeded" },
      "Please try again.",
    ),
  ).toBe("Too many attempts. Try again in 15 minutes.");
});

test("other password errors keep the server's message, or the fallback without one", () => {
  expect(
    passwordErrorMessage(
      { code: "INVALID_EMAIL_OR_PASSWORD", message: "Invalid email or password" },
      "Please try again.",
    ),
  ).toBe("Invalid email or password");
  expect(passwordErrorMessage({ message: "" }, "Please try again.")).toBe("Please try again.");
});
