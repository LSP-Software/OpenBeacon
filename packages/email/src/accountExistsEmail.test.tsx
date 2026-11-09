import { describe, expect, test } from "bun:test";
import { renderAccountExistsEmail } from "./accountExistsEmail.tsx";

describe("renderAccountExistsEmail", () => {
  test("suggests signing in or resetting the password for a password account", async () => {
    const email = await renderAccountExistsEmail({ hasPassword: true, serverName: "Family" });
    expect(email.subject).toBe("You already have an OpenBeacon account");
    expect(email.text).toContain("Sign in with your email and password instead.");
    expect(email.text).toContain("you can reset it from the sign-in screen");
    expect(email.text).not.toContain("Sign in with Google");
  });

  test("suggests signing in with Google for a Google-only account", async () => {
    const email = await renderAccountExistsEmail({ hasPassword: false, serverName: "Family" });
    expect(email.text).toContain("Sign in with Google instead.");
    expect(email.text).not.toContain("reset it");
  });
});
