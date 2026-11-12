import { isSharingPaused, tryCatch } from "@openbeacon/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PauseIcon } from "lucide-react-native";
import { useState } from "react";
import { View } from "react-native";
import { trpc } from "../../lib/api.ts";
import {
  changeLocationSharing,
  getPendingSharingChanges,
  hasLocallyPausedSharing,
} from "../../lib/locationSharing.ts";
import { Button } from "../ui/Button.tsx";
import { Icon } from "../ui/Icon.tsx";
import { Text } from "../ui/Text.tsx";

export const LocationSharingPausedBanner = ({
  subscribed,
  userId,
}: {
  subscribed: boolean;
  userId: string;
}) => {
  const queryClient = useQueryClient();
  const sharing = useQuery({
    ...trpc.account.locationSharing.queryOptions(),
    enabled: userId.length > 0,
    refetchInterval: 15_000,
    subscribed,
  });
  const [failed, setFailed] = useState(false);
  const resume = useMutation({
    mutationFn: async () => {
      const pending = getPendingSharingChanges(userId);
      const accountPaused =
        pending.account?.paused ?? (sharing.data ? isSharingPaused(sharing.data.account) : false);
      const devicePaused =
        pending.device?.paused ?? (sharing.data ? isSharingPaused(sharing.data.device) : false);
      if (accountPaused) {
        await changeLocationSharing({ scope: "account", paused: false, durationMinutes: null });
      }
      if (devicePaused || !accountPaused) {
        await changeLocationSharing({ scope: "device", paused: false, durationMinutes: null });
      }
    },
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: trpc.account.locationSharing.queryKey() }),
        queryClient.invalidateQueries({ queryKey: trpc.account.listDevices.queryKey() }),
      ]),
  });
  const paused =
    userId.length > 0 && (hasLocallyPausedSharing(userId) || sharing.data?.paused === true);
  if (!paused) return null;

  return (
    <View
      accessibilityLiveRegion="polite"
      className="mb-2 gap-1 rounded-xl border border-border bg-card px-3 py-2"
    >
      <View className="flex-row items-center gap-3">
        <Icon as={PauseIcon} size={16} className="text-foreground" />
        <Text className="flex-1 text-sm font-medium">Your location sharing is paused</Text>
        <Button
          size="sm"
          variant="outline"
          loading={resume.isPending}
          onPress={async () => {
            setFailed(false);
            const result = await tryCatch(resume.mutateAsync());
            setFailed(result.error !== null);
          }}
        >
          <Text>Resume</Text>
        </Button>
      </View>
      {failed ? (
        <Text className="text-sm text-muted-foreground">
          Couldn’t resume sharing. Check your connection and try again.
        </Text>
      ) : null}
    </View>
  );
};
