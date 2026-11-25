import { describe, expect, test } from "bun:test";
import { applyDriveMuteChange, driveMuteState } from "./driveAlertMutes.ts";

const names = (userId: string) => ({ sam: "Sam", jo: "Jo", lou: "Lou" })[userId] ?? "Someone";

describe("Drive alert mutes", () => {
  test("a muted person reads as off and the summary names them", () => {
    const state = driveMuteState({
      memberUserIds: ["sam", "jo", "lou"],
      mutes: [{ mutedUserId: "jo" }],
      nameOf: names,
      quietUserIds: [],
    });

    expect(state.members).toEqual([
      { userId: "sam", alertsOn: true, sendsAlerts: true },
      { userId: "jo", alertsOn: false, sendsAlerts: true },
      { userId: "lou", alertsOn: true, sendsAlerts: true },
    ]);
    expect(state.summary).toBe("Muted for Jo");
  });

  test("Mute everyone turns everyone off, including people who weren't muted one by one", () => {
    const state = driveMuteState({
      memberUserIds: ["sam", "jo"],
      mutes: [{ mutedUserId: null }],
      nameOf: names,
      quietUserIds: [],
    });

    expect(state.everyoneMuted).toBe(true);
    expect(state.members.every((member) => !member.alertsOn)).toBe(true);
    expect(state.summary).toBe("Everyone muted");
  });

  test("someone who doesn't send Drive alerts to this group is shown as not sending, not as muted", () => {
    const state = driveMuteState({
      memberUserIds: ["sam", "lou"],
      mutes: [],
      nameOf: names,
      quietUserIds: ["lou"],
    });

    expect(state.members[1]).toEqual({ userId: "lou", alertsOn: false, sendsAlerts: false });
    expect(state.summary).toBe("Alerts on for everyone");
  });

  test("several muted people are counted", () => {
    expect(
      driveMuteState({
        memberUserIds: ["sam", "jo", "lou"],
        mutes: [{ mutedUserId: "jo" }, { mutedUserId: "lou" }],
        nameOf: names,
        quietUserIds: [],
      }).summary,
    ).toBe("Muted for 2 people");
  });

  test("a change replaces any earlier mute for the same person", () => {
    expect(
      applyDriveMuteChange([{ mutedUserId: "jo" }], { mutedUserId: "jo", muted: false }),
    ).toEqual([]);
    expect(applyDriveMuteChange([], { mutedUserId: null, muted: true })).toEqual([
      { mutedUserId: null },
    ]);
  });
});
