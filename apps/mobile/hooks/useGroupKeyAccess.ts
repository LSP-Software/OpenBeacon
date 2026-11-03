import { WRAPPED_EPOCH_KEY_ALGORITHM } from "@openbeacon/encryption";
import { useIsFocused } from "@react-navigation/native";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { AppState } from "react-native";
import { trpcClient } from "../lib/api.ts";
import { ensureDeviceKeyRegistration } from "../lib/deviceKeys.ts";
import { checkGroupKeyAccess } from "../lib/groupKeyAccess.ts";
import { subscribeToGroupEpochChanges, subscribeToTrackingSync } from "../lib/trackingEvents.ts";

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
        return checkGroupKeyAccess({
          groupId,
          ensureDeviceKeys: ensureDeviceKeyRegistration,
          getLatestEpoch: (id) => trpcClient.groupEpoch.getLatest.query({ groupId: id }),
          getWrappedKey: async (input) => {
            const wrapped = await trpcClient.groupEpoch.getWrappedKey.query(input);
            if (!wrapped || wrapped.algorithm !== WRAPPED_EPOCH_KEY_ALGORITHM) return null;
            return { ...wrapped, algorithm: WRAPPED_EPOCH_KEY_ALGORITHM };
          },
        });
      },
    })),
  });
};
