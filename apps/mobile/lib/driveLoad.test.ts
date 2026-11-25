import { describe, expect, test } from "bun:test";
import {
  type DriveRecord,
  generateGroupEpochKey,
  markPassengerDrive,
  sealDriveRecord,
} from "@openbeacon/encryption";
import type { RouterInputs, RouterOutputs } from "./api.ts";
import { createDriveCache, loadGroupDrives } from "./driveLoad.ts";

type DrivesPage = RouterOutputs["groupTracking"]["drives"];
type ListedDrive = DrivesPage["drives"][number];

const HOUR_MS = 3_600_000;
const groupId = "group-1";
const epochKey = generateGroupEpochKey();
const startHour = Math.floor(Date.parse("2026-11-24T08:00:00Z") / HOUR_MS);
const range = { fromHour: startHour - 24, toHour: startHour + 24 };

const record = (driveId: string, hour = startHour): DriveRecord => ({
  driveId,
  start: { time: hour * HOUR_MS + 60_000, latitude: 51.5, longitude: -0.12 },
  end: { time: hour * HOUR_MS + 1_260_000, latitude: 51.55, longitude: -0.07 },
  distance: 9_000,
  checkedDistance: 9_000,
  duration: 1_200,
  topSpeed: 20,
  averageSpeed: 7.5,
  utcOffsetMinutes: 0,
  counts: { HARD_BRAKING: 1, RAPID_ACCELERATION: 0, SPEEDING: 0, PHONE_USE: 0 },
  passenger: false,
  speedLimitsChecked: false,
  tellGroup: true,
  events: [
    {
      type: "HARD_BRAKING",
      timeOffset: 30,
      duration: 2,
      latitude: 51.51,
      longitude: -0.11,
      peak: 3.5,
      limit: null,
    },
  ],
});

const listed = (
  drive: DriveRecord,
  overrides: Partial<ListedDrive> = {},
  key = epochKey,
): ListedDrive => {
  const sealed = sealDriveRecord({
    epochId: "epoch-1",
    epochKey: key,
    groupId,
    record: drive,
    senderDeviceId: "alice-phone",
  });
  return {
    ...sealed,
    epochId: "epoch-1",
    epochNumber: 1,
    receivedAt: new Date(drive.end.time + 60_000),
    replacedAt: null,
    senderDeviceId: "alice-phone",
    senderUserId: "alice",
    ...overrides,
  };
};

const server = (pages: ListedDrive[][]) => {
  const calls: RouterInputs["groupTracking"]["drives"][] = [];
  return {
    calls,
    fetchDrives: async (input: RouterInputs["groupTracking"]["drives"]): Promise<DrivesPage> => {
      calls.push(input);
      const index = calls.length - 1;
      const drives = pages[index] ?? [];
      const last = drives.at(-1);
      return {
        drives,
        cursor: last ? { driveId: last.driveId, startHour: last.startHour } : null,
        hasMore: index < pages.length - 1,
      };
    },
  };
};

const epochKeyFor = async (epochId: string) => (epochId === "epoch-1" ? epochKey : null);

describe("loading a Group's Drives", () => {
  test("reads every page and decrypts each Drive, newest first", async () => {
    const first = record("a".repeat(32), startHour - 3);
    const second = record("b".repeat(32), startHour);
    const { calls, fetchDrives } = server([[listed(first)], [listed(second)]]);

    const drives = await loadGroupDrives({
      cache: createDriveCache(),
      epochKeyFor,
      fetchDrives,
      groupId,
      ...range,
    });

    expect(calls).toHaveLength(2);
    expect(calls[1]?.cursor).toEqual({ driveId: first.driveId, startHour: startHour - 3 });
    expect(drives.map(({ record: read }) => read)).toEqual([second, first]);
    expect(drives[0]).toMatchObject({ senderUserId: "alice", senderDeviceId: "alice-phone" });
  });

  test("marks a Drive unreadable without its Epoch key or when its start isn't in its hour", async () => {
    const elsewhere = listed(record("c".repeat(32)), { startHour: startHour + 1 });
    const otherKey = listed(record("d".repeat(32)), {}, generateGroupEpochKey());
    const noKey = listed(record("e".repeat(32)), { epochId: "epoch-2" });
    const { fetchDrives } = server([[elsewhere, otherKey, noKey]]);

    const drives = await loadGroupDrives({
      cache: createDriveCache(),
      epochKeyFor,
      fetchDrives,
      groupId,
      ...range,
    });

    expect(drives.map(({ record: read }) => read)).toEqual([null, null, null]);
  });

  test("drops cached Drives that are no longer listed and shows a passenger mark", async () => {
    const cache = createDriveCache();
    const kept = record("f".repeat(32));
    const deleted = record("0".repeat(32));
    await loadGroupDrives({
      cache,
      epochKeyFor,
      ...server([[listed(kept), listed(deleted)]]),
      groupId,
      ...range,
    });
    expect(
      cache
        .list(groupId)
        .map(({ driveId }) => driveId)
        .sort(),
    ).toEqual([deleted.driveId, kept.driveId].sort());

    const marked = markPassengerDrive(kept);
    const drives = await loadGroupDrives({
      cache,
      epochKeyFor,
      ...server([[listed(marked, { replacedAt: new Date() })]]),
      groupId,
      ...range,
    });

    expect(drives.map(({ record: read }) => read)).toEqual([marked]);
    expect(cache.list(groupId).map(({ driveId }) => driveId)).toEqual([kept.driveId]);
    expect(cache.list(groupId)[0]?.record?.passenger).toBe(true);
  });

  test("keeps cached Drives outside the loaded hours", async () => {
    const cache = createDriveCache();
    const older = record("1".repeat(32), startHour - 100);
    await loadGroupDrives({
      cache,
      epochKeyFor,
      ...server([[listed(older)]]),
      groupId,
      fromHour: startHour - 120,
      toHour: startHour - 90,
    });
    await loadGroupDrives({ cache, epochKeyFor, ...server([[]]), groupId, ...range });
    expect(cache.list(groupId).map(({ driveId }) => driveId)).toEqual([older.driveId]);
  });
});
