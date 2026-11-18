import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { trpc, trpcClient } from "../lib/api.ts";
import { ensureDeviceKeyRegistration } from "../lib/deviceKeys.ts";
import { createHistoryKeyReader, unwrapEpochKeyFromWraps } from "../lib/epochKeys.ts";
import { buildTimeline } from "../lib/timeline.ts";
import { buildTimelineDayPicker, timelineWindowStart } from "../lib/timelineDays.ts";
import { loadTimelineDay } from "../lib/timelineLoad.ts";
import type {
  TimelineDay,
  TimelineDecryptProgress,
  TimelineDeviceData,
  TimelineSender,
} from "../lib/timelineTypes.ts";

export const useTimelineDays = (groupId: string, userId?: string) => {
  const query = useQuery(trpc.groupTracking.historyDays.queryOptions({ groupId }));
  const { data, dataUpdatedAt } = query;
  const windowStart = useMemo(() => (data ? timelineWindowStart(data) : null), [data]);
  const days = useMemo(
    () =>
      data && windowStart
        ? buildTimelineDayPicker({ devices: data.devices, now: dataUpdatedAt, userId, windowStart })
        : null,
    [data, dataUpdatedAt, userId, windowStart],
  );
  return { days, query, windowStart };
};

export const useTimelineDay = ({
  day,
  groupId,
  senders,
  userIds,
  windowStart,
}: {
  day: TimelineDay | null;
  groupId: string;
  senders: readonly TimelineSender[];
  userIds: readonly string[];
  windowStart: Date | null;
}) => {
  const people = [...userIds].sort();
  const loadKey = JSON.stringify([day?.key, people]);
  const [progress, setProgress] = useState<{
    loadKey: string;
    people: TimelineDecryptProgress[];
  } | null>(null);
  const [partial, setPartial] = useState<{
    devices: TimelineDeviceData[];
    joinStart: number | null;
    loadKey: string;
    now: number;
  } | null>(null);
  const query = useQuery({
    enabled: day !== null && userIds.length > 0,
    queryKey: ["timelineDay", groupId, day?.key, people],
    staleTime: 60_000,
    queryFn: async ({ signal }) => {
      if (!day) throw new Error("No day is selected.");
      const device = await ensureDeviceKeyRegistration();
      const getHistoryKey = createHistoryKeyReader(device.userId);
      const now = Date.now();
      return loadTimelineDay({
        day,
        fetchRange: (input) => trpcClient.groupTracking.historyRange.query(input, { signal }),
        groupId,
        listEpochs: (cursor) =>
          trpcClient.groupEpoch.listEpochKeyWraps.query(
            { cursor, deviceId: device.deviceId, groupId },
            { signal },
          ),
        onPersonReady: ({ devices, joinStart }) => {
          if (signal.aborted) return;
          setPartial((current) => ({
            devices: [
              ...(current?.loadKey === loadKey && current.now === now ? current.devices : []),
              ...devices,
            ],
            joinStart,
            loadKey,
            now,
          }));
        },
        onProgress: (value) => {
          if (!signal.aborted) setProgress({ loadKey, people: value });
        },
        signal,
        unwrapEpoch: (epoch) =>
          unwrapEpochKeyFromWraps({ device, epochId: epoch.epochId, getHistoryKey, wraps: epoch }),
        userIds,
        yieldToUi: () => new Promise((resolve) => setTimeout(resolve, 0)),
      });
    },
  });
  const { data, dataUpdatedAt } = query;
  const shownPartial = partial?.loadKey === loadKey ? partial : null;
  const timeline = useMemo(() => {
    if (!day || !windowStart) return null;
    const loaded = data
      ? { devices: data.devices, joinStart: data.joinStart, now: dataUpdatedAt }
      : shownPartial;
    if (!loaded) return null;
    return buildTimeline({
      day,
      devices: loaded.devices,
      joinStart: loaded.joinStart,
      now: loaded.now,
      senders,
      windowStart: windowStart.getTime(),
    });
  }, [data, dataUpdatedAt, day, senders, shownPartial, windowStart]);
  return {
    joinStart: data?.joinStart ?? shownPartial?.joinStart ?? null,
    progress: progress?.loadKey === loadKey ? progress.people : null,
    query,
    timeline,
  };
};
