import { describe, expect, test } from "bun:test";
import { renderSeatsEndedEmail } from "./seatsEndedEmail.tsx";

describe("renderSeatsEndedEmail", () => {
  test("says when the seats ended and names every phone on hold under its group", async () => {
    const email = await renderSeatsEndedEmail({
      holds: [
        { groupId: "family", groupName: "Family", memberName: "Alice", deviceName: "Pixel 8" },
        { groupId: "family", groupName: "Family", memberName: "Bob", deviceName: "Pixel 7" },
        { groupId: "climbing", groupName: "Climbing", memberName: "Alice", deviceName: "Pixel 8" },
      ],
      endedAt: new Date("2026-07-16T13:32:00Z"),
      serverName: "Family Server",
      timezone: "Europe/London",
    });
    expect(email.subject).toBe("Phones in your OpenBeacon groups are on hold");
    expect(email.summary.type).toBe("seats:ended");
    expect(email.text).toContain(
      "Your seats ended on Thursday, 16 July 2026 at 14:32 BST (13:32 UTC) and these phones are on hold until you renew:",
    );
    expect(email.text).toContain("Family\n\n * Alice (Pixel 8)\n * Bob (Pixel 7)");
    expect(email.text).toContain("Climbing\n\n * Alice (Pixel 8)");
    expect(email.text).toContain("everyone can still pause sharing, leave the group or delete");
    expect(email.text).toContain("Renew your seats and sharing starts again on its own.");
  });

  test("keeps two groups with the same name apart", async () => {
    const email = await renderSeatsEndedEmail({
      holds: [
        { groupId: "a", groupName: "Family", memberName: "Alice", deviceName: "Pixel 8" },
        { groupId: "b", groupName: "Family", memberName: "Bob", deviceName: "Pixel 7" },
      ],
      endedAt: new Date("2026-07-16T13:32:00Z"),
      serverName: "Family Server",
      timezone: null,
    });
    expect(email.text).toContain("Family\n\n * Alice (Pixel 8)\n\nFamily\n\n * Bob (Pixel 7)");
  });

  test("refuses to send with no phone on hold", async () => {
    expect(
      renderSeatsEndedEmail({
        holds: [],
        endedAt: new Date(),
        serverName: "Family Server",
        timezone: null,
      }),
    ).rejects.toThrow();
  });
});
