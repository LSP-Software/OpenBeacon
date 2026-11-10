import { useIsFocused } from "@react-navigation/native";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { type RouterOutputs, trpcClient } from "../lib/api.ts";
import { ensureDeviceKeyRegistration } from "../lib/deviceKeys.ts";
import { createHistoryKeyReader, unwrapEpochKeyFromWraps } from "../lib/epochKeys.ts";
import { checkCurrentKeyAccess, checkGroupKeyAccess } from "../lib/groupKeyAccess.ts";
import { subscribeToGroupEpochChanges, subscribeToTrackingSync } from "../lib/trackingEvents.ts";

const resolvableEpochs = new Set<string>();

export const useCurrentGroupKeyAccess = (groupIds: string[], userId: string | undefined) =>
  useGroupKeyAccessQueries({
    groupIds,
    run: ({ canResolve, deviceId, groupId }) =>
      checkCurrentKeyAccess({
        canResolve,
        listLatestEpoch: () =>
          trpcClient.groupEpoch.listEpochKeyWraps.query({ deviceId, groupId, limit: 1 }),
      }),
    scope: "current",
    userId,
  });

export const useGroupKeyHistoryAccess = (groupIds: string[], userId: string | undefined) =>
  useGroupKeyAccessQueries({
    groupIds,
    run: ({ canResolve, deviceId, groupId }) =>
      checkGroupKeyAccess({
        canResolve,
        listEpochs: (cursor: number | null) =>
          trpcClient.groupEpoch.listEpochKeyWraps.query({ cursor, deviceId, groupId }),
      }),
    scope: "history",
    userId,
  });

const useGroupKeyAccessQueries = <Result>({
  groupIds,
  run,
  scope,
  userId,
}: {
  groupIds: string[];
  run: (args: {
    canResolve: (
      epoch: RouterOutputs["groupEpoch"]["listEpochKeyWraps"]["epochs"][number],
    ) => Promise<boolean>;
    deviceId: string;
    groupId: string;
  }) => Promise<Result>;
  scope: "current" | "history";
  userId: string | undefined;
}) => {
  const isFocused = useIsFocused();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!userId || !isFocused) return;
    const refresh = () => {
      void queryClient.invalidateQueries({ queryKey: ["groupKeyAccess", userId] });
    };
    const unsubscribe = subscribeToTrackingSync(refresh);
    const unsubscribeEpoch = subscribeToGroupEpochChanges((groupId) => {
      void queryClient.invalidateQueries({ queryKey: ["groupKeyAccess", userId, groupId] });
    });
    return () => {
      unsubscribe();
      unsubscribeEpoch();
    };
  }, [isFocused, queryClient, userId]);

  return useQueries({
    queries: groupIds.map((groupId) => ({
      queryKey: ["groupKeyAccess", userId, groupId, scope],
      enabled: Boolean(userId && isFocused),
      staleTime: Infinity,
      queryFn: async () => {
        if (!userId) throw new Error("User is unavailable");
        const device = await ensureDeviceKeyRegistration();
        const getHistoryKey = createHistoryKeyReader(device.userId);
        return run({
          deviceId: device.deviceId,
          groupId,
          canResolve: async (epoch) => {
            const cacheKey = JSON.stringify([
              device.userId,
              device.deviceId,
              groupId,
              epoch.epochId,
              epoch.deviceWrap !== null,
              epoch.historyWraps.map(({ historyKeyVersion }) => historyKeyVersion),
            ]);
            if (resolvableEpochs.has(cacheKey)) return true;
            const epochKey = await unwrapEpochKeyFromWraps({
              device,
              epochId: epoch.epochId,
              getHistoryKey,
              wraps: epoch,
            });
            if (epochKey) resolvableEpochs.add(cacheKey);
            return epochKey !== null;
          },
        });
      },
    })),
  });
};
