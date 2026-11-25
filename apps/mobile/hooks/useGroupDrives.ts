import { decodeDriveRecord, markPassengerDrive } from "@openbeacon/encryption";
import { tryCatch } from "@openbeacon/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { trpcClient } from "../lib/api.ts";
import { drivingAgain, rewriteDriveCopies } from "../lib/driveActions.ts";
import { createDriveCache, type LoadedDrive, loadGroupDrives } from "../lib/driveLoad.ts";
import { ensureDeviceKeyRegistration } from "../lib/deviceKeys.ts";
import { resolveEpochKey } from "../lib/epochKeys.ts";
import { getOwner } from "../lib/tracking.ts";
import OpenBeaconTracking from "../modules/openbeacon-tracking/index.ts";

const HOUR_MS = 3_600_000;
const caches = new Map<string, ReturnType<typeof createDriveCache>>();

const epochKeyReader = async () => {
  const device = await ensureDeviceKeyRegistration();
  return {
    device,
    epochKeyFor: async (groupId: string, epochId: string) =>
      (await tryCatch(resolveEpochKey({ device, epochId, groupId }))).data ?? null,
  };
};

export const useGroupDrives = (groupId: string, windowStart: Date | null) => {
  const queryClient = useQueryClient();
  const query = useQuery({
    enabled: windowStart !== null,
    queryKey: ["groupDrives", groupId, windowStart?.getTime()],
    refetchInterval: 60_000,
    queryFn: async ({ signal }) => {
      if (!windowStart) throw new Error("The history window isn't known yet.");
      const { device, epochKeyFor } = await epochKeyReader();
      const cache = caches.get(device.userId) ?? createDriveCache();
      caches.set(device.userId, cache);
      const drives = await loadGroupDrives({
        cache,
        epochKeyFor: (epochId) => epochKeyFor(groupId, epochId),
        fetchDrives: (input) => trpcClient.groupTracking.drives.query(input, { signal }),
        fromHour: Math.floor(windowStart.getTime() / HOUR_MS),
        groupId,
        toHour: Math.floor(Date.now() / HOUR_MS) + 1,
      });
      return { drives, thisDeviceId: device.deviceId };
    },
  });

  const refresh = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ["groupDrives"] }),
    [queryClient],
  );

  const rewrite = useCallback(
    async (drive: LoadedDrive, change: "passenger" | "driving") => {
      const { device, epochKeyFor } = await epochKeyReader();
      const groups = await trpcClient.groupMembership.list.query();
      let next = markPassengerDrive;
      if (change === "driving") {
        const bytes = await OpenBeaconTracking.readDriveRecord(
          getOwner(device.userId),
          drive.driveId,
        );
        if (!bytes) throw new Error("The full drive is no longer kept here.");
        next = drivingAgain(decodeDriveRecord(new Uint8Array(bytes)));
      }
      await rewriteDriveCopies({
        driveId: drive.driveId,
        epochKeyFor,
        fetchDrives: (input) => trpcClient.groupTracking.drives.query(input),
        groupIds: groups.map((group) => group.id),
        replace: (input) => trpcClient.drives.replace.mutate(input),
        rewrite: next,
        selfUserId: device.userId,
        startHour: drive.startHour,
      });
      await refresh();
    },
    [refresh],
  );

  const remove = useCallback(
    async (drive: LoadedDrive) => {
      const device = await ensureDeviceKeyRegistration();
      await trpcClient.drives.delete.mutate({ driveIds: [drive.driveId] });
      if (drive.senderDeviceId === device.deviceId) {
        await tryCatch(OpenBeaconTracking.deleteDrives(getOwner(device.userId), [drive.driveId]));
      }
      await refresh();
    },
    [refresh],
  );

  return { query, remove, rewrite };
};
