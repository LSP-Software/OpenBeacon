import { describe, expect, test } from "bun:test";
import { renderGoogleSignInEmail } from "./googleSignInEmail.tsx";

describe("renderGoogleSignInEmail", () => {
  test("explains how to sign in with Google and that it can be ignored", async () => {
    const email = await renderGoogleSignInEmail({ serverName: "Family" });
    expect(email.subject).toBe("Signing in to OpenBeacon with Google");
    expect(email.text).toContain("Someone asked to reset the password");
    expect(email.text).toContain("Continue with Google");
    expect(email.text).toContain("you can safely ignore this email");
    expect(email.html).toContain("Continue with Google");
  });
});
