import type { DriveRecord } from "@openbeacon/encryption";
import { formatDriveDuration } from "./driveFormat.ts";
import { type DistanceUnit, formatDistance, formatSpeed, type SpeedUnit } from "./units.ts";

const FRESH_MS = 30 * 60_000;

export const driveAlertsToShow = ({
  copies,
  nameOf,
  now,
  shown,
  units,
}: {
  copies: readonly {
    driveId: string;
    groupId: string;
    record: DriveRecord;
    senderUserId: string;
  }[];
  nameOf: (userId: string, groupId: string) => string;
  now: number;
  shown: ReadonlySet<string>;
  units: { distance: DistanceUnit; speed: SpeedUnit };
}) => {
  const alerts: {
    driveId: string;
    groupId: string;
    userId: string;
    title: string;
    body: string | null;
  }[] = [];
  for (const copy of copies) {
    const { record } = copy;
    if (
      !record.tellGroup ||
      now - record.end.time > FRESH_MS ||
      shown.has(copy.driveId) ||
      alerts.some((alert) => alert.driveId === copy.driveId)
    ) {
      continue;
    }
    const name = nameOf(copy.senderUserId, copy.groupId);
    alerts.push({
      driveId: copy.driveId,
      groupId: copy.groupId,
      userId: copy.senderUserId,
      ...(record.passenger
        ? { title: `${name} finished a passenger drive`, body: null }
        : {
            title: `${name} finished a ${formatDistance(record.distance, units.distance)} drive`,
            body: `${formatDriveDuration(record.duration)} · top ${formatSpeed(record.topSpeed, units.speed)}`,
          }),
    });
  }
  return alerts;
};
