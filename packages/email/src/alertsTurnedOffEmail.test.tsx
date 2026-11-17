import { describe, expect, test } from "bun:test";
import { renderAlertsTurnedOffEmail } from "./alertsTurnedOffEmail.tsx";
import { renderSecurityAlertEmail } from "./securityAlertEmail.tsx";
import type { TurnedOffNotification } from "./types.ts";

const render = (alerts: TurnedOffNotification[], hasPassword = true) =>
  renderSecurityAlertEmail({
    alert: { type: "alerts-turned-off", alerts },
    at: new Date("2026-07-09T13:32:00Z"),
    timezone: "Europe/London",
    hasPassword,
    serverName: "Family",
  });

describe("renderAlertsTurnedOffEmail", () => {
  test("one alert uses the same list with a single bullet", async () => {
    const email = await render([{ type: "DELETION_SCHEDULED", channel: "email" }]);
    expect(email.subject).toBe("Alerts were turned off on your OpenBeacon account");
    expect(email.cappable).toBe(false);
    expect(email.text).toContain(
      "Alerts turned off\n\nThis alert was turned off:\n\n * Account deletion scheduled (email)\n\nTurned off at\nThursday, 9 July 2026 at 14:32 BST (13:32 UTC)\n",
    );
    expect(email.text).not.toContain("New sign-in");
    expect(email.html.match(/<li\b/g)).toHaveLength(1);
    expect(email.text).toContain(
      "If this wasn't you\n\nSomeone else is signed in to your account. In the OpenBeacon app, change your password in Account → Password and Security. That signs out every other device. Then turn this alert back on in Account → Notifications.",
    );
  });

  test("several alerts are listed one per line in screen order, with both channels on one line", async () => {
    const email = await render([
      { type: "DELETION_SCHEDULED", channel: "phone" },
      { type: "NEW_SIGN_IN", channel: "email" },
      { type: "PLACE_ALERTS", channel: "phone" },
      { type: "DELETION_SCHEDULED", channel: "email" },
    ]);
    expect(email.text).toContain(
      "These alerts were turned off:\n\n * Place arrivals and departures (phone notifications)\n * New sign-in (email)\n * Account deletion scheduled (email and phone notifications)\n",
    );
    expect(email.html.match(/<li\b/g)).toHaveLength(3);
    expect(email.text).toContain("Then turn these alerts back on in Account → Notifications.");
  });

  test("accounts without a password are told to change their Google password, then sign out other sessions", async () => {
    const email = await render([{ type: "NEW_SIGN_IN", channel: "phone" }], false);
    expect(email.text).toContain(
      `If this wasn't you\n\nSomeone else is signed in to your account. Change your Google password, because someone may have used your Google account to sign in. After that, in the OpenBeacon app, open Account → Password and Security and tap "Sign out of all other sessions". Then turn this alert back on`,
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
