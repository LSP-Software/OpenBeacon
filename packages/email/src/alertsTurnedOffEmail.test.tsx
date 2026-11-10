import { describe, expect, test } from "bun:test";
import { renderAlertsTurnedOffEmail } from "./alertsTurnedOffEmail.tsx";
import { renderSecurityAlertEmail } from "./securityAlertEmail.tsx";
import type { OptionalSecurityAlert } from "./types.ts";

const render = (alerts: OptionalSecurityAlert[], hasPassword = true) =>
  renderSecurityAlertEmail({
    alert: { type: "alerts-turned-off", alerts },
    at: new Date("2026-07-09T13:32:00Z"),
    timezone: "Europe/London",
    hasPassword,
    serverName: "Family",
  });

describe("renderAlertsTurnedOffEmail", () => {
  test("one alert uses the same list with a single bullet", async () => {
    const email = await render(["deletion-scheduled"]);
    expect(email.subject).toBe("Email alerts were turned off on your OpenBeacon account");
    expect(email.canTurnOff).toBe(false);
    expect(email.text).toContain(
      "Email alerts turned off\n\nThis email alert was turned off:\n\n * Account deletion scheduled\n\nTurned off at\nThursday, 9 July 2026 at 14:32 BST (13:32 UTC)\n",
    );
    expect(email.text).not.toContain("New device added");
    expect(email.html.match(/<li\b/g)).toHaveLength(1);
    expect(email.text).toContain(
      "If this wasn't you\n\nSomeone else is signed in to your account. In the OpenBeacon app, change your password in Account → Password and Security. That signs you out on every other device. Then turn this alert back on in Account → Notifications → Email alerts.",
    );
  });

  test("several alerts are listed one per line", async () => {
    const email = await render(["new-device", "deletion-scheduled"]);
    expect(email.text).toContain(
      "These email alerts were turned off:\n\n * New device added\n * Account deletion scheduled\n",
    );
    expect(email.html.match(/<li\b/g)).toHaveLength(2);
    expect(email.text).toContain(
      "Then turn these alerts back on in Account → Notifications → Email alerts.",
    );
  });

  test("accounts without a password are told to change their Google password, then sign out other sessions", async () => {
    const email = await render(["new-device"], false);
    expect(email.text).toContain(
      "If this wasn't you\n\nSomeone else is signed in to your account. Change your Google password, because someone may have used your Google account to sign in. After that, open the OpenBeacon app, go to Account and tap Sign out of all other sessions. Then turn this alert back on",
    );
    expect(email.text).not.toContain("change your password");
  });

  test("refuses to send an email with nothing in the list", async () => {
    await expect(
      renderAlertsTurnedOffEmail({
        alerts: [],
        happenedAt: "now",
        signedInAdvice: "",
        serverName: "Family",
      }),
    ).rejects.toThrow("At least one turned off alert is required");
  });
});
