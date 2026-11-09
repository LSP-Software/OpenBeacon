import { describe, expect, mock, test } from "bun:test";
import {
  createSendSecurityAlertEmail,
  formatAlertTime,
  renderSecurityAlertEmail,
} from "./securityAlertEmail.tsx";
import { createSendEmail } from "./sender.ts";
import type { SecurityAlert } from "./types.ts";

const at = new Date("2026-07-09T13:32:00Z");

const render = (
  alert: SecurityAlert,
  {
    timezone = "Europe/London",
    hasPassword = true,
  }: { timezone?: string; hasPassword?: boolean } = {},
) => renderSecurityAlertEmail({ alert, at, timezone, hasPassword, serverName: "Family" });

const alwaysOn: SecurityAlert[] = [
  { type: "password-changed" },
  { type: "password-reset" },
  { type: "recovery-phrase-changed" },
  { type: "recovery-phrase-reset" },
  { type: "alerts-turned-off", alerts: ["new-device"] },
  { type: "account-deleted" },
];
const optional: SecurityAlert[] = [
  { type: "new-device", device: { model: "Pixel 8", platform: "android" } },
  { type: "deletion-scheduled", deletionDate: new Date("2026-07-16T13:32:00Z") },
];

describe("formatAlertTime", () => {
  test("shows the account's timezone with UTC alongside", () => {
    expect(formatAlertTime(at, "Europe/London")).toBe(
      "Thursday, 9 July 2026 at 14:32 BST (13:32 UTC)",
    );
  });

  test("gives the UTC date too when it's a different day", () => {
    expect(formatAlertTime(at, "Pacific/Auckland")).toBe(
      "Friday, 10 July 2026 at 01:32 GMT+12 (Thursday, 9 July 2026 at 13:32 UTC)",
    );
  });

  test("shows the time once when the timezone is UTC under another name", () => {
    for (const timezone of ["UTC", "Etc/UTC", "Etc/Zulu"]) {
      expect(formatAlertTime(at, timezone)).toBe("Thursday, 9 July 2026 at 13:32 UTC");
    }
    for (const timezone of ["GMT", "Etc/GMT", "Africa/Abidjan"]) {
      expect(formatAlertTime(at, timezone)).toBe("Thursday, 9 July 2026 at 13:32 GMT");
    }
    expect(formatAlertTime(new Date("2026-01-09T13:32:00Z"), "Europe/London")).toBe(
      "Friday, 9 January 2026 at 13:32 GMT",
    );
  });

  test("falls back to UTC alone without a valid timezone", () => {
    expect(formatAlertTime(at, null)).toBe("Thursday, 9 July 2026 at 13:32 UTC");
    expect(formatAlertTime(at, "Mars/Olympus")).toBe("Thursday, 9 July 2026 at 13:32 UTC");
  });
});

describe("renderSecurityAlertEmail", () => {
  test("every alert says when it happened and what to do if it wasn't you", async () => {
    for (const alert of [...alwaysOn, ...optional]) {
      const email = await render(alert);
      expect(email.text).toContain("Thursday, 9 July 2026 at 14:32 BST (13:32 UTC)");
      expect(email.text).toMatch(/If (this wasn't you|you didn't ask for this)/);
      expect(email.text).not.toMatch(/contact|support/i);
    }
  });

  test("only optional alerts say where to turn them off", async () => {
    for (const alert of alwaysOn) {
      const email = await render(alert);
      expect(email.canTurnOff).toBe(false);
      expect(email.text).not.toContain("You can turn off this alert");
    }
    for (const alert of optional) {
      const email = await render(alert);
      expect(email.canTurnOff).toBe(true);
      expect(email.text).toContain(
        "You can turn off this alert in the app under Account → Email alerts.",
      );
    }
  });

  test("a new device alert names the phone's model and platform", async () => {
    const email = await render({
      type: "new-device",
      device: { model: "Pixel 8", platform: "android" },
    });
    expect(email.subject).toBe("A new device was added to your OpenBeacon account");
    expect(email.text).toContain("Pixel 8 (Android).");
  });

  test("a new device alert still reads well without the model or platform", async () => {
    const platformOnly = await render({
      type: "new-device",
      device: { model: null, platform: "ios" },
    });
    expect(platformOnly.text).toContain(": an iOS device.");
    const unknown = await render({ type: "new-device", device: { model: null, platform: null } });
    expect(unknown.text).toContain(": a device.");
  });

  test("a deletion alert gives the deletion date and says signing in cancels it", async () => {
    const email = await render({
      type: "deletion-scheduled",
      deletionDate: new Date("2026-07-16T13:32:00Z"),
    });
    expect(email.text).toContain(
      "It will be deleted on Thursday, 16 July 2026 at 14:32 BST (13:32 UTC).",
    );
    expect(email.text).toContain("Signing in to the app before then cancels the deletion.");
  });

  test("recovery phrase alerts point to the button the phone will show", async () => {
    const changed = await render({ type: "recovery-phrase-changed" });
    expect(changed.text).toContain(
      "If this wasn't you, someone else is signed in to your account. In the OpenBeacon app, change your password in Account → Password and Security. That signs you out on every other device. Then open Account → Recovery phrase and tap Change recovery phrase.",
    );
    const reset = await render({ type: "recovery-phrase-reset" });
    expect(reset.text).toContain(
      'Then open Account → Recovery phrase and tap "I’ve lost my phrase" to set a new one.',
    );
  });

  test("turning alerts off lists each alert by its name in the app", async () => {
    const one = await render({ type: "alerts-turned-off", alerts: ["deletion-scheduled"] });
    expect(one.subject).toBe("Email alerts were turned off on your OpenBeacon account");
    expect(one.text).toContain(
      "These email alerts were turned off on Thursday, 9 July 2026 at 14:32 BST (13:32 UTC): Account deletion scheduled.",
    );
    const both = await render({
      type: "alerts-turned-off",
      alerts: ["new-device", "deletion-scheduled"],
    });
    expect(both.text).toContain(": New device added and Account deletion scheduled.");
    expect(both.text).toContain(
      "If this wasn't you, someone else is signed in to your account. In the OpenBeacon app, change your password in Account → Password and Security. That signs you out on every other device. Then turn the alerts back on in Account → Email alerts.",
    );
  });

  test("an account deletion alert says it can't be undone", async () => {
    const email = await render({ type: "account-deleted" });
    expect(email.subject).toBe("Your OpenBeacon account was deleted");
    expect(email.text).toContain(
      "Your OpenBeacon account and its data were deleted from this server on Thursday, 9 July 2026 at 14:32 BST (13:32 UTC).",
    );
    expect(email.text).toContain(
      "If you didn't ask for this, someone else could sign in to your account. Deleted accounts can't be restored. If you used your OpenBeacon password anywhere else, change it there.",
    );
    const google = await render({ type: "account-deleted" }, { hasPassword: false });
    expect(google.text).toContain(
      "If you didn't ask for this, someone else could sign in to your account. Deleted accounts can't be restored. Secure your Google account, because someone may have used it to sign in.",
    );
  });

  test("accounts without a password are told to secure Google instead", async () => {
    for (const alert of [
      ...optional,
      { type: "recovery-phrase-changed" as const },
      { type: "recovery-phrase-reset" as const },
      { type: "alerts-turned-off" as const, alerts: ["new-device" as const] },
    ]) {
      const email = await render(alert, { hasPassword: false });
      expect(email.text).toContain(
        "Secure your Google account, because someone may have used it to sign in.",
      );
      expect(email.text).not.toContain("change your password");
      expect(email.text).not.toContain("In the OpenBeacon app, secure");
    }
  });

  test("a new device alert tells the owner what to do if someone else signed in", async () => {
    const device = { model: "Pixel 8", platform: "android" } as const;
    const withPassword = await render({ type: "new-device", device });
    expect(withPassword.text).toContain(
      "If this wasn't you, someone else is signed in to your account. In the OpenBeacon app, change your password in Account → Password and Security. That signs you out on every other device.",
    );
    const google = await render({ type: "new-device", device }, { hasPassword: false });
    expect(google.text).toContain(
      "If this wasn't you, someone else is signed in to your account. Secure your Google account, because someone may have used it to sign in.",
    );
  });

  test("a deletion alert tells the owner to cancel it, then secure the account", async () => {
    const google = await render(
      { type: "deletion-scheduled", deletionDate: at },
      { hasPassword: false },
    );
    expect(google.text).toContain(
      "If this wasn't you, sign in to the app now to cancel it. Secure your Google account, because someone may have used it to sign in.",
    );
  });
});

describe("sendSecurityAlertEmail", () => {
  test("always-on alerts ignore the per-account cap and optional ones respect it", async () => {
    const send = mock(async () => {});
    const sendSecurityAlertEmail = createSendSecurityAlertEmail({
      sendEmail: createSendEmail({
        transport: { send, verify: async () => {} },
        rateLimits: {
          consume: async () => ({
            allowed: false,
            limit: 20,
            remaining: 0,
            retryAfterMs: 1000,
            resetAfterMs: 1000,
          }),
        },
      }),
      serverName: "Family",
    });
    const sendAlert = (alert: SecurityAlert) =>
      sendSecurityAlertEmail({
        to: "owner@example.com",
        userId: "user-1",
        alert,
        at,
        timezone: null,
        hasPassword: true,
      });

    for (const alert of alwaysOn) expect(await sendAlert(alert)).toEqual({ sent: true });
    for (const alert of optional) {
      expect(await sendAlert(alert)).toEqual({ sent: false, reason: "capped" });
    }
    expect(send).toHaveBeenCalledTimes(alwaysOn.length);
  });
});
