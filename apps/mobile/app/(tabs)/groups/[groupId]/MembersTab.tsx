import { tryCatch } from "@openbeacon/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { MapPinIcon, PlusCircleIcon } from "lucide-react-native";
import { useState } from "react";
import { Alert, View } from "react-native";
import { InviteMemberToGroupDialog } from "../../../../components/dialogs/InviteMemberToGroupDialog.tsx";
import { LoadingIndicator } from "../../../../components/LoadingIndicator.tsx";
import { Avatar, AvatarFallback, AvatarImage } from "../../../../components/ui/Avatar.tsx";
import { Button } from "../../../../components/ui/Button.tsx";
import { Icon } from "../../../../components/ui/Icon.tsx";
import { Text } from "../../../../components/ui/Text.tsx";
import { useGroupLivePositions } from "../../../../hooks/useGroupLivePositions.ts";
import { trpc } from "../../../../lib/api.ts";
import { authClient } from "../../../../lib/auth-client.ts";
import { getBatteryVisual } from "../../../../lib/batteryVisual.ts";
import { buildMemberLiveStatuses } from "../../../../lib/buildMemberLiveStatuses.ts";
import { buildRemoveGroupMemberInput } from "../../../../lib/groupEncryption.ts";
import { requestTrackingSync } from "../../../../lib/trackingEvents.ts";
import { timeSince } from "../../../../lib/timeSince.ts";

const MembersTab = ({ groupId }: { groupId: string }) => {
  const [addMemberDialogOpen, setAddMemberDialogOpen] = useState(false);
  const { data: session } = authClient.useSession();
  const queryClient = useQueryClient();
  const router = useRouter();
  const removeMember = useMutation(trpc.groupMembership.remove.mutationOptions());
  const { data: members, isFetching: isFetchingMembers } = useQuery(
    trpc.groupMembership.members.queryOptions({ groupId }),
  );
  const livePositions = useGroupLivePositions(groupId);
  const memberStatuses = buildMemberLiveStatuses({
    members: members ?? [],
    positions: livePositions,
  });
  const self = members?.find((member) => member.user.id === session?.user.id);
  const canManage = self?.role === "OWNER" || self?.role === "ADMIN";
  const onlyOwner =
    self?.role === "OWNER" && members?.filter((member) => member.role === "OWNER").length === 1;
  const confirmRemoval = (member: { id: string; user: { id: string; name: string } }) => {
    const isSelf = member.user.id === session?.user.id;
    if (isSelf && onlyOwner) {
      Alert.alert("Unable to leave", "The group must have another owner before you can leave.");
      return;
    }
    Alert.alert(
      isSelf ? "Leave group?" : `Remove ${member.user.name}?`,
      "Their location history and tracking data for this group will be deleted.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: isSelf ? "Leave" : "Remove",
          style: "destructive",
          onPress: async () => {
            const result = await tryCatch(
              (async () => {
                const input = await buildRemoveGroupMemberInput({ groupId, memberId: member.id });
                await removeMember.mutateAsync(input);
                await queryClient.invalidateQueries({
                  queryKey: trpc.groupMembership.list.queryKey(),
                });
                if (isSelf) {
                  router.replace("/(tabs)/groups/list");
                } else {
                  await queryClient.invalidateQueries({
                    queryKey: trpc.groupMembership.members.queryKey({ groupId }),
                  });
                }
                requestTrackingSync();
              })(),
            );
            if (result.error) {
              Alert.alert(
                "Unable to update group",
                result.error instanceof Error ? result.error.message : "Something went wrong.",
              );
            }
          },
        },
      ],
    );
  };

  if (isFetchingMembers) {
    return <LoadingIndicator />;
  }

  return (
    <View className="gap-4 pt-1">
      <InviteMemberToGroupDialog
        open={addMemberDialogOpen}
        setOpen={setAddMemberDialogOpen}
        groupId={groupId}
      />
      <View className="flex-row items-center justify-between px-1">
        <Text className="text-lg font-semibold text-foreground">Members</Text>
        <Text className="text-sm text-muted-foreground">{members?.length ?? 0}</Text>
      </View>
      {memberStatuses.map((member) => (
        <View key={member.id}>
          <MemberCard member={member} />
          {(member.id === self?.id || canManage) && (
            <Button
              variant="outline"
              size="sm"
              disabled={removeMember.isPending}
              onPress={() => confirmRemoval(member)}
            >
              <Text>{member.id === self?.id ? "Leave group" : "Remove member"}</Text>
            </Button>
          )}
        </View>
      ))}
      {canManage && (
        <Button size="sm" onPress={() => setAddMemberDialogOpen(true)} className="self-start">
          <Icon as={PlusCircleIcon} size={20} className="text-white" />
          <Text>Invite member</Text>
        </Button>
      )}
    </View>
  );
};

const MemberCard = ({ member }: { member: ReturnType<typeof buildMemberLiveStatuses>[number] }) => {
  const batteryVisual = member.battery
    ? getBatteryVisual({
        batteryLevel: member.battery.level,
        charging: member.battery.charging,
      })
    : null;

  return (
    <View className="overflow-hidden rounded-2xl border border-border bg-card px-5 py-4">
      <View className="flex flex-row items-center gap-3">
        <View className="flex-row items-center gap-3">
          <Avatar alt={member.user.name} className="size-12">
            <AvatarImage source={{ uri: member.user.image ?? "" }} />
            <AvatarFallback>
              <Text className="font-bold">
                {member.user.name.charAt(0) + member.user.name.charAt(1)}
              </Text>
            </AvatarFallback>
          </Avatar>
        </View>
        <View className="flex-1 gap-1">
          <Text className="text-foreground text-xl font-bold">{member.user.name}</Text>
          <View className="flex-row items-start gap-1">
            <Icon as={MapPinIcon} className="text-secondary mt-1 size-4" />
            <View className="flex-col items-start">
              {member.timestamp ? (
                <Text className="text-md text-muted">
                  Location updated {timeSince(member.timestamp)}
                </Text>
              ) : (
                <Text className="text-md text-muted">Location unavailable</Text>
              )}
            </View>
          </View>
          {member.battery && batteryVisual ? (
            <View className="flex-row items-center gap-2">
              <Icon as={batteryVisual.icon} size={20} className={batteryVisual.colorClass} />
              <Text className={`${batteryVisual.colorClass} text-sm`}>
                Battery: {member.battery.level}%
              </Text>
            </View>
          ) : (
            <Text className="text-muted text-sm">Battery unavailable</Text>
          )}
        </View>
      </View>
    </View>
  );
};

export default MembersTab;
