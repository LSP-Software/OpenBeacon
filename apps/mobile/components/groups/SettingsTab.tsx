import { Alert } from "../../lib/alert.ts";
import { tryCatch } from "@openbeacon/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState } from "react";
import { TextInput, View } from "react-native";
import { HistoryShareChoices } from "../HistoryShareChoices.tsx";
import { GroupMapColorPicker } from "../map/GroupMapColorPicker.tsx";
import { Button } from "../ui/Button.tsx";
import { Switch } from "../ui/Switch.tsx";
import { Text } from "../ui/Text.tsx";
import { useCachedGroup } from "../../hooks/useCachedGroup.ts";
import { useHistoryShare } from "../../hooks/useHistoryShare.ts";
import { useHiddenMapGroupIds } from "../../hooks/useHiddenMapGroupIds.ts";
import { trpc } from "../../lib/api.ts";
import { authClient } from "../../lib/auth-client.ts";
import { groupHistoryShare } from "../../lib/historyShare.ts";
import { forgetHiddenMapGroup, setMapGroupHidden } from "../../lib/hiddenMapGroups.ts";
import { canHideMapGroups } from "../../lib/mapGroupVisibility.ts";
import { requestTrackingSync } from "../../lib/trackingEvents.ts";
import { userMessage } from "../../lib/userMessage.ts";

const SettingsTab = ({ groupId }: { groupId: string }) => {
  const { data: session } = authClient.useSession();
  const { group, groupCount } = useCachedGroup(groupId);
  const hiddenGroupIds = useHiddenMapGroupIds(session?.user.id);
  const shownOnMap = !hiddenGroupIds.includes(groupId);
  const [name, setName] = useState("");
  const queryClient = useQueryClient();
  const router = useRouter();
  const rename = useMutation(trpc.groupSettings.rename.mutationOptions());
  const deleteGroup = useMutation(trpc.groupLifecycle.delete.mutationOptions());
  const historyShare = useHistoryShare();
  const role = group?.members.find((member) => member.userId === session?.user.id)?.role;

  return (
    <View className="gap-3">
      {(role === "OWNER" || role === "ADMIN") && (
        <View className="gap-3">
          <Text variant="label">Group name</Text>
          <TextInput
            accessibilityLabel="Group name"
            value={name}
            onChangeText={setName}
            placeholder={group?.name}
            maxLength={100}
            className="h-[52px] rounded-lg border border-border-strong bg-input px-4 text-base text-foreground placeholder:text-tertiary"
          />
          <Button
            disabled={!name.trim() || rename.isPending}
            onPress={async () => {
              const result = await tryCatch(rename.mutateAsync({ groupId, name }));
              if (result.error) {
                Alert.alert("Unable to rename group", userMessage(result.error));
                return;
              }
              setName("");
              await queryClient.invalidateQueries({
                queryKey: trpc.groupMembership.list.queryKey(),
              });
            }}
          >
            <Text>Save name</Text>
          </Button>
        </View>
      )}
      {historyShare.setting ? (
        <View className="gap-2">
          <Text variant="label">Your location history</Text>
          <Text className="text-secondary text-sm">
            How much of your history members of {group?.name ?? "this group"} can play back in
            Timeline. Only you can change this.
          </Text>
          <HistoryShareChoices
            accountShare={historyShare.setting.account}
            value={groupHistoryShare(historyShare.setting, groupId).override}
            disabled={historyShare.saving}
            onChange={(override) => void historyShare.change({ groupId, override })}
          />
        </View>
      ) : null}
      <Text variant="label">Appearance</Text>
      <GroupMapColorPicker groupId={groupId} />
      {session && canHideMapGroups(groupCount) && (
        <View className="flex-row items-center gap-4 rounded-2xl border border-border bg-card p-4">
          <View className="flex-1 gap-1">
            <Text className="text-foreground font-medium">Show on map</Text>
            <Text className="text-tertiary text-sm">
              Only changes this phone. Members can still see you, and you keep sharing your location
              with them.
            </Text>
          </View>
          <Switch
            accessibilityLabel={`Show ${group?.name ?? "this group"} on the map`}
            value={shownOnMap}
            onValueChange={(shown) =>
              setMapGroupHidden({ groupId, hidden: !shown, userId: session.user.id })
            }
          />
        </View>
      )}
      {role === "OWNER" && (
        <Button
          variant="danger"
          disabled={deleteGroup.isPending}
          onPress={() =>
            Alert.alert(
              "Delete group?",
              "This permanently deletes the group and its tracking data for all members.",
              [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Delete",
                  style: "destructive",
                  onPress: async () => {
                    const result = await tryCatch(deleteGroup.mutateAsync({ groupId }));
                    if (result.error) {
                      Alert.alert("Unable to delete group", userMessage(result.error));
                      return;
                    }
                    if (session) forgetHiddenMapGroup({ groupId, userId: session.user.id });
                    router.replace("/(tabs)/groups/list");
                    await queryClient.invalidateQueries({
                      queryKey: trpc.groupMembership.list.queryKey(),
                    });
                    requestTrackingSync();
                  },
                },
              ],
            )
          }
        >
          <Text>Delete group</Text>
        </Button>
      )}
    </View>
  );
};

export default SettingsTab;
