import { describe, expect, test } from "bun:test";
import type { DriveRecord, DrivingEvent } from "./index.ts";
import {
  DRIVE_RECORD_LENGTH,
  DRIVE_RECORD_MAX_EVENTS,
  decodeDriveRecord,
  ENCRYPTED_DRIVE_RECORD_LENGTH,
  encodeDriveRecord,
  generateGroupEpochKey,
  markPassengerDrive,
  openDriveRecord,
  sealDriveRecord,
} from "./index.ts";

const start = Date.parse("2026-11-25T08:14:07.250Z");

const braking = {
  type: "HARD_BRAKING",
  timeOffset: 312,
  duration: 2,
  latitude: 51.5131,
  longitude: -0.1022,
  peak: 4.27,
  limit: null,
} satisfies DrivingEvent;

const speeding = {
  type: "SPEEDING",
  timeOffset: 840,
  duration: 22,
  latitude: 51.5402,
  longitude: -0.0811,
  peak: 17.5,
  limit: { speed: 13.41, source: "POSTED" },
} satisfies DrivingEvent;

const drive = {
  driveId: "0f1e2d3c4b5a69788796a5b4c3d2e1f0",
  start: { time: start, latitude: 51.5074, longitude: -0.1278 },
  end: { time: start + 1_380_000, latitude: 51.5521, longitude: -0.0714 },
  distance: 14_210,
  checkedDistance: 12_900,
  duration: 1_320,
  topSpeed: 27.31,
  averageSpeed: 10.76,
  utcOffsetMinutes: 0,
  counts: { HARD_BRAKING: 3, RAPID_ACCELERATION: 0, SPEEDING: 1, PHONE_USE: 0 },
  passenger: false,
  speedLimitsChecked: true,
  tellGroup: true,
  events: [braking, speeding],
} satisfies DriveRecord;

const eventsOf = (count: number) =>
  Array.from({ length: count }, (_, index) => ({ ...braking, timeOffset: index * 5 }));

const metadata = {
  epochId: "epoch_1",
  groupId: "group_1",
  senderDeviceId: "device_1",
};

describe("drive records", () => {
  test("encode to the same length whatever the number of Driving events", () => {
    for (const count of [0, 1, 48, 200]) {
      const record = {
        ...drive,
        counts: { ...drive.counts, HARD_BRAKING: count, SPEEDING: 0 },
        events: eventsOf(count),
      };
      expect(encodeDriveRecord(record).length).toBe(DRIVE_RECORD_LENGTH);
    }
    expect(DRIVE_RECORD_LENGTH).toBe(1_008);
    expect(ENCRYPTED_DRIVE_RECORD_LENGTH).toBe(1_024);
  });

  test("round trip keeps every figure at its stored precision", () => {
    expect(decodeDriveRecord(encodeDriveRecord(drive))).toEqual(drive);
  });

  test("keep the first 48 events given and the exact counts beyond them", () => {
    const decoded = decodeDriveRecord(
      encodeDriveRecord({
        ...drive,
        counts: { ...drive.counts, HARD_BRAKING: 200, SPEEDING: 0 },
        events: eventsOf(200),
      }),
    );
    expect(DRIVE_RECORD_MAX_EVENTS).toBe(48);
    expect(decoded.events).toEqual(eventsOf(48));
    expect(decoded.counts.HARD_BRAKING).toBe(200);
  });

  test("keep a western offset and a drive across the antimeridian", () => {
    const fiji = {
      ...drive,
      utcOffsetMinutes: -570,
      start: { ...drive.start, latitude: -16.7, longitude: 179.9999 },
      events: [{ ...braking, latitude: -16.71, longitude: -179.9995 }],
      counts: { ...drive.counts, SPEEDING: 0 },
    };
    expect(decodeDriveRecord(encodeDriveRecord(fiji))).toEqual(fiji);
  });

  test("refuse counts lower than the positioned events of that type", () => {
    expect(() => encodeDriveRecord({ ...drive, counts: { ...drive.counts, SPEEDING: 0 } })).toThrow(
      "Invalid drive record.",
    );
  });

  test("refuse records that can't be stored", () => {
    for (const record of [
      { ...drive, driveId: "not-hex" },
      { ...drive, end: { ...drive.end, time: start - 1 } },
      { ...drive, distance: -1 },
      { ...drive, topSpeed: Number.NaN },
      { ...drive, utcOffsetMinutes: 1_200 },
      { ...drive, start: { ...drive.start, latitude: 91 } },
      { ...drive, events: [{ ...braking, limit: { speed: 13.41, source: "POSTED" } }] },
      { ...drive, passenger: true },
    ] satisfies DriveRecord[]) {
      expect(() => encodeDriveRecord(record)).toThrow("Invalid drive record.");
    }
  });

  test("refuse to decode a changed version, padding or wrong length", () => {
    const bytes = encodeDriveRecord(drive);
    const changedVersion = bytes.slice();
    changedVersion[0] = 2;
    const changedPadding = bytes.slice();
    changedPadding[DRIVE_RECORD_LENGTH - 1] = 1;
    for (const changed of [changedVersion, changedPadding, bytes.slice(0, 1_007)]) {
      expect(() => decodeDriveRecord(changed)).toThrow("Invalid drive record.");
    }
  });

  test("a passenger mark blanks events and counts and keeps the summary", () => {
    const marked = markPassengerDrive(drive);
    expect(marked).toEqual({
      ...drive,
      passenger: true,
      counts: { HARD_BRAKING: 0, RAPID_ACCELERATION: 0, SPEEDING: 0, PHONE_USE: 0 },
      events: [],
    });
    expect(encodeDriveRecord(marked).length).toBe(DRIVE_RECORD_LENGTH);
  });
});

describe("sealed drive records", () => {
  const epochKey = generateGroupEpochKey();

  test("open with the same group, epoch, device and Drive ID", () => {
    const sealed = sealDriveRecord({ ...metadata, epochKey, record: drive });
    expect(sealed.driveId).toBe(drive.driveId);
    expect(sealed.startHour).toBe(Math.floor(start / 3_600_000));
    expect(Buffer.from(sealed.ciphertext, "base64").length).toBe(ENCRYPTED_DRIVE_RECORD_LENGTH);
    expect(openDriveRecord({ ...metadata, epochKey, sealed })).toEqual(drive);
  });

  test("are unreadable when any bound metadata is swapped", () => {
    const sealed = sealDriveRecord({ ...metadata, epochKey, record: drive });
    for (const swapped of [
      { ...metadata, groupId: "group_2" },
      { ...metadata, epochId: "epoch_2" },
      { ...metadata, senderDeviceId: "device_2" },
    ]) {
      expect(() => openDriveRecord({ ...swapped, epochKey, sealed })).toThrow(
        "Unreadable drive record.",
      );
    }
    expect(() =>
      openDriveRecord({
        ...metadata,
        epochKey,
        sealed: { ...sealed, driveId: "00000000000000000000000000000000" },
      }),
    ).toThrow("Unreadable drive record.");
    expect(() =>
      openDriveRecord({ ...metadata, epochKey: generateGroupEpochKey(), sealed }),
    ).toThrow("Unreadable drive record.");
  });

  test("are unreadable when the start isn't in the stated hour", () => {
    const sealed = sealDriveRecord({ ...metadata, epochKey, record: drive });
    for (const startHour of [sealed.startHour - 1, sealed.startHour + 1]) {
      expect(() =>
        openDriveRecord({ ...metadata, epochKey, sealed: { ...sealed, startHour } }),
      ).toThrow("Unreadable drive record.");
    }
  });

  test("are unreadable when a copy is moved under another Drive ID with matching plaintext ID", () => {
    const other = sealDriveRecord({
      ...metadata,
      epochKey,
      record: { ...drive, driveId: "11111111111111111111111111111111" },
    });
    expect(() =>
      openDriveRecord({
        ...metadata,
        epochKey,
        sealed: { ...other, driveId: drive.driveId },
      }),
    ).toThrow("Unreadable drive record.");
  });
});
