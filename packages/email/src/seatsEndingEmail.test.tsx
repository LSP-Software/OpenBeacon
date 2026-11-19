import { describe, expect, test } from "bun:test";
import { renderSeatsEndingEmail } from "./seatsEndingEmail.tsx";

const holds = [
  { groupId: "family", groupName: "Family", memberName: "Alice", deviceName: "Pixel 8" },
  { groupId: "family", groupName: "Family", memberName: "Bob", deviceName: "Pixel 7" },
  { groupId: "climbing", groupName: "Climbing", memberName: "Alice", deviceName: "Pixel 8" },
];

describe("renderSeatsEndingEmail", () => {
  test("names every phone that goes on hold under its group, and when", async () => {
    const email = await renderSeatsEndingEmail({
      holds,
      holdsFrom: new Date("2026-07-16T13:32:00Z"),
      kind: "ending",
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

  test("keeps two groups with the same name apart", async () => {
    const email = await renderSeatsEndingEmail({
      holds: [
        { groupId: "a", groupName: "Family", memberName: "Alice", deviceName: "Pixel 8" },
        { groupId: "b", groupName: "Family", memberName: "Bob", deviceName: "Pixel 7" },
      ],
      holdsFrom: new Date("2026-07-16T13:32:00Z"),
      kind: "ending",
      serverName: "Family Server",
      timezone: null,
    });
    expect(email.text).toContain("Family\n\n * Alice (Pixel 8)\n\nFamily\n\n * Bob (Pixel 7)");
  });

  test("the reminder has its own subject", async () => {
    const email = await renderSeatsEndingEmail({
      holds,
      holdsFrom: new Date("2026-07-16T13:32:00Z"),
      kind: "reminder",
      serverName: "Family Server",
      timezone: null,
    });
    expect(email.subject).toBe("Phones in your OpenBeacon groups go on hold tomorrow");
    expect(email.summary.type).toBe("seats:ending-soon");
  });

  test("the ended form says the phones are on hold now", async () => {
    const email = await renderSeatsEndingEmail({
      holds,
      holdsFrom: new Date("2026-07-16T13:32:00Z"),
      kind: "ended",
      serverName: "Family Server",
      timezone: "Europe/London",
    });
    expect(email.subject).toBe("Phones in your OpenBeacon groups are on hold");
    expect(email.summary.type).toBe("seats:ended");
    expect(email.text).toContain(
      "Your seats ended on Thursday, 16 July 2026 at 14:32 BST (13:32 UTC) and these phones are on hold until you renew:",
    );
    expect(email.text).toContain("Family\n\n * Alice (Pixel 8)\n * Bob (Pixel 7)");
    expect(email.text).toContain("Renew your seats and sharing starts again on its own.");
  });

  test("refuses to send with nobody going on hold", async () => {
    expect(
      renderSeatsEndingEmail({
        holds: [],
        holdsFrom: new Date(),
        kind: "ending",
        serverName: "Family Server",
        timezone: null,
      }),
    ).rejects.toThrow();
  });
});
