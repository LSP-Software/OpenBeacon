import { tryCatch } from "@openbeacon/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";
import { Alert } from "../lib/alert.ts";
import { trpc, trpcClient } from "../lib/api.ts";
import { historyShareLabel, shortensHistory } from "../lib/historyShare.ts";
import type { HistoryShareChange } from "../lib/historyShareTypes.ts";
import { syncLocationSharing } from "../lib/locationSharing.ts";
import { userMessage } from "../lib/userMessage.ts";

const confirmShortening = (label: string, groupName: string | null) =>
  new Promise<"cancel" | "change" | "saveCopy">((resolve) =>
    Alert.alert(
      `Change to “${label}”?`,
      `${
        groupName === null
          ? "This deletes your older location history from the server straight away, so your groups can’t see it any more."
          : `This deletes your older location history in ${groupName} from the server straight away, so its members can’t see it any more.`
      } Copies members have already seen on their phones aren’t deleted. You can save a copy of your own history first.`,
      [
        { text: "Cancel", style: "cancel", onPress: () => resolve("cancel") },
        { text: "Save a copy first", onPress: () => resolve("saveCopy") },
        { text: "Delete and change", style: "destructive", onPress: () => resolve("change") },
      ],
      { cancelable: true, onDismiss: () => resolve("cancel") },
    ),
  );

export const useHistoryShare = (
  enabled = true,
  saveCopy = () => router.push("/account/location-history"),
) => {
  const queryClient = useQueryClient();
  const query = useQuery({
    ...trpc.account.locationSharing.queryOptions(),
    enabled,
    select: (data) => data.historyShare,
  });
  const [saving, setSaving] = useState(false);

  const change = async (next: HistoryShareChange, groupName = "this group") => {
    const setting = query.data;
    if (!setting || saving) return false;
    const label = historyShareLabel(
      "account" in next ? next.account : (next.override ?? setting.account),
    );
    const shortens = shortensHistory({
      groupIds: setting.groups.map(({ groupId }) => groupId),
      next,
      setting,
    });
    if (shortens) {
      const choice = await confirmShortening(label, "account" in next ? null : groupName);
      if (choice === "saveCopy") saveCopy();
      if (choice !== "change") return false;
    }
    setSaving(true);
    const result = await tryCatch<unknown>(
      "account" in next
        ? trpcClient.account.setHistoryShare.mutate({ historyShare: next.account })
        : trpcClient.groupSettings.setHistoryShare.mutate({
            groupId: next.groupId,
            historyShare: next.override,
          }),
    );
    setSaving(false);
    if (result.error) {
      Alert.alert("Couldn’t change your history setting", userMessage(result.error));
      return false;
    }
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: trpc.account.locationSharing.queryKey() }),
      queryClient.invalidateQueries({ queryKey: trpc.groupTracking.historyDays.queryKey() }),
      queryClient.invalidateQueries({ queryKey: ["timelineDay"] }),
      tryCatch(syncLocationSharing()),
    ]);
    return true;
  };

  return { change, query, saving, setting: query.data ?? null };
};
