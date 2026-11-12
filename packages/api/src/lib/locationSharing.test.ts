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
      revisionPrefix: "s0.1:",
    },
  ]);
});

test("an ended pause shows the device sharing under the pause revision without its timings", async () => {
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
  expect(states).toEqual([
    { deviceId: "device-1", userId: "user-1", paused: false, revisionPrefix: "s0.1:" },
  ]);
  expect(Object.keys(states[0]!).sort()).toEqual([
    "deviceId",
    "paused",
    "revisionPrefix",
    "userId",
  ]);
});
