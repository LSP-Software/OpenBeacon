import { expect, mock, test } from "bun:test";
import { getGroupSharingStates } from "./locationSharing.ts";
import { sharingDeviceRow } from "./locationSharing.testUtil.ts";

test("group members learn a device is paused without learning its planned resume time", async () => {
  const states = await getGroupSharingStates(
    {
      $queryRaw: mock(async () => [
        {
          ...sharingDeviceRow,
          sharingPaused: true,
          sharingPausedUntil: new Date(Date.now() + 60_000),
          sharingChangedAt: new Date(),
          sharingRevision: 1,
        },
      ]),
    },
    "group-1",
  );
  expect(states).toEqual([
    {
      deviceId: "device-1",
      userId: "user-1",
      paused: true,
      pausedUntil: null,
      resumeAfter: null,
      revisionPrefix: "s0.1:",
    },
  ]);
});

test("resumed group snapshots retain the cutoff needed to suppress previous locations", async () => {
  const deadline = new Date(Date.now() - 1);
  const states = await getGroupSharingStates(
    {
      $queryRaw: mock(async () => [
        {
          ...sharingDeviceRow,
          sharingPaused: true,
          sharingPausedUntil: deadline,
          sharingChangedAt: new Date(deadline.getTime() - 60_000),
          sharingRevision: 1,
        },
      ]),
    },
    "group-1",
  );
  expect(states[0]).toMatchObject({ paused: false, pausedUntil: null, resumeAfter: deadline });
});
