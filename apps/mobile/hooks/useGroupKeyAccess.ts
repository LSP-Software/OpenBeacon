import { useIsFocused } from "@react-navigation/native";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { AppState } from "react-native";
import { trpcClient } from "../lib/api.ts";
import { ensureDeviceKeyRegistration } from "../lib/deviceKeys.ts";
import { createHistoryKeyReader, unwrapEpochKeyFromWraps } from "../lib/epochKeys.ts";
import { checkGroupKeyAccess } from "../lib/groupKeyAccess.ts";
import { subscribeToGroupEpochChanges, subscribeToTrackingSync } from "../lib/trackingEvents.ts";

const resolvableEpochs = new Set<string>();

export const useGroupKeyAccess = (groupIds: string[], userId: string | undefined) => {
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
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") refresh();
    });
    return () => {
      unsubscribe();
      unsubscribeEpoch();
      subscription.remove();
    };
  }, [isFocused, queryClient, userId]);

  return useQueries({
    queries: groupIds.map((groupId) => ({
      queryKey: ["groupKeyAccess", userId, groupId],
      enabled: Boolean(userId && isFocused),
      queryFn: async () => {
        if (!userId) throw new Error("User is unavailable");
        const device = await ensureDeviceKeyRegistration();
        const getHistoryKey = createHistoryKeyReader(device.userId);
        return checkGroupKeyAccess({
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
          listEpochs: (cursor: number | null) =>
            trpcClient.groupEpoch.listEpochKeyWraps.query({
              cursor,
              deviceId: device.deviceId,
              groupId,
            }),
        });
      },
    })),
  });
};
