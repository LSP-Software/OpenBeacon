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
  test("one alert is named on its own line with when it was turned off", async () => {
    const email = await render(["deletion-scheduled"]);
    expect(email.subject).toBe("Email alerts were turned off on your OpenBeacon account");
    expect(email.canTurnOff).toBe(false);
    expect(email.text).toContain(
      "This email alert was turned off on Thursday, 9 July 2026 at 14:32 BST (13:32 UTC):\n\n * Account deletion scheduled\n",
    );
    expect(email.text).not.toContain("New device added");
    expect(email.html).toContain("<li>Account deletion scheduled</li>");
    expect(email.text).toContain(
      "If this wasn't you, someone else is signed in to your account. In the OpenBeacon app, change your password in Account → Password and Security. That signs you out on every other device. Then turn this alert back on in Account → Email alerts.",
    );
  });

  test("several alerts are listed one per line", async () => {
    const email = await render(["new-device", "deletion-scheduled"]);
    expect(email.text).toContain(
      "These email alerts were turned off on Thursday, 9 July 2026 at 14:32 BST (13:32 UTC):\n\n * New device added\n * Account deletion scheduled\n",
    );
    expect(email.html).toContain("<li>New device added</li><li>Account deletion scheduled</li>");
    expect(email.text).toContain("Then turn these alerts back on in Account → Email alerts.");
  });

  test("accounts without a password are told to secure Google instead", async () => {
    const email = await render(["new-device"], false);
    expect(email.text).toContain(
      "If this wasn't you, someone else is signed in to your account. Secure your Google account, because someone may have used it to sign in.",
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
