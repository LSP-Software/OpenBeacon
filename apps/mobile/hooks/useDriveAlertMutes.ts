import { useIsFocused } from "@react-navigation/native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert } from "../lib/alert.ts";
import { trpc } from "../lib/api.ts";
import { applyDriveMuteChange } from "../lib/driveAlertMutes.ts";
import { userMessage } from "../lib/userMessage.ts";

export const useDriveAlertMutes = (groupId: string | undefined) => {
  const isFocused = useIsFocused();
  const queryClient = useQueryClient();
  const mutesQueryOptions = trpc.driveAlerts.mutes.queryOptions({ groupId: groupId ?? "" });
  const mutes = useQuery({
    ...mutesQueryOptions,
    enabled: groupId !== undefined,
    subscribed: isFocused,
  });
  const mutationKey = [...trpc.driveAlerts.setMute.mutationKey(), groupId];
  const isLastChange = () => queryClient.isMutating({ mutationKey }) === 1;
  const setMute = useMutation({
    ...trpc.driveAlerts.setMute.mutationOptions({
      onMutate: async (change) => {
        await queryClient.cancelQueries({ queryKey: mutesQueryOptions.queryKey });
        const previous = queryClient.getQueryData(mutesQueryOptions.queryKey);
        if (previous) {
          queryClient.setQueryData(mutesQueryOptions.queryKey, {
            mutes: applyDriveMuteChange(previous.mutes, change),
          });
        }
        return { previous };
      },
      onError: (error, _change, context) => {
        if (isLastChange()) queryClient.setQueryData(mutesQueryOptions.queryKey, context?.previous);
        Alert.alert("Couldn’t change Drive alerts", userMessage(error));
      },
      onSettled: () =>
        isLastChange()
          ? queryClient.invalidateQueries({ queryKey: mutesQueryOptions.queryKey })
          : undefined,
    }),
    mutationKey,
    scope: { id: `driveAlerts.setMute:${groupId}` },
  });
  return {
    mutes,
    setMute: (change: { mutedUserId: string | null; muted: boolean }) => {
      if (groupId) setMute.mutate({ groupId, ...change });
    },
  };
};
