import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { randomBytes } from "@noble/ciphers/utils.js";
import { decodeBase64, encodeBase64 } from "./base64.ts";
import { GROUP_EPOCH_DOMAIN_CONTEXT, XCHACHA20_NONCE_LENGTH } from "./constants.ts";
import type { EpochKeyMaterial } from "./sensitive.ts";

export const DRIVE_RECORD_KIND = "drive" as const;
export const DRIVE_RECORD_VERSION = 1;
export const DRIVE_RECORD_LENGTH = 1_008;
export const ENCRYPTED_DRIVE_RECORD_LENGTH = DRIVE_RECORD_LENGTH + 16;
export const DRIVE_RECORD_MAX_EVENTS = 48;
export const DRIVING_EVENT_TYPES = [
  "HARD_BRAKING",
  "RAPID_ACCELERATION",
  "SPEEDING",
  "PHONE_USE",
] as const;
export const SPEED_LIMIT_SOURCES = ["POSTED", "ROAD_TYPE"] as const;

export type DrivingEventType = (typeof DRIVING_EVENT_TYPES)[number];

export type DrivingEvent = {
  type: DrivingEventType;
  timeOffset: number;
  duration: number;
  latitude: number;
  longitude: number;
  peak: number;
  limit: { speed: number; source: (typeof SPEED_LIMIT_SOURCES)[number] } | null;
};

export type DriveRecord = {
  driveId: string;
  start: { time: number; latitude: number; longitude: number };
  end: { time: number; latitude: number; longitude: number };
  distance: number;
  checkedDistance: number;
  duration: number;
  topSpeed: number;
  averageSpeed: number;
  utcOffsetMinutes: number;
  counts: Record<DrivingEventType, number>;
  passenger: boolean;
  speedLimitsChecked: boolean;
  tellGroup: boolean;
  events: DrivingEvent[];
};

export type SealedDriveRecord = {
  ciphertext: string;
  driveId: string;
  nonce: string;
  startHour: number;
};

const HEADER_LENGTH = 73;
const EVENT_LENGTH = 16;
const PASSENGER_FLAG = 1;
const SPEED_LIMITS_CHECKED_FLAG = 2;
const TELL_GROUP_FLAG = 4;
const UINT32 = 2 ** 32;
const HOUR_MS = 3_600_000;
const FULL_TURN_E7 = 3_600_000_000;
const HALF_TURN_E7 = 1_800_000_000;
const INT24_MAX = 0x7f_ffff;

const invalid = () => new Error("Invalid drive record.");
const unreadable = () => new Error("Unreadable drive record.");

const isInRange = (value: number, min: number, max: number) =>
  Number.isFinite(value) && value >= min && value <= max;

const toUnits = (value: number, scale: number, max: number) => {
  const units = Math.round(value * scale);
  if (!Number.isFinite(value) || units < 0 || units > max) throw invalid();
  return units;
};

const toE7 = (latitude: number, longitude: number) => {
  if (!isInRange(latitude, -90, 90) || !isInRange(longitude, -180, 180)) throw invalid();
  return { latitude: Math.round(latitude * 1e7), longitude: Math.round(longitude * 1e7) };
};

const wrapLongitudeE7 = (value: number) =>
  value > HALF_TURN_E7
    ? value - FULL_TURN_E7
    : value < -HALF_TURN_E7
      ? value + FULL_TURN_E7
      : value;

const toDelta = (from: number, to: number) => {
  const delta = Math.round(wrapLongitudeE7(to - from) / 100);
  if (Math.abs(delta) > INT24_MAX) throw invalid();
  return delta;
};

const setUint48 = (view: DataView, offset: number, value: number) => {
  if (!Number.isSafeInteger(value) || value < 0 || value >= 2 ** 48) throw invalid();
  view.setUint16(offset, Math.floor(value / UINT32));
  view.setUint32(offset + 2, value % UINT32);
};

const getUint48 = (view: DataView, offset: number) =>
  view.getUint16(offset) * UINT32 + view.getUint32(offset + 2);

const setInt24 = (view: DataView, offset: number, value: number) => {
  const unsigned = value < 0 ? value + 0x100_0000 : value;
  view.setUint8(offset, unsigned >>> 16);
  view.setUint16(offset + 1, unsigned & 0xffff);
};

const getUint24 = (view: DataView, offset: number) =>
  view.getUint8(offset) * 0x1_0000 + view.getUint16(offset + 1);

const getInt24 = (view: DataView, offset: number) => {
  const unsigned = getUint24(view, offset);
  return unsigned > INT24_MAX ? unsigned - 0x100_0000 : unsigned;
};

export const encodeDriveRecord = (record: DriveRecord) => {
  if (!/^[0-9a-f]{32}$/.test(record.driveId) || record.end.time < record.start.time) {
    throw invalid();
  }
  if (!Number.isInteger(record.utcOffsetMinutes) || Math.abs(record.utcOffsetMinutes) > 1_080) {
    throw invalid();
  }
  const events = record.events.slice(0, DRIVE_RECORD_MAX_EVENTS);
  const counts = DRIVING_EVENT_TYPES.map((type) => {
    const count = record.counts[type];
    if (
      !Number.isInteger(count) ||
      count < events.filter((event) => event.type === type).length ||
      count > 0xffff ||
      (record.passenger && count > 0)
    ) {
      throw invalid();
    }
    return count;
  });
  if (record.passenger && events.length > 0) throw invalid();

  const bytes = new Uint8Array(DRIVE_RECORD_LENGTH);
  const view = new DataView(bytes.buffer);
  const start = toE7(record.start.latitude, record.start.longitude);
  const end = toE7(record.end.latitude, record.end.longitude);

  view.setUint8(0, DRIVE_RECORD_VERSION);
  for (let index = 0; index < 16; index += 1) {
    view.setUint8(1 + index, Number.parseInt(record.driveId.slice(index * 2, index * 2 + 2), 16));
  }
  view.setUint8(
    17,
    (record.passenger ? PASSENGER_FLAG : 0) |
      (record.speedLimitsChecked ? SPEED_LIMITS_CHECKED_FLAG : 0) |
      (record.tellGroup ? TELL_GROUP_FLAG : 0),
  );
  setUint48(view, 18, record.start.time);
  setUint48(view, 24, record.end.time);
  view.setInt32(30, start.latitude);
  view.setInt32(34, start.longitude);
  view.setInt32(38, end.latitude);
  view.setInt32(42, end.longitude);
  view.setUint32(46, toUnits(record.distance, 1, UINT32 - 1));
  view.setUint32(50, toUnits(record.checkedDistance, 1, UINT32 - 1));
  view.setUint32(54, toUnits(record.duration, 1, UINT32 - 1));
  view.setUint16(58, toUnits(record.topSpeed, 100, 0xffff));
  view.setUint16(60, toUnits(record.averageSpeed, 100, 0xffff));
  view.setInt16(62, record.utcOffsetMinutes);
  counts.forEach((count, index) => {
    view.setUint16(64 + index * 2, count);
  });
  view.setUint8(72, events.length);

  events.forEach((event, index) => {
    const offset = HEADER_LENGTH + index * EVENT_LENGTH;
    const position = toE7(event.latitude, event.longitude);
    if (event.limit && event.type !== "SPEEDING") throw invalid();
    view.setUint8(
      offset,
      (DRIVING_EVENT_TYPES.indexOf(event.type) + 1) |
        (event.limit ? (SPEED_LIMIT_SOURCES.indexOf(event.limit.source) + 1) << 4 : 0),
    );
    const timeOffset = toUnits(event.timeOffset, 1, 0xff_ffff);
    view.setUint8(offset + 1, timeOffset >>> 16);
    view.setUint16(offset + 2, timeOffset & 0xffff);
    view.setUint16(offset + 4, toUnits(event.duration, 1, 0xffff));
    setInt24(view, offset + 6, toDelta(start.latitude, position.latitude));
    setInt24(view, offset + 9, toDelta(start.longitude, position.longitude));
    view.setUint16(offset + 12, toUnits(event.peak, 100, 0xffff));
    view.setUint16(offset + 14, event.limit ? toUnits(event.limit.speed, 100, 0xffff) : 0);
  });

  return bytes;
};

export const decodeDriveRecord = (bytes: Uint8Array): DriveRecord => {
  if (bytes.length !== DRIVE_RECORD_LENGTH) throw invalid();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const flags = view.getUint8(17);
  const eventCount = view.getUint8(72);
  const startLatitude = view.getInt32(30);
  const startLongitude = view.getInt32(34);
  const passenger = (flags & PASSENGER_FLAG) !== 0;
  const counts = DRIVING_EVENT_TYPES.map((_, index) => view.getUint16(64 + index * 2));
  const startTime = getUint48(view, 18);
  const endTime = getUint48(view, 24);
  const offset = view.getInt16(62);

  if (
    view.getUint8(0) !== DRIVE_RECORD_VERSION ||
    (flags & ~(PASSENGER_FLAG | SPEED_LIMITS_CHECKED_FLAG | TELL_GROUP_FLAG)) !== 0 ||
    eventCount > DRIVE_RECORD_MAX_EVENTS ||
    endTime < startTime ||
    Math.abs(offset) > 1_080 ||
    (passenger && (eventCount > 0 || counts.some((count) => count > 0))) ||
    bytes.subarray(HEADER_LENGTH + eventCount * EVENT_LENGTH).some((byte) => byte !== 0)
  ) {
    throw invalid();
  }
  const position = (latitude: number, longitude: number) => {
    if (Math.abs(latitude) > 900_000_000 || Math.abs(longitude) > HALF_TURN_E7) throw invalid();
    return { latitude: latitude / 1e7, longitude: longitude / 1e7 };
  };

  const events = Array.from({ length: eventCount }, (_, index): DrivingEvent => {
    const at = HEADER_LENGTH + index * EVENT_LENGTH;
    const typeByte = view.getUint8(at);
    const type = DRIVING_EVENT_TYPES[(typeByte & 0x0f) - 1];
    const source = typeByte >>> 4;
    const limit = view.getUint16(at + 14);
    if (
      !type ||
      source > SPEED_LIMIT_SOURCES.length ||
      (source === 0) !== (limit === 0) ||
      (source !== 0 && type !== "SPEEDING")
    ) {
      throw invalid();
    }
    const sourceName = SPEED_LIMIT_SOURCES[source - 1];
    return {
      type,
      timeOffset: getUint24(view, at + 1),
      duration: view.getUint16(at + 4),
      ...position(
        startLatitude + getInt24(view, at + 6) * 100,
        wrapLongitudeE7(startLongitude + getInt24(view, at + 9) * 100),
      ),
      peak: view.getUint16(at + 12) / 100,
      limit: sourceName ? { speed: limit / 100, source: sourceName } : null,
    };
  });
  if (
    DRIVING_EVENT_TYPES.some(
      (type, index) => (counts[index] ?? 0) < events.filter((event) => event.type === type).length,
    )
  ) {
    throw invalid();
  }

  const driveId = Array.from(bytes.subarray(1, 17), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return {
    driveId,
    start: { time: startTime, ...position(startLatitude, startLongitude) },
    end: { time: endTime, ...position(view.getInt32(38), view.getInt32(42)) },
    distance: view.getUint32(46),
    checkedDistance: view.getUint32(50),
    duration: view.getUint32(54),
    topSpeed: view.getUint16(58) / 100,
    averageSpeed: view.getUint16(60) / 100,
    utcOffsetMinutes: offset,
    counts: {
      HARD_BRAKING: counts[0] ?? 0,
      RAPID_ACCELERATION: counts[1] ?? 0,
      SPEEDING: counts[2] ?? 0,
      PHONE_USE: counts[3] ?? 0,
    },
    passenger,
    speedLimitsChecked: (flags & SPEED_LIMITS_CHECKED_FLAG) !== 0,
    tellGroup: (flags & TELL_GROUP_FLAG) !== 0,
    events,
  };
};

export const markPassengerDrive = (record: DriveRecord): DriveRecord => ({
  ...record,
  passenger: true,
  counts: { HARD_BRAKING: 0, RAPID_ACCELERATION: 0, SPEEDING: 0, PHONE_USE: 0 },
  events: [],
});

export const driveRecordAssociatedData = ({
  driveId,
  epochId,
  groupId,
  senderDeviceId,
}: {
  driveId: string;
  epochId: string;
  groupId: string;
  senderDeviceId: string;
}) =>
  new TextEncoder().encode(
    JSON.stringify({
      context: GROUP_EPOCH_DOMAIN_CONTEXT,
      driveId,
      epochId,
      groupId,
      kind: DRIVE_RECORD_KIND,
      purpose: "payload",
      senderDeviceId,
    }),
  );

export const sealDriveRecord = ({
  epochId,
  epochKey,
  groupId,
  nonce = randomBytes(XCHACHA20_NONCE_LENGTH),
  record,
  senderDeviceId,
}: {
  epochId: string;
  epochKey: EpochKeyMaterial;
  groupId: string;
  nonce?: Uint8Array;
  record: DriveRecord;
  senderDeviceId: string;
}): SealedDriveRecord => {
  if (nonce.length !== XCHACHA20_NONCE_LENGTH) throw new Error("Invalid nonce length.");
  const cipher = xchacha20poly1305(
    epochKey.expose(),
    nonce,
    driveRecordAssociatedData({ driveId: record.driveId, epochId, groupId, senderDeviceId }),
  );
  return {
    ciphertext: encodeBase64(cipher.encrypt(encodeDriveRecord(record))),
    driveId: record.driveId,
    nonce: encodeBase64(nonce),
    startHour: Math.floor(record.start.time / HOUR_MS),
  };
};

export const openDriveRecord = ({
  epochId,
  epochKey,
  groupId,
  sealed,
  senderDeviceId,
}: {
  epochId: string;
  epochKey: EpochKeyMaterial;
  groupId: string;
  sealed: SealedDriveRecord;
  senderDeviceId: string;
}) => {
  let record: DriveRecord;
  try {
    const cipher = xchacha20poly1305(
      epochKey.expose(),
      decodeBase64(sealed.nonce),
      driveRecordAssociatedData({ driveId: sealed.driveId, epochId, groupId, senderDeviceId }),
    );
    record = decodeDriveRecord(cipher.decrypt(decodeBase64(sealed.ciphertext)));
  } catch {
    throw unreadable();
  }
  if (
    record.driveId !== sealed.driveId ||
    Math.floor(record.start.time / HOUR_MS) !== sealed.startHour
  ) {
    throw unreadable();
  }
  return record;
};
