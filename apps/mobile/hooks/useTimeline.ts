import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { trpc, trpcClient } from "../lib/api.ts";
import { ensureDeviceKeyRegistration } from "../lib/deviceKeys.ts";
import { createHistoryKeyReader, unwrapEpochKeyFromWraps } from "../lib/epochKeys.ts";
import { buildTimeline } from "../lib/timeline.ts";
import { buildTimelineDayPicker } from "../lib/timelineDays.ts";
import { loadTimelineDay } from "../lib/timelineLoad.ts";
import type { TimelineDay } from "../lib/timelineTypes.ts";

export const useTimelineDays = (groupId: string, userId?: string) => {
  const query = useQuery(trpc.groupTracking.historyDays.queryOptions({ groupId }));
  const { data, dataUpdatedAt } = query;
  const days = useMemo(
    () =>
      data
        ? buildTimelineDayPicker({
            devices: data.devices,
            now: dataUpdatedAt,
            userId,
            windowStart: data.windowStart,
          })
        : null,
    [data, dataUpdatedAt, userId],
  );
  return { days, query, windowStart: data?.windowStart ?? null };
};

export const useTimelineDay = ({
  day,
  groupId,
  windowStart,
}: {
  day: TimelineDay | null;
  groupId: string;
  windowStart: Date | null;
}) => {
  const [progress, setProgress] = useState<{
    dayKey: string;
    decrypted: number;
    total: number;
  } | null>(null);
  const query = useQuery({
    enabled: day !== null,
    queryKey: ["timelineDay", groupId, day?.key],
    staleTime: 60_000,
    queryFn: async ({ signal }) => {
      if (!day) throw new Error("No day is selected.");
      const device = await ensureDeviceKeyRegistration();
      const getHistoryKey = createHistoryKeyReader(device.userId);
      return loadTimelineDay({
        day,
        fetchRange: (input) => trpcClient.groupTracking.historyRange.query(input, { signal }),
        groupId,
        listEpochs: (cursor) =>
          trpcClient.groupEpoch.listEpochKeyWraps.query(
            { cursor, deviceId: device.deviceId, groupId },
            { signal },
          ),
        now: Date.now(),
        onProgress: (value) => {
          if (!signal.aborted) setProgress({ ...value, dayKey: day.key });
        },
        signal,
        unwrapEpoch: (epoch) =>
          unwrapEpochKeyFromWraps({ device, epochId: epoch.epochId, getHistoryKey, wraps: epoch }),
        yieldToUi: () => new Promise((resolve) => setTimeout(resolve, 0)),
      });
    },
  });
  const { data, dataUpdatedAt } = query;
  const timeline = useMemo(
    () =>
      data && day && windowStart
        ? buildTimeline({
            day,
            devices: data.devices,
            joinStart: data.joinStart,
            now: dataUpdatedAt,
            windowStart: windowStart.getTime(),
          })
        : null,
    [data, dataUpdatedAt, day, windowStart],
  );
  return {
    progress: progress && progress.dayKey === day?.key ? progress : null,
    query,
    timeline,
  };
};
