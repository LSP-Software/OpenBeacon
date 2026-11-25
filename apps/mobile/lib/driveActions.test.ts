import { describe, expect, test } from "bun:test";
import {
  type DriveRecord,
  type EpochKeyMaterial,
  generateGroupEpochKey,
  markPassengerDrive,
  openDriveRecord,
  sealDriveRecord,
} from "@openbeacon/encryption";
import type { RouterInputs, RouterOutputs } from "./api.ts";
import { drivingAgain, rewriteDriveCopies } from "./driveActions.ts";

type ListedDrive = RouterOutputs["groupTracking"]["drives"]["drives"][number];
type ReplaceInput = RouterInputs["drives"]["replace"];

const HOUR_MS = 3_600_000;
const startHour = Math.floor(Date.parse("2026-11-24T17:00:00Z") / HOUR_MS);
const driveId = "a".repeat(32);
const keys: Record<string, EpochKeyMaterial> = {
  "family-epoch-3": generateGroupEpochKey(),
  "work-epoch-1": generateGroupEpochKey(),
};

const full: DriveRecord = {
  driveId,
  start: {
    time: startHour * HOUR_MS + 1_800_000,
    latitude: 51.5,
    longitude: -0.12,
  },
  end: {
    time: startHour * HOUR_MS + 4_320_000,
    latitude: 51.65,
    longitude: -0.2,
  },
  distance: 37_000,
  checkedDistance: 37_000,
  duration: 2_520,
  topSpeed: 31.7,
  averageSpeed: 14.7,
  utcOffsetMinutes: 0,
  counts: { HARD_BRAKING: 1, RAPID_ACCELERATION: 0, SPEEDING: 0, PHONE_USE: 2 },
  passenger: false,
  speedLimitsChecked: true,
  tellGroup: true,
  events: [
    {
      type: "PHONE_USE",
      timeOffset: 600,
      duration: 40,
      latitude: 51.55,
      longitude: -0.15,
      peak: 12.5,
      limit: null,
    },
    {
      type: "HARD_BRAKING",
      timeOffset: 900,
      duration: 2,
      latitude: 51.56,
      longitude: -0.16,
      peak: 4.2,
      limit: null,
    },
  ],
};

const copy = ({
  epochId,
  groupId,
  record,
  senderDeviceId = "sam-phone",
  senderUserId = "sam",
}: {
  epochId: string;
  groupId: string;
  record: DriveRecord;
  senderDeviceId?: string;
  senderUserId?: string;
}): ListedDrive => {
  const key = keys[epochId] ?? generateGroupEpochKey();
  return {
    ...sealDriveRecord({
      epochId,
      epochKey: key,
      groupId,
      record,
      senderDeviceId,
    }),
    epochId,
    epochNumber: 1,
    receivedAt: new Date(),
    replacedAt: null,
    senderDeviceId,
    senderUserId,
  };
};

const server = (byGroup: Record<string, ListedDrive[]>) => {
  const replaced: ReplaceInput[] = [];
  return {
    replaced,
    fetchDrives: async (input: RouterInputs["groupTracking"]["drives"]) => ({
      cursor: null,
      drives: (byGroup[input.groupId] ?? []).filter(
        (drive) => drive.startHour >= input.fromHour && drive.startHour < input.toHour,
      ),
      hasMore: false,
    }),
    replace: async (input: ReplaceInput) => {
      replaced.push(input);
    },
  };
};

const opened = (input: ReplaceInput, groupId: string, epochId: string) => {
  const sealed = input.copies.find((item) => item.groupId === groupId);
  if (!sealed) throw new Error(`No copy for ${groupId}`);
  const key = keys[epochId];
  if (!key) throw new Error(`No key for ${epochId}`);
  return openDriveRecord({
    epochId,
    epochKey: key,
    groupId,
    sealed: { ...sealed, driveId, startHour },
    senderDeviceId: "sam-phone",
  });
};

const epochKeyFor = async (_groupId: string, epochId: string) => keys[epochId] ?? null;

describe("rewriteDriveCopies", () => {
  test("marks every Group copy as a Passenger drive under its own Epoch, keeping each Group's alert choice", async () => {
    const { fetchDrives, replace, replaced } = server({
      family: [copy({ epochId: "family-epoch-3", groupId: "family", record: full })],
      work: [
        copy({
          epochId: "work-epoch-1",
          groupId: "work",
          record: { ...full, tellGroup: false },
        }),
      ],
      friends: [],
    });

    await rewriteDriveCopies({
      driveId,
      epochKeyFor,
      fetchDrives,
      groupIds: ["family", "work", "friends"],
      replace,
      rewrite: markPassengerDrive,
      selfUserId: "sam",
      startHour,
    });

    expect(replaced).toHaveLength(1);
    const [input] = replaced;
    if (!input) throw new Error("Nothing was replaced");
    expect(input.copies.map((item) => item.groupId).sort()).toEqual(["family", "work"]);
    expect(opened(input, "family", "family-epoch-3")).toEqual(markPassengerDrive(full));
    expect(opened(input, "work", "work-epoch-1")).toEqual(
      markPassengerDrive({ ...full, tellGroup: false }),
    );
  });

  test("undoing on the recording device brings back the score inputs from its full record", async () => {
    const { fetchDrives, replace, replaced } = server({
      work: [
        copy({
          epochId: "work-epoch-1",
          groupId: "work",
          record: markPassengerDrive({ ...full, tellGroup: false }),
        }),
      ],
    });

    await rewriteDriveCopies({
      driveId,
      epochKeyFor,
      fetchDrives,
      groupIds: ["work"],
      replace,
      rewrite: drivingAgain(full),
      selfUserId: "sam",
      startHour,
    });

    const [input] = replaced;
    if (!input) throw new Error("Nothing was replaced");
    expect(opened(input, "work", "work-epoch-1")).toEqual({
      ...full,
      tellGroup: false,
    });
  });

  test("refuses a full record for a different Drive", () => {
    expect(() =>
      drivingAgain({ ...full, driveId: "b".repeat(32) })(markPassengerDrive(full)),
    ).toThrow();
  });

  test("changes nothing when one Group's copy can't be read", async () => {
    const { fetchDrives, replace, replaced } = server({
      family: [copy({ epochId: "family-epoch-3", groupId: "family", record: full })],
      work: [copy({ epochId: "work-epoch-9", groupId: "work", record: full })],
    });

    const attempt = rewriteDriveCopies({
      driveId,
      epochKeyFor,
      fetchDrives,
      groupIds: ["family", "work"],
      replace,
      rewrite: markPassengerDrive,
      selfUserId: "sam",
      startHour,
    });

    await expect(attempt).rejects.toThrow();
    expect(replaced).toHaveLength(0);
  });

  test("ignores another member's Drive and throws when the account has no copy", async () => {
    const { fetchDrives, replace, replaced } = server({
      family: [
        copy({
          epochId: "family-epoch-3",
          groupId: "family",
          record: full,
          senderDeviceId: "jo-phone",
          senderUserId: "jo",
        }),
      ],
    });

    const attempt = rewriteDriveCopies({
      driveId,
      epochKeyFor,
      fetchDrives,
      groupIds: ["family"],
      replace,
      rewrite: markPassengerDrive,
      selfUserId: "sam",
      startHour,
    });

    await expect(attempt).rejects.toThrow();
    expect(replaced).toHaveLength(0);
  });
});
