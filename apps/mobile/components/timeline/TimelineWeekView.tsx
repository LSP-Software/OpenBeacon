import type { DriveRecord } from "@openbeacon/encryption";
import type { ReactNode } from "react";
import { View } from "react-native";
import type { usePersonDrives } from "../../hooks/useGroupDrives.ts";
import type { LoadedDrive } from "../../lib/driveLoad.ts";
import type { DistanceUnit, SpeedUnit } from "../../lib/units.ts";
import { driverWeekOf, weeklyDrivingReport } from "../../lib/weeklyDrivingReport.ts";
import { Text } from "../ui/Text.tsx";
import { ProblemNote } from "./ProblemNote.tsx";
import { WeeklyDrivingReport } from "./WeeklyDrivingReport.tsx";

export const TimelineWeekView = ({
  detectionOffText,
  deviceId,
  groupDrives,
  groupName,
  header,
  isOwn,
  name,
  onOpen,
  onSeeAll,
  onStep,
  personDrives,
  personId,
  rowOf,
  top,
  units,
  weekStep,
}: {
  detectionOffText: string | null;
  deviceId: string | null;
  groupDrives: readonly LoadedDrive[];
  groupName: string;
  header: ReactNode;
  isOwn: boolean;
  name: string;
  onOpen: (drive: LoadedDrive & { record: DriveRecord }) => void;
  onSeeAll: () => void;
  onStep: (weeks: number) => void;
  personDrives: ReturnType<typeof usePersonDrives>;
  personId: string | null;
  rowOf: (drive: { record: DriveRecord }) => {
    figures: string;
    score: number | null;
    title: string;
  };
  top: number;
  units: { distance: DistanceUnit; speed: SpeedUnit };
  weekStep: number;
}) => {
  if (personId === null) {
    return (
      <View
        className="absolute inset-x-0 bottom-0 items-center bg-background px-6 pt-10"
        style={{ top }}
      >
        <Text className="text-center text-tertiary">
          Choose someone above to see their week of driving.
        </Text>
      </View>
    );
  }
  const weekDrives = (personDrives.data?.drives ?? []).filter(
    (drive) => drive.senderDeviceId === deviceId,
  );
  const weekOffset =
    weekDrives
      .flatMap((drive) => (drive.record ? [drive.record] : []))
      .sort((first, second) => second.start.time - first.start.time)[0]?.utcOffsetMinutes ??
    -new Date().getTimezoneOffset();
  const thisMonday = driverWeekOf(Date.now(), weekOffset).monday;
  const report = personDrives.data
    ? weeklyDrivingReport({
        drives: weekDrives,
        monday: thisMonday + weekStep * 7,
        now: Date.now(),
        offsetMinutes: weekOffset,
        visibleFrom: personDrives.data.visibleFrom,
      })
    : null;
  const sharedWithNames = (personDrives.data?.groups ?? [])
    .filter((item) => item.members > 1)
    .map((item) => item.name);
  const sharedWith =
    sharedWithNames.length > 1
      ? `${sharedWithNames.slice(0, -1).join(", ")} and ${sharedWithNames.at(-1)}`
      : (sharedWithNames[0] ?? groupName);
  return (
    <WeeklyDrivingReport
      canGoForward={weekStep < 0}
      detectionOffText={detectionOffText}
      footer={
        personDrives.isError ? (
          <ProblemNote
            message="Couldn’t load drives. Check your connection and try again."
            loading={personDrives.isFetching}
            onRetry={() => void personDrives.refetch()}
          />
        ) : null
      }
      header={header}
      isOwn={isOwn}
      loading={personDrives.isPending}
      name={name}
      onOpen={(drive) => {
        const inGroup = groupDrives.find((item) => item.driveId === drive.driveId);
        if (inGroup?.record) onOpen({ ...inGroup, record: inGroup.record });
      }}
      onSeeAll={onSeeAll}
      onStep={onStep}
      report={report}
      rowOf={(drive) => ({
        ...rowOf(drive),
        canOpen: groupDrives.some((item) => item.driveId === drive.driveId && item.record),
      })}
      sharedWith={sharedWith}
      thisMonday={thisMonday}
      top={top}
      units={units}
    />
  );
};
