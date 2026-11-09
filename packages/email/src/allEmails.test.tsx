import { describe, expect, test } from "bun:test";
import { renderAccountExistsEmail } from "./accountExistsEmail.tsx";
import { renderCodeEmail } from "./codeEmail.tsx";
import { renderGoogleSignInEmail } from "./googleSignInEmail.tsx";
import { renderSecurityAlertEmail } from "./securityAlertEmail.tsx";
import type { EmailCodePurpose, SecurityAlert } from "./types.ts";

const serverName = "Family Server";
const code = "042917";

const renderEveryEmail = async () => {
  const purposes: EmailCodePurpose[] = [
    "sign-up",
    "email-verification",
    "password-reset",
    "recovery-reset",
  ];
  const alerts: SecurityAlert[] = [
    { type: "password-changed" },
    { type: "password-reset" },
    { type: "recovery-phrase-changed" },
    { type: "recovery-phrase-reset" },
    { type: "new-device", device: { model: "Pixel 8", platform: "android" } },
    { type: "deletion-scheduled", deletionDate: new Date("2026-07-16T13:32:00Z") },
    { type: "alerts-turned-off", alerts: ["new-device", "deletion-scheduled"] },
    { type: "account-deleted" },
  ];
  return [
    ...(await Promise.all(
      purposes.map((purpose) => renderCodeEmail({ purpose, code, serverName })),
    )),
    ...(await Promise.all(
      [true, false].flatMap((hasPassword) => [
        renderAccountExistsEmail({ hasPassword, serverName }),
        ...alerts.map((alert) =>
          renderSecurityAlertEmail({
            alert,
            at: new Date("2026-07-09T13:32:00Z"),
            timezone: "Europe/London",
            hasPassword,
            serverName,
          }),
        ),
      ]),
    )),
    await renderGoogleSignInEmail({ serverName }),
  ];
};

describe("every email", () => {
  test("loads nothing remotely and has no links that could track a click", async () => {
    for (const email of await renderEveryEmail()) {
      expect(email.html).not.toMatch(
        /\b(src|href|background|action|poster)\s*=\s*["']?\s*(https?:|\/\/)/i,
      );
      expect(email.html).not.toMatch(/url\(|@import|<link\b|<a\b|<script\b/i);
      expect(email.html.match(/<img\b[^>]*>/gi)).toEqual([
        expect.stringContaining('src="cid:openbeacon-logo"'),
      ]);
      expect(email.text).not.toMatch(/https?:\/\//i);
      expect(email.attachments.map(({ contentId }) => contentId)).toEqual(["openbeacon-logo"]);
    }
  });

  test("ends with the recovery phrase warning and the server name", async () => {
    for (const email of await renderEveryEmail()) {
      expect(email.text).toContain(
        "We will never ask for your recovery phrase. Don't share it with anyone, including us.",
      );
      expect(email.text).toContain(`Sent from ${serverName}`);
    }
  });

  test("never puts a code in the subject", async () => {
    for (const email of await renderEveryEmail()) {
      expect(email.subject).not.toMatch(/\d{6}/);
    }
  });
});
