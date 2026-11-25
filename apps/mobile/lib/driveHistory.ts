import type { DriveRecord } from "@openbeacon/encryption";
import { formatDriveDuration } from "./driveFormat.ts";
import { type DistanceUnit, formatDistance, formatSpeed, type SpeedUnit } from "./units.ts";

export const driveHistoryItems = ({
  drives,
  nameOf,
  units,
}: {
  drives: readonly { driveId: string; record: DriveRecord | null; senderUserId: string }[];
  nameOf: (userId: string) => string;
  units: { distance: DistanceUnit; speed: SpeedUnit };
}) =>
  drives.flatMap(({ driveId, record, senderUserId }) => {
    if (!record) return [];
    const name = nameOf(senderUserId);
    return [
      {
        kind: "drive" as const,
        id: `drive:${driveId}`,
        driveId,
        at: new Date(record.end.time),
        ...(record.passenger
          ? {
              title: `${name} finished a passenger drive`,
              chips: [],
              note: `${name} marked it “I was a passenger”, so it has no numbers.`,
            }
          : {
              title: `${name} finished a drive`,
              chips: [
                formatDistance(record.distance, units.distance),
                formatDriveDuration(record.duration),
                `Top ${formatSpeed(record.topSpeed, units.speed)}`,
              ],
              note: null,
            }),
      },
    ];
  });
