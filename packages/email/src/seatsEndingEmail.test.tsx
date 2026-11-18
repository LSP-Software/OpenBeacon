import { describe, expect, test } from "bun:test";
import { renderSeatsEndingEmail } from "./seatsEndingEmail.tsx";

const holds = [
  { groupName: "Family", memberName: "Alice", deviceName: "Pixel 8" },
  { groupName: "Family", memberName: "Bob", deviceName: "Pixel 7" },
  { groupName: "Climbing", memberName: "Alice", deviceName: "Pixel 8" },
];

describe("renderSeatsEndingEmail", () => {
  test("names every phone that goes on hold under its group, and when", async () => {
    const email = await renderSeatsEndingEmail({
      holds,
      holdsFrom: new Date("2026-07-16T13:32:00Z"),
      reminder: false,
      serverName: "Family Server",
      timezone: "Europe/London",
    });
    expect(email.subject).toBe("Your OpenBeacon seats have ended");
    expect(email.text).toContain(
      "until Thursday, 16 July 2026 at 14:32 BST (13:32 UTC). Then these phones go on hold:",
    );
    expect(email.text).toContain("Family\n\n * Alice (Pixel 8)\n * Bob (Pixel 7)");
    expect(email.text).toContain("Climbing\n\n * Alice (Pixel 8)");
    expect(email.text).toContain("everyone can still pause sharing, leave the group or delete");
  });

  test("the reminder has its own subject", async () => {
    const email = await renderSeatsEndingEmail({
      holds,
      holdsFrom: new Date("2026-07-16T13:32:00Z"),
      reminder: true,
      serverName: "Family Server",
      timezone: null,
    });
    expect(email.subject).toBe("Phones in your OpenBeacon groups go on hold tomorrow");
    expect(email.summary.type).toBe("seats:ending-soon");
  });

  test("refuses to send with nobody going on hold", async () => {
    expect(
      renderSeatsEndingEmail({
        holds: [],
        holdsFrom: new Date(),
        reminder: false,
        serverName: "Family Server",
        timezone: null,
      }),
    ).rejects.toThrow();
  });
});
