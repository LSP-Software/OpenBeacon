import { Alert } from "../../lib/alert.ts";
import { tryCatch } from "@openbeacon/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState } from "react";
import { LogOutIcon, MapIcon, Trash2Icon } from "lucide-react-native";
import { Platform, TextInput, View } from "react-native";
import { HistoryShareChoices } from "../HistoryShareChoices.tsx";
import { GroupImage } from "../image/GroupImage.tsx";
import { GroupMapColorPicker } from "../map/GroupMapColorPicker.tsx";
import { Button } from "../ui/Button.tsx";
import { Icon } from "../ui/Icon.tsx";
import { ListRow, ListSection } from "../ui/List.tsx";
import { Switch } from "../ui/Switch.tsx";
import { Text } from "../ui/Text.tsx";
import { useCachedGroup } from "../../hooks/useCachedGroup.ts";
import { useHistoryShare } from "../../hooks/useHistoryShare.ts";
import { useHiddenMapGroupIds } from "../../hooks/useHiddenMapGroupIds.ts";
import { useMemberRemoval } from "../../hooks/useMemberRemoval.tsx";
import { trpc } from "../../lib/api.ts";
import { authClient } from "../../lib/auth-client.ts";
import { groupHistoryShare } from "../../lib/historyShare.ts";
import { forgetHiddenMapGroup, setMapGroupHidden } from "../../lib/hiddenMapGroups.ts";
import { canHideMapGroups } from "../../lib/mapGroupVisibility.ts";
import { requestTrackingSync } from "../../lib/trackingEvents.ts";
import { userMessage } from "../../lib/userMessage.ts";
import { thisDeviceNoun } from "../../lib/thisDeviceNoun.ts";

const ios = Platform.OS === "ios";

const SettingsTab = ({ groupId }: { groupId: string }) => {
  const { data: session } = authClient.useSession();
  const { group, groupCount } = useCachedGroup(groupId);
  const hiddenGroupIds = useHiddenMapGroupIds(session?.user.id);
  const shownOnMap = !hiddenGroupIds.includes(groupId);
  const [editedName, setName] = useState<string | null>(null);
  const name = editedName ?? group?.name ?? "";
  const queryClient = useQueryClient();
  const router = useRouter();
  const rename = useMutation(trpc.groupSettings.rename.mutationOptions());
  const deleteGroup = useMutation(trpc.groupLifecycle.delete.mutationOptions());
  const historyShare = useHistoryShare();
  const leaving = useMemberRemoval(groupId);
  const role = group?.members.find((member) => member.userId === session?.user.id)?.role;

  return (
    <View className="gap-6">
      {group ? (
        <View className="items-center">
          <GroupImage
            groupId={groupId}
            imageUrl={group.image ?? null}
            editable={role === "OWNER" || role === "ADMIN"}
          />
        </View>
      ) : null}
      {(role === "OWNER" || role === "ADMIN") && (
        <View className="gap-3">
          {ios ? <Text variant="label">Group name</Text> : null}
          <View>
            <TextInput
              accessibilityLabel="Group name"
              value={name}
              onChangeText={setName}
              maxLength={100}
              className={
                ios
                  ? "h-[50px] rounded-[12px] bg-card px-4 text-[17px] text-foreground placeholder:text-tertiary"
                  : "h-14 rounded-[4px] border border-border-strong bg-input px-4 text-base text-foreground placeholder:text-tertiary"
              }
            />
            {ios ? null : (
              <View pointerEvents="none" className="absolute -top-2 left-3 bg-background px-1">
                <Text className="text-xs text-secondary">Group name</Text>
              </View>
            )}
          </View>
          <Button
            variant="secondary"
            className="self-start"
            disabled={!name.trim()}
            loading={rename.isPending}
            onPress={async () => {
              const result = await tryCatch(rename.mutateAsync({ groupId, name }));
              if (result.error) {
                Alert.alert("Couldn’t rename group", userMessage(result.error));
                return;
              }
              await queryClient.invalidateQueries({
                queryKey: trpc.groupMembership.list.queryKey(),
              });
              setName(null);
            }}
          >
            <Text>Save name</Text>
          </Button>
        </View>
      )}
      {historyShare.setting ? (
        <View className="gap-2">
          <Text variant="label">Your location history</Text>
          <HistoryShareChoices
            accountShare={historyShare.setting.account}
            value={groupHistoryShare(historyShare.setting, groupId).override}
            disabled={historyShare.saving}
            onChange={(override) =>
              void historyShare.change({
                groupId,
                groupName: group?.name ?? "this group",
                override,
              })
            }
          />
          <Text className="px-4 text-[13px] leading-[18px] text-secondary">
            How much of your history members of {group?.name ?? "this group"} can play back in
            Timeline. Only you can change this.
          </Text>
        </View>
      ) : null}
      <View className="gap-2">
        <Text variant="label">Appearance</Text>
        <GroupMapColorPicker groupId={groupId} />
      </View>
      {session && canHideMapGroups(groupCount) && (
        <ListSection
          footer={`Only changes this ${thisDeviceNoun()}. Members can still see you, and you keep sharing your location with them.`}
        >
          <ListRow
            title="Show on map"
            icon={MapIcon}
            iconColor="green"
            accessibilityRole="switch"
            accessibilityLabel={`Show ${group?.name ?? "this group"} on the map`}
            accessibilityState={{ checked: shownOnMap }}
            onPress={() =>
              setMapGroupHidden({ groupId, hidden: shownOnMap, userId: session.user.id })
            }
            trailing={
              <Switch
                accessibilityLabel={`Show ${group?.name ?? "this group"} on the map`}
                value={shownOnMap}
                onValueChange={(shown) =>
                  setMapGroupHidden({ groupId, hidden: !shown, userId: session.user.id })
                }
              />
            }
          />
        </ListSection>
      )}
      {leaving.successorDialog}
      {role && (
        <Button
          variant="danger"
          className={ios ? "" : "self-start"}
          loading={leaving.isPending}
          onPress={leaving.leave}
        >
          {ios ? null : <Icon as={LogOutIcon} size={18} className="text-destructive-text" />}
          <Text>Leave group</Text>
        </Button>
      )}
      {role === "OWNER" && (
        <Button
          variant="danger"
          className={ios ? "" : "self-start"}
          loading={deleteGroup.isPending}
          onPress={() =>
            Alert.alert(
              "Delete group?",
              "This permanently deletes the group and its location history for all members.",
              [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Delete",
                  style: "destructive",
                  onPress: async () => {
                    const result = await tryCatch(deleteGroup.mutateAsync({ groupId }));
                    if (result.error) {
                      Alert.alert("Couldn’t delete group", userMessage(result.error));
                      return;
                    }
                    if (session) forgetHiddenMapGroup({ groupId, userId: session.user.id });
                    router.dismissTo("/(tabs)/groups/list");
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
          {ios ? null : <Icon as={Trash2Icon} size={18} className="text-destructive-text" />}
          <Text>Delete group</Text>
        </Button>
      )}
    </View>
  );
};

export default SettingsTab;
