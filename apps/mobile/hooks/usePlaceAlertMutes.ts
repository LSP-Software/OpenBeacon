import { useIsFocused } from "@react-navigation/native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert } from "../lib/alert.ts";
import { trpc } from "../lib/api.ts";
import { errorReason } from "../lib/errorReason.ts";
import { applyMuteChange, type PlaceAlertMuteChange } from "../lib/placeAlertMutes.ts";
import { groupPlacesQueryKey } from "../lib/placeSync.ts";
import { userMessage } from "../lib/userMessage.ts";

export const usePlaceAlertMutes = (groupId: string) => {
  const isFocused = useIsFocused();
  const queryClient = useQueryClient();
  const mutesQueryOptions = trpc.placeAlerts.mutes.queryOptions({ groupId });
  const mutes = useQuery({ ...mutesQueryOptions, subscribed: isFocused });
  const mutationKey = [...trpc.placeAlerts.setMute.mutationKey(), groupId];
  const isLastChange = () => queryClient.isMutating({ mutationKey }) === 1;
  const setMute = useMutation({
    ...trpc.placeAlerts.setMute.mutationOptions({
      onMutate: async (change) => {
        await queryClient.cancelQueries({ queryKey: mutesQueryOptions.queryKey });
        const previous = queryClient.getQueryData(mutesQueryOptions.queryKey);
        if (previous) {
          queryClient.setQueryData(mutesQueryOptions.queryKey, {
            mutes: applyMuteChange(previous.mutes, change),
          });
        }
        return { previous };
      },
      onError: (error, _change, context) => {
        if (isLastChange()) queryClient.setQueryData(mutesQueryOptions.queryKey, context?.previous);
        if (errorReason(error) === "PLACE_GONE") {
          void queryClient.invalidateQueries({ queryKey: groupPlacesQueryKey(groupId) });
        }
        Alert.alert("Unable to change alerts", userMessage(error));
      },
      onSettled: () =>
        isLastChange()
          ? queryClient.invalidateQueries({ queryKey: mutesQueryOptions.queryKey })
          : undefined,
    }),
    mutationKey,
    scope: { id: `placeAlerts.setMute:${groupId}` },
  });
  return {
    mutes,
    setMute: (change: PlaceAlertMuteChange) => setMute.mutate({ groupId, ...change }),
  };
};
