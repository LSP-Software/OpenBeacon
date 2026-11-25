import type { DriveRecord } from "@openbeacon/encryption";
import type { ReactNode } from "react";
import type { useGroupDrives } from "../../hooks/useGroupDrives.ts";
import type { driveListDays } from "../../lib/driveList.ts";
import type { LoadedDrive } from "../../lib/driveLoad.ts";
import { formatTimelineDate } from "../../lib/timelineClock.ts";
import { localDayOf } from "../../lib/timelineDays.ts";
import { DrivesList } from "./DrivesList.tsx";
import { ProblemNote } from "./ProblemNote.tsx";

export const TimelineDrivesView = ({
  days,
  deviceName,
  formatClock,
  groupName,
  header,
  name,
  onOpen,
  onSwitchDevice,
  personId,
  placeName,
  query,
  rowOf,
  top,
}: {
  days: ReturnType<typeof driveListDays<LoadedDrive>>;
  deviceName: (deviceId: string) => string;
  formatClock: (time: number) => string;
  groupName: string;
  header: ReactNode;
  name: string | undefined;
  onOpen: (drive: LoadedDrive & { record: DriveRecord }) => void;
  onSwitchDevice: (deviceId: string) => void;
  personId: string | null;
  placeName: (placeId: string | null) => string | null;
  query: ReturnType<typeof useGroupDrives>["query"];
  rowOf: (drive: { record: DriveRecord }) => {
    figures: string;
    score: number | null;
    title: string;
  };
  top: number;
}) => (
  <DrivesList
    days={days}
    emptyText={
      personId
        ? `No drives from ${name ?? "this person"} in the history shared with ${groupName}.`
        : "Choose someone above to see their drives."
    }
    footer={
      query.isError ? (
        <ProblemNote
          message="Couldn’t load drives. Check your connection and try again."
          loading={query.isFetching}
          onRetry={() => void query.refetch()}
        />
      ) : null
    }
    formatClock={formatClock}
    header={header}
    loading={personId !== null && query.isPending}
    onOpen={onOpen}
    otherDeviceNote={(day, other) => {
      const otherName = deviceName(other.deviceId);
      const when =
        localDayOf(Date.now()).key === day.key ? "today" : `on ${formatTimelineDate(day.start)}`;
      return {
        label: `${otherName} recorded ${other.count === 1 ? "1 drive" : `${other.count} drives`} ${when} too. Switch to ${otherName} to see ${other.count === 1 ? "it" : "them"}.`,
        onPress: () => onSwitchDevice(other.deviceId),
      };
    }}
    placeName={placeName}
    rowOf={rowOf}
    top={top}
  />
);
