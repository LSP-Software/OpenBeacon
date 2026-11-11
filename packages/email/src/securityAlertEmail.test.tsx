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
  { type: "other-sessions-signed-out", device: null },
  { type: "device-removed", device: { name: "Pixel 8", model: "Pixel 8", platform: "android" } },
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
  test("every alert has a title and says when it happened", async () => {
    for (const alert of [...alwaysOn, ...optional]) {
      const email = await render(alert);
      expect(email.html).toMatch(/<h1[^>]*>[^<]+<\/h1>/);
      expect(email.text).toMatch(/ at\nThursday, 9 July 2026 at 14:32 BST \(13:32 UTC\)\n/);
      expect(email.text).not.toMatch(/contact|support/i);
    }
  });

  test("every alert except account deleted says what to do if it wasn't you", async () => {
    for (const alert of [...alwaysOn, ...optional]) {
      const email = await render(alert);
      expect(email.text.includes("If this wasn't you\n\n")).toBe(alert.type !== "account-deleted");
    }
  });

  test("only optional alerts say where to choose which emails you get", async () => {
    const settingsLine =
      "To choose which emails you get, open the OpenBeacon app and go to Account → Notifications → Email alerts.";
    for (const alert of alwaysOn) {
      const email = await render(alert);
      expect(email.canTurnOff).toBe(false);
      expect(email.text).not.toContain("To choose which emails you get");
      expect(email.html).not.toContain("To choose which emails you get");
    }
    for (const alert of optional) {
      const email = await render(alert);
      expect(email.canTurnOff).toBe(true);
      expect(email.text).toContain(settingsLine);
      expect(email.html).toContain(settingsLine);
      expect(email.text).not.toContain("You can turn off this alert");
    }
  });

  test("a new device alert names the phone's model and platform", async () => {
    const email = await render({
      type: "new-device",
      device: { model: "Pixel 8", platform: "android" },
    });
    expect(email.subject).toBe("A new device was added to your OpenBeacon account");
    expect(email.text).toContain("New device added\n\nA new device was added");
    expect(email.text).toContain("Device\nPixel 8 (Android)\n");
  });

  test("a new device alert still reads well without the model or platform", async () => {
    const platformOnly = await render({
      type: "new-device",
      device: { model: null, platform: "ios" },
    });
    expect(platformOnly.text).toContain("Device\niOS device\n");
    const unknown = await render({ type: "new-device", device: { model: null, platform: null } });
    expect(unknown.text).toContain("A new device was added to your OpenBeacon account.\n");
    expect(unknown.text).not.toContain("Device\n");
    expect(unknown.text).not.toContain("a device");
  });

  test("a deletion alert gives the deletion date and says signing in cancels it", async () => {
    const email = await render({
      type: "deletion-scheduled",
      deletionDate: new Date("2026-07-16T13:32:00Z"),
    });
    expect(email.text).toContain(
      "Requested at\nThursday, 9 July 2026 at 14:32 BST (13:32 UTC)\n\nScheduled for\nThursday, 16 July 2026 at 14:32 BST (13:32 UTC)\n",
    );
    expect(email.text).toContain("Signing in to the app before then cancels the deletion.");
  });

  test("recovery phrase alerts point to the button the phone will show", async () => {
    const changed = await render({ type: "recovery-phrase-changed" });
    expect(changed.text).toContain(
      "If this wasn't you\n\nSomeone else is signed in to your account. In the OpenBeacon app, change your password in Account → Password and Security. That signs out every other device. Then open Account → Recovery phrase and tap Change recovery phrase.",
    );
    const reset = await render({ type: "recovery-phrase-reset" });
    expect(reset.text).toContain(
      'Then open Account → Recovery phrase and tap "I’ve lost my phrase" to set a new one.',
    );
  });

  test("an account deletion alert only says the account and its data are gone", async () => {
    for (const hasPassword of [true, false]) {
      const email = await render({ type: "account-deleted" }, { hasPassword });
      expect(email.subject).toBe("Your OpenBeacon account was deleted");
      expect(email.text).toContain(
        "Account deleted\n\nYour OpenBeacon account and its data were deleted.\n\nDeleted at\nThursday, 9 July 2026 at 14:32 BST (13:32 UTC)\n",
      );
      expect(email.text).not.toContain("this server");
      expect(email.text).not.toMatch(/didn't ask|wasn't you|Google|password/);
    }
  });

  test("accounts without a password are told to change their Google password, then sign out other sessions", async () => {
    for (const alert of [
      ...optional,
      { type: "recovery-phrase-changed" as const },
      { type: "recovery-phrase-reset" as const },
      { type: "other-sessions-signed-out" as const, device: null },
      {
        type: "device-removed" as const,
        device: { name: "Car tablet", model: null, platform: null },
      },
      { type: "alerts-turned-off" as const, alerts: ["new-device" as const] },
    ]) {
      const email = await render(alert, { hasPassword: false });
      expect(email.text).toContain(
        "Change your Google password, because someone may have used your Google account to sign in.",
      );
      expect(email.text).toContain(
        'open Account → Password and Security and tap "Sign out of all other sessions".',
      );
      expect(email.text).not.toContain("change your password");
      expect(email.text).not.toContain("In the OpenBeacon app, secure");
    }
  });

  test("a new device alert tells the owner what to do if someone else signed in", async () => {
    const device = { model: "Pixel 8", platform: "android" } as const;
    const withPassword = await render({ type: "new-device", device });
    expect(withPassword.text).toContain(
      "If this wasn't you\n\nSomeone else is signed in to your account. In the OpenBeacon app, open Account → Devices, tap Pixel 8 and tap Remove device. In the OpenBeacon app, change your password in Account → Password and Security. That signs out every other device.",
    );
    const google = await render({ type: "new-device", device }, { hasPassword: false });
    expect(google.text).toContain(
      `If this wasn't you\n\nSomeone else is signed in to your account. In the OpenBeacon app, open Account → Devices, tap Pixel 8 and tap Remove device. Change your Google password, because someone may have used your Google account to sign in. After that, in the OpenBeacon app, open Account → Password and Security and tap "Sign out of all other sessions".`,
    );
  });

  test("an other sessions alert tells the owner how to get back in and sign the other person out", async () => {
    const withPassword = await render({ type: "other-sessions-signed-out", device: null });
    expect(withPassword.subject).toBe("Your other OpenBeacon sessions were signed out");
    expect(withPassword.text).toContain(
      "Other sessions signed out\n\nEvery other session on your OpenBeacon account was signed out. Only the phone or tablet that did this is still signed in.",
    );
    expect(withPassword.text).toContain(
      "If this wasn't you\n\nSomeone else is signed in to your account and may have signed you out. Use \"Forgot password\" on the app's sign-in screen to choose a new password. That signs out every other device, including theirs.",
    );
    const google = await render(
      { type: "other-sessions-signed-out", device: null },
      { hasPassword: false },
    );
    expect(google.text).toContain(
      `After that, sign in to the OpenBeacon app, then open Account → Password and Security and tap "Sign out of all other sessions".`,
    );
  });

  test("an other sessions alert names the device that did it", async () => {
    const email = await render({
      type: "other-sessions-signed-out",
      device: { name: "Sam’s phone", model: "Pixel 8", platform: "android" },
    });
    expect(email.text).toContain("Only Sam’s phone is still signed in.");
    expect(email.text).toContain("Signed out by\nSam’s phone (Pixel 8, Android)\n");
  });

  test("a device removed alert names the device and says it gets no new locations", async () => {
    const email = await render({
      type: "device-removed",
      device: { name: "Pixel 8", model: "Pixel 8", platform: "android" },
    });
    expect(email.subject).toBe("A device was removed from your OpenBeacon account");
    expect(email.text).toContain(
      "Device removed\n\nPixel 8 was removed from your OpenBeacon account. It was signed out and won’t receive new locations.",
    );
    expect(email.text).toContain("Device\nPixel 8 (Android)\n");
    expect(email.text).toContain("Someone else is signed in to your account.");
  });

  test("a deletion alert tells the owner to cancel it, then secure the account", async () => {
    const google = await render(
      { type: "deletion-scheduled", deletionDate: at },
      { hasPassword: false },
    );
    expect(google.text).toContain(
      "If this wasn't you\n\nSign in to the app now to cancel it. Change your Google password, because someone may have used your Google account to sign in.",
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
