import { describe, expect, test } from "bun:test";
import { renderCodeEmail } from "./codeEmail.tsx";
import type { EmailCodePurpose } from "./types.ts";

const purposes: EmailCodePurpose[] = ["sign-up", "password-reset", "recovery-reset"];

describe("renderCodeEmail", () => {
  test.each(purposes)("puts the %s code in the body only", async (purpose) => {
    const email = await renderCodeEmail({
      purpose,
      code: "042917",
      serverName: "Family Server",
    });
    expect(email.subject).not.toContain("042917");
    expect(email.text).toContain("042917");
    expect(email.html).toContain("042917");
    const preview = email.html.match(/<div[^>]*display:none[^>]*>([^<]*)/)?.[1] ?? "";
    expect(preview).toContain("Use this code in the app");
    expect(preview).not.toContain("042917");
  });

  test("names what each code is for in the subject", async () => {
    const subjects = await Promise.all(
      purposes.map(
        async (purpose) =>
          (
            await renderCodeEmail({
              purpose,
              code: "000000",
              serverName: "Family Server",
            })
          ).subject,
      ),
    );
    expect(subjects).toEqual([
      "Your OpenBeacon sign-up code",
      "Your OpenBeacon password reset code",
      "Your OpenBeacon recovery phrase reset code",
    ]);
  });
});
