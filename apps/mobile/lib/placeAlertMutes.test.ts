import { describe, expect, test } from "bun:test";
import { applyMuteChange, placeMuteState } from "./placeAlertMutes.ts";

const memberUserIds = ["peter", "logan"];

describe("placeMuteState", () => {
  test("has alerts on for everyone when nothing at the place is muted", () => {
    expect(
      placeMuteState({
        memberUserIds,
        mutes: [{ placeId: "school", mutedUserId: null }],
        placeId: "home",
      }),
    ).toEqual({
      everyoneMuted: false,
      members: [
        { userId: "peter", alertsOn: true },
        { userId: "logan", alertsOn: true },
      ],
      summary: "Alerts on for everyone",
    });
  });

  test("counts only muted people who are still in the group", () => {
    const state = placeMuteState({
      memberUserIds,
      mutes: [
        { placeId: "home", mutedUserId: "logan" },
        { placeId: "home", mutedUserId: "gone" },
        { placeId: "school", mutedUserId: "peter" },
      ],
      placeId: "home",
    });
    expect(state.members).toEqual([
      { userId: "peter", alertsOn: true },
      { userId: "logan", alertsOn: false },
    ]);
    expect(state.summary).toBe("1 muted");
  });

  test("muting everyone turns everyone's alerts off, whatever the person mutes say", () => {
    const state = placeMuteState({
      memberUserIds,
      mutes: [
        { placeId: "home", mutedUserId: "logan" },
        { placeId: "home", mutedUserId: null },
      ],
      placeId: "home",
    });
    expect(state.everyoneMuted).toBe(true);
    expect(state.members.every(({ alertsOn }) => !alertsOn)).toBe(true);
    expect(state.summary).toBe("Everyone muted");
  });
});

describe("applyMuteChange", () => {
  const mutes = [
    { placeId: "home", mutedUserId: "logan" },
    { placeId: "school", mutedUserId: null },
  ];

  test("adds a mute once and keeps person mutes separate from everyone mutes", () => {
    const once = applyMuteChange(mutes, { placeId: "home", mutedUserId: null, muted: true });
    expect(applyMuteChange(once, { placeId: "home", mutedUserId: null, muted: true })).toEqual(
      once,
    );
    expect(once).toEqual([...mutes, { placeId: "home", mutedUserId: null }]);
  });

  test("clears only the matching mute", () => {
    expect(applyMuteChange(mutes, { placeId: "school", mutedUserId: null, muted: false })).toEqual([
      { placeId: "home", mutedUserId: "logan" },
    ]);
    expect(applyMuteChange(mutes, { placeId: "home", mutedUserId: "peter", muted: false })).toEqual(
      mutes,
    );
  });
});
