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
    { type: "other-sessions-signed-out", device: null },
    { type: "device-removed", device: { name: "Pixel 8", model: "Pixel 8", platform: "android" } },
    { type: "new-sign-in", device: { model: "Pixel 8", platform: "android" } },
    { type: "deletion-scheduled", deletionDate: new Date("2026-07-16T13:32:00Z") },
    { type: "alerts-turned-off", alerts: ["deletion-scheduled"] },
    { type: "alerts-turned-off", alerts: ["new-sign-in", "deletion-scheduled"] },
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

  test("only the alerts a user can turn off say where to choose which emails they get", async () => {
    const subjects = (await renderEveryEmail())
      .filter(({ text, html }) => {
        const inText = text.includes("To choose which emails you get");
        expect(html.includes("To choose which emails you get")).toBe(inText);
        return inText;
      })
      .map(({ subject }) => subject);
    expect([...new Set(subjects)].toSorted()).toEqual([
      "New sign-in to your OpenBeacon account",
      "Your OpenBeacon account is scheduled for deletion",
    ]);
  });

  test("starts with a short title", async () => {
    for (const email of await renderEveryEmail()) {
      const title = email.html.match(/<h1[^>]*>([^<]+)<\/h1>/)?.[1] ?? "";
      expect(title.split(" ").length).toBeGreaterThanOrEqual(2);
      expect(title.split(" ").length).toBeLessThanOrEqual(4);
    }
  });

  test("summarises each kind of email with its own type and only code emails carry a code", async () => {
    const emails = await renderEveryEmail();
    const typesBySubject = new Map(emails.map(({ subject, summary }) => [subject, summary.type]));
    expect(new Set(typesBySubject.values()).size).toBe(typesBySubject.size);
    for (const email of emails) {
      expect(email.summary.code).toBe(email.text.includes(code) ? code : undefined);
    }
  });

  test("never puts a code in the subject", async () => {
    for (const email of await renderEveryEmail()) {
      expect(email.subject).not.toMatch(/\d{6}/);
    }
  });

  test("escapes the device model and server name", async () => {
    const email = await renderSecurityAlertEmail({
      alert: {
        type: "new-sign-in",
        device: { model: '<img src="https://evil.test/p.png">', platform: "ios" },
      },
      at: new Date("2026-07-09T13:32:00Z"),
      timezone: null,
      hasPassword: true,
      serverName: "<b>Family</b> & Co",
    });
    expect(email.html).not.toContain('evil.test/p.png">');
    expect(email.html).not.toContain("<b>Family</b>");
    expect(email.html).toContain("&lt;img src=&quot;https://evil.test/p.png&quot;&gt;");
    expect(email.html).toContain("&lt;b&gt;Family&lt;/b&gt; &amp; Co");
  });
});
