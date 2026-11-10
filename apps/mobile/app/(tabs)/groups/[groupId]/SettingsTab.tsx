import { Alert } from "../../../../lib/alert.ts";
import { tryCatch } from "@openbeacon/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState } from "react";
import { TextInput, View } from "react-native";
import { GroupMapColorPicker } from "../../../../components/map/GroupMapColorPicker.tsx";
import { Button } from "../../../../components/ui/Button.tsx";
import { Switch } from "../../../../components/ui/Switch.tsx";
import { Text } from "../../../../components/ui/Text.tsx";
import { useHiddenMapGroupIds } from "../../../../hooks/useHiddenMapGroupIds.ts";
import { trpc } from "../../../../lib/api.ts";
import { authClient } from "../../../../lib/auth-client.ts";
import { forgetHiddenMapGroup, setMapGroupHidden } from "../../../../lib/hiddenMapGroups.ts";
import { canHideMapGroups } from "../../../../lib/mapGroupVisibility.ts";
import { requestTrackingSync } from "../../../../lib/trackingEvents.ts";

const SettingsTab = ({ groupId }: { groupId: string }) => {
  const { data: session } = authClient.useSession();
  const { data: members } = useQuery(trpc.groupMembership.members.queryOptions({ groupId }));
  const { data: group } = useQuery(trpc.groupMembership.get.queryOptions({ groupId }));
  const { data: groupList } = useQuery(trpc.groupMembership.list.queryOptions());
  const hiddenGroupIds = useHiddenMapGroupIds(session?.user.id);
  const shownOnMap = !hiddenGroupIds.includes(groupId);
  const [name, setName] = useState("");
  const queryClient = useQueryClient();
  const router = useRouter();
  const rename = useMutation(trpc.groupSettings.rename.mutationOptions());
  const deleteGroup = useMutation(trpc.groupLifecycle.delete.mutationOptions());
  const role = members?.find((member) => member.user.id === session?.user.id)?.role;

  return (
    <View className="gap-3 pt-1">
      {(role === "OWNER" || role === "ADMIN") && (
        <View className="gap-3">
          <Text className="text-lg font-medium">Group name</Text>
          <TextInput
            accessibilityLabel="Group name"
            value={name}
            onChangeText={setName}
            placeholder={group?.name}
            maxLength={100}
            className="rounded-lg border border-border bg-input text-foreground placeholder:text-secondary dark:placeholder:text-muted-foreground p-4"
          />
          <Button
            disabled={!name.trim() || rename.isPending}
            onPress={async () => {
              const result = await tryCatch(rename.mutateAsync({ groupId, name }));
              if (result.error) {
                Alert.alert("Unable to rename group", result.error.message);
                return;
              }
              setName("");
              await Promise.all([
                queryClient.invalidateQueries({
                  queryKey: trpc.groupMembership.get.queryKey({ groupId }),
                }),
                queryClient.invalidateQueries({ queryKey: trpc.groupMembership.list.queryKey() }),
              ]);
            }}
          >
            <Text>Save name</Text>
          </Button>
        </View>
      )}
      <Text className="mb-1 text-lg font-medium text-muted-foreground">Appearance</Text>
      <GroupMapColorPicker groupId={groupId} />
      {session && canHideMapGroups(groupList?.length ?? 0) && (
        <View className="flex-row items-center gap-4 rounded-lg border border-border bg-card p-4">
          <View className="flex-1 gap-1">
            <Text className="text-foreground font-medium">Show on map</Text>
            <Text className="text-muted-foreground text-sm">
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
          variant="destructive"
          className="bg-red-700 dark:bg-red-700"
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
                      Alert.alert("Unable to delete group", result.error.message);
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
          <Text className="text-white">Delete group</Text>
        </Button>
      )}
    </View>
  );
};

export default SettingsTab;
