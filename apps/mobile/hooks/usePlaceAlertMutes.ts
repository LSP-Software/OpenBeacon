import { useIsFocused } from "@react-navigation/native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert } from "../lib/alert.ts";
import { trpc } from "../lib/api.ts";
import { applyMuteChange } from "../lib/placeAlertMutes.ts";

export const usePlaceAlertMutes = (groupId: string) => {
  const isFocused = useIsFocused();
  const queryClient = useQueryClient();
  const mutesQueryOptions = trpc.placeAlerts.mutes.queryOptions({ groupId });
  const mutes = useQuery({ ...mutesQueryOptions, subscribed: isFocused });
  const setMute = useMutation(
    trpc.placeAlerts.setMute.mutationOptions({
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
        queryClient.setQueryData(mutesQueryOptions.queryKey, context?.previous);
        void queryClient.invalidateQueries({ queryKey: ["groupPlaces", groupId] });
        Alert.alert("Unable to change alerts", error.message);
      },
      onSettled: () => queryClient.invalidateQueries({ queryKey: mutesQueryOptions.queryKey }),
    }),
  );
  return {
    mutes,
    setMute: (change: { placeId: string; mutedUserId: string | null; muted: boolean }) =>
      setMute.mutate({ groupId, ...change }),
  };
};
