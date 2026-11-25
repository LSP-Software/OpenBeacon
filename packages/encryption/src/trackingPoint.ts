export const TRACKING_POINT_KIND = "trackingPoint" as const;
const TRACKING_POINT_VERSION = 2;
export const TRACKING_POINT_LENGTH = 23;
export const ENCRYPTED_TRACKING_POINT_LENGTH = TRACKING_POINT_LENGTH + 16;

export type TrackingPoint = {
  latitude: number;
  longitude: number;
  time: number;
  stayUntil: number | null;
  accuracy: number | null;
  speed: number | null;
  battery: {
    level: number | null;
    charging: boolean;
  };
  driveDetectionOff?: true;
  crashAlertsOff?: true;
};

const UNKNOWN_UINT16 = 0xffff;
const UNKNOWN_BATTERY_LEVEL = 127;
const STAY_FLAG = 1;
const DRIVE_DETECTION_OFF_FLAG = 2;
const CRASH_ALERTS_OFF_FLAG = 4;
const MINUTE_MS = 60_000;
const UINT32 = 2 ** 32;

const encodeUint16 = (value: number | null, scale: number) => {
  if (value === null || !Number.isFinite(value) || value < 0) {
    return UNKNOWN_UINT16;
  }
  return Math.min(Math.round(value * scale), UNKNOWN_UINT16 - 1);
};

const decodeUint16 = (value: number, scale: number) =>
  value === UNKNOWN_UINT16 ? null : value / scale;

const invalid = () => new Error("Invalid tracking point.");

export const encodeTrackingPoint = (point: TrackingPoint) => {
  const { latitude, longitude, time, stayUntil, battery } = point;
  if (
    !Number.isFinite(latitude) ||
    latitude < -90 ||
    latitude > 90 ||
    !Number.isFinite(longitude) ||
    longitude < -180 ||
    longitude > 180 ||
    !Number.isSafeInteger(time) ||
    time < 0 ||
    time >= 2 ** 48 ||
    (stayUntil !== null && !Number.isFinite(stayUntil))
  ) {
    throw invalid();
  }

  const bytes = new Uint8Array(TRACKING_POINT_LENGTH);
  const view = new DataView(bytes.buffer);
  const level =
    battery.level === null || !Number.isFinite(battery.level)
      ? UNKNOWN_BATTERY_LEVEL
      : Math.min(Math.max(Math.round(battery.level), 0), 100);

  view.setUint8(0, TRACKING_POINT_VERSION);
  view.setInt32(1, Math.round(latitude * 1e7));
  view.setInt32(5, Math.round(longitude * 1e7));
  view.setUint16(9, Math.floor(time / UINT32));
  view.setUint32(11, time % UINT32);
  view.setUint16(
    15,
    stayUntil === null
      ? 0
      : Math.min(Math.max(Math.floor((stayUntil - time) / MINUTE_MS), 0), UNKNOWN_UINT16),
  );
  view.setUint16(17, encodeUint16(point.accuracy, 10));
  view.setUint16(19, encodeUint16(point.speed, 100));
  view.setUint8(21, (battery.charging ? 0x80 : 0) | level);
  view.setUint8(
    22,
    (stayUntil === null ? 0 : STAY_FLAG) |
      (point.driveDetectionOff ? DRIVE_DETECTION_OFF_FLAG : 0) |
      (point.crashAlertsOff ? CRASH_ALERTS_OFF_FLAG : 0),
  );

  return bytes;
};

export const decodeTrackingPoint = (bytes: Uint8Array): TrackingPoint => {
  if (bytes.length !== TRACKING_POINT_LENGTH) {
    throw invalid();
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const latitude = view.getInt32(1);
  const longitude = view.getInt32(5);
  const time = view.getUint16(9) * UINT32 + view.getUint32(11);
  const stayMinutes = view.getUint16(15);
  const battery = view.getUint8(21);
  const level = battery & 0x7f;
  const flags = view.getUint8(22);

  if (
    view.getUint8(0) !== TRACKING_POINT_VERSION ||
    Math.abs(latitude) > 900_000_000 ||
    Math.abs(longitude) > 1_800_000_000 ||
    (level > 100 && level !== UNKNOWN_BATTERY_LEVEL) ||
    (flags & ~(STAY_FLAG | DRIVE_DETECTION_OFF_FLAG | CRASH_ALERTS_OFF_FLAG)) !== 0 ||
    ((flags & STAY_FLAG) === 0 && stayMinutes !== 0)
  ) {
    throw invalid();
  }

  return {
    latitude: latitude / 1e7,
    longitude: longitude / 1e7,
    time,
    stayUntil: (flags & STAY_FLAG) !== 0 ? time + stayMinutes * MINUTE_MS : null,
    accuracy: decodeUint16(view.getUint16(17), 10),
    speed: decodeUint16(view.getUint16(19), 100),
    battery: {
      level: level === UNKNOWN_BATTERY_LEVEL ? null : level,
      charging: (battery & 0x80) !== 0,
    },
    ...((flags & DRIVE_DETECTION_OFF_FLAG) !== 0 ? { driveDetectionOff: true as const } : {}),
    ...((flags & CRASH_ALERTS_OFF_FLAG) !== 0 ? { crashAlertsOff: true as const } : {}),
  };
};
