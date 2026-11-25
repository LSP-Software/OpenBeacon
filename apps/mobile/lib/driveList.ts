import type { DriveRecord, PlaceGeometryV1 } from "@openbeacon/encryption";
import { metersBetween } from "./places.ts";
import { localDayOf } from "./timelineDays.ts";

const SPLIT_STOP_MS = 30 * 60_000;
const SPLIT_STOP_METERS = 300;

type ListedDrive = {
  driveId: string;
  record: DriveRecord | null;
  senderDeviceId: string;
};
type ReadableDrive<Drive> = Drive & { record: DriveRecord };
type Places = ReadonlyArray<{ geometry: PlaceGeometryV1 | null; id: string }>;

export const drivePlaceId = (places: Places, position: { latitude: number; longitude: number }) => {
  let placeId: string | null = null;
  let nearest = Infinity;
  for (const { geometry, id } of places) {
    if (!geometry) continue;
    const meters = metersBetween(geometry, position);
    if (meters <= geometry.radiusMeters && meters < nearest) {
      nearest = meters;
      placeId = id;
    }
  }
  return placeId;
};

const isReadable = <Drive extends ListedDrive>(drive: Drive): drive is ReadableDrive<Drive> =>
  drive.record !== null;

export const driveListDays = <Drive extends ListedDrive>({
  deviceId,
  drives,
  places = [],
}: {
  deviceId: string;
  drives: readonly Drive[];
  places?: Places;
}) => {
  const readable = drives
    .filter(isReadable)
    .sort((first, second) => second.record.start.time - first.record.start.time);
  const days = new Map<
    string,
    {
      items: Array<
        | { drive: ReadableDrive<Drive>; kind: "drive" }
        | { kind: "stop"; minutes: number; placeId: string | null }
      >;
      key: string;
      otherDevices: Array<{ count: number; deviceId: string }>;
      start: number;
    }
  >();
  let later: ReadableDrive<Drive> | null = null;
  for (const drive of readable) {
    const { key, start } = localDayOf(drive.record.start.time);
    const day = days.get(key) ?? { items: [], key, otherDevices: [], start };
    days.set(key, day);
    if (drive.senderDeviceId !== deviceId) {
      const other = day.otherDevices.find((item) => item.deviceId === drive.senderDeviceId);
      if (other) other.count += 1;
      else day.otherDevices.push({ count: 1, deviceId: drive.senderDeviceId });
      continue;
    }
    const gap = later ? later.record.start.time - drive.record.end.time : Infinity;
    if (
      later &&
      day.items.length > 0 &&
      gap >= 0 &&
      gap <= SPLIT_STOP_MS &&
      metersBetween(drive.record.end, later.record.start) <= SPLIT_STOP_METERS
    ) {
      day.items.push({
        kind: "stop",
        minutes: Math.round(gap / 60_000),
        placeId: drivePlaceId(places, drive.record.end),
      });
    }
    day.items.push({ drive, kind: "drive" });
    later = drive;
  }
  return [...days.values()];
};

export const driveAt = <Drive extends ListedDrive>(
  drives: readonly Drive[],
  deviceId: string,
  time: number,
) =>
  drives
    .filter(isReadable)
    .find(
      (drive) =>
        drive.senderDeviceId === deviceId &&
        drive.record.start.time <= time &&
        time <= drive.record.end.time,
    ) ?? null;
