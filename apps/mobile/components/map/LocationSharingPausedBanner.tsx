import { isSharingPaused, tryCatch } from "@openbeacon/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PauseIcon } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { trpc } from "../../lib/api.ts";
import {
  changeLocationSharing,
  getPendingSharingChanges,
  hasLocallyPausedSharing,
  serverNow,
  syncLocationSharing,
} from "../../lib/locationSharing.ts";
import { Button } from "../ui/Button.tsx";
import { Icon } from "../ui/Icon.tsx";
import { Text } from "../ui/Text.tsx";

export const LocationSharingPausedBanner = ({
  polled,
  subscribed,
  userId,
}: {
  polled: { paused: boolean; revisionPrefix: string } | null;
  subscribed: boolean;
  userId: string;
}) => {
  const queryClient = useQueryClient();
  const sharing = useQuery({
    ...trpc.account.locationSharing.queryOptions(),
    enabled: userId.length > 0,
    refetchInterval: polled ? false : 15_000,
    subscribed,
  });
  const polledState = polled ? `${polled.paused}:${polled.revisionPrefix}` : undefined;
  const polledPaused = polled?.paused;
  const loadedPaused = sharing.data?.paused;
  const seenPolledState = useRef(polledState);
  const syncedPolledState = useRef<string | undefined>(undefined);
  useEffect(() => {
    const previous = seenPolledState.current;
    seenPolledState.current = polledState;
    if (polledState === undefined || syncedPolledState.current === polledState) return;
    const changed = previous !== undefined && previous !== polledState;
    const disagrees = loadedPaused !== undefined && loadedPaused !== polledPaused;
    if (!changed && !disagrees) return;
    syncedPolledState.current = polledState;
    void tryCatch(syncLocationSharing()).then((synced) => {
      if (synced.data) {
        queryClient.setQueryData(trpc.account.locationSharing.queryKey(), synced.data);
        return;
      }
      void queryClient.invalidateQueries({ queryKey: trpc.account.locationSharing.queryKey() });
    });
  }, [loadedPaused, polledPaused, polledState, queryClient]);
  const [failure, setFailure] = useState<string | null>(null);
  const resume = useMutation({
    mutationFn: async () => {
      const fresh = await tryCatch(
        queryClient.fetchQuery({ ...trpc.account.locationSharing.queryOptions(), staleTime: 0 }),
      );
      const current = fresh.data ?? sharing.data;
      const pending = getPendingSharingChanges(userId);
      const now = serverNow();
      const accountPaused =
        pending.account?.paused ?? (current ? isSharingPaused(current.account, now) : false);
      const devicePaused =
        pending.device?.paused ?? (current ? isSharingPaused(current.device, now) : false);
      const results = [];
      if (accountPaused) {
        results.push(
          await changeLocationSharing({
            scope: "account",
            paused: false,
            durationMinutes: null,
            ...(current ? { expectedRevision: current.account.sharingRevision } : {}),
          }),
        );
      }
      if (devicePaused || !accountPaused) {
        results.push(
          await changeLocationSharing({
            scope: "device",
            paused: false,
            durationMinutes: null,
            ...(current ? { expectedRevision: current.device.sharingRevision } : {}),
          }),
        );
      }
      return results.includes("superseded");
    },
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: trpc.account.locationSharing.queryKey() }),
        queryClient.invalidateQueries({ queryKey: trpc.account.listDevices.queryKey() }),
      ]),
  });
  const pending = userId.length > 0 ? getPendingSharingChanges(userId) : null;
  const paused =
    userId.length > 0 &&
    (hasLocallyPausedSharing(userId) ||
      (!pending?.account && !pending?.device && sharing.data?.paused === true));
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
            setFailure(null);
            const result = await tryCatch(resume.mutateAsync());
            setFailure(
              result.error
                ? "Couldn’t resume sharing. Check your connection and try again."
                : result.data
                  ? "Location sharing was just changed on another device. Check it and try again."
                  : null,
            );
          }}
        >
          <Text>Resume</Text>
        </Button>
      </View>
      {failure ? <Text className="text-sm text-muted-foreground">{failure}</Text> : null}
    </View>
  );
};
