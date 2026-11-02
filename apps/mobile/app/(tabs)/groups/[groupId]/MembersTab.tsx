import { tryCatch } from "@openbeacon/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { MapPinIcon, PlusCircleIcon } from "lucide-react-native";
import { useState } from "react";
import { Alert, Pressable, ScrollView, View } from "react-native";
import { InviteMemberToGroupDialog } from "../../../../components/dialogs/InviteMemberToGroupDialog.tsx";
import { LoadingIndicator } from "../../../../components/LoadingIndicator.tsx";
import { Avatar, AvatarFallback, AvatarImage } from "../../../../components/ui/Avatar.tsx";
import { Button } from "../../../../components/ui/Button.tsx";
import { Icon } from "../../../../components/ui/Icon.tsx";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../../../../components/ui/Dialog.tsx";
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
  const [successorDialogOpen, setSuccessorDialogOpen] = useState(false);
  const [successorMemberId, setSuccessorMemberId] = useState<string | null>(null);
  const { data: session } = authClient.useSession();
  const queryClient = useQueryClient();
  const router = useRouter();
  const removeMember = useMutation(trpc.groupMembership.remove.mutationOptions());
  const deleteGroup = useMutation(trpc.groupLifecycle.delete.mutationOptions());
  const updateRole = useMutation(trpc.groupMembership.updateRole.mutationOptions());
  const { data: members, isPending: isFetchingMembers } = useQuery({
    ...trpc.groupMembership.members.queryOptions({ groupId }),
    refetchInterval: 10_000,
  });
  const livePositions = useGroupLivePositions(groupId);
  const memberStatuses = buildMemberLiveStatuses({
    members: members ?? [],
    positions: livePositions,
  });
  const self = members?.find((member) => member.user.id === session?.user.id);
  const canManage = self?.role === "OWNER" || self?.role === "ADMIN";
  const confirmRemoval = (
    member: { id: string; user: { id: string; name: string } },
    successor?: string,
  ) => {
    const isSelf = member.user.id === session?.user.id;
    const isLastMember = isSelf && members?.length === 1;
    if (isSelf && self?.role === "OWNER" && !successor && !isLastMember) {
      setSuccessorMemberId(null);
      setSuccessorDialogOpen(true);
      return;
    }
    Alert.alert(
      isSelf ? "Leave group?" : `Remove ${member.user.name}?`,
      isSelf
        ? isLastMember
          ? "You are the last person in this group. Leaving will permanently delete the group and its tracking data."
          : `${successor ? `${members?.find((item) => item.id === successor)?.user.name ?? "The selected member"} will become an owner. ` : ""}You will leave this group, and your location history in this group will be deleted.`
        : `${member.user.name} will be removed from this group and their location history in this group will be deleted.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: isSelf ? "Leave" : "Remove",
          style: "destructive",
          onPress: async () => {
            const result = await tryCatch(
              (async () => {
                if (isLastMember) {
                  await deleteGroup.mutateAsync({ groupId, onlyIfLastMember: true });
                } else {
                  const input = await buildRemoveGroupMemberInput({ groupId, memberId: member.id });
                  await removeMember.mutateAsync({
                    ...input,
                    ...(successor ? { successorMemberId: successor } : {}),
                  });
                }
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
      <Dialog open={successorDialogOpen} onOpenChange={setSuccessorDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Choose a new owner</DialogTitle>
          </DialogHeader>
          <Text>Select the person who will manage this group after you leave.</Text>
          <ScrollView style={{ maxHeight: 280 }}>
            {members
              ?.filter((member) => member.id !== self?.id)
              .map((member) => (
                <Pressable
                  key={member.id}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: successorMemberId === member.id }}
                  onPress={() => setSuccessorMemberId(member.id)}
                  className="flex-row items-center gap-3 rounded-lg p-3"
                >
                  <View
                    className={`size-5 rounded-full border-2 ${successorMemberId === member.id ? "border-primary bg-primary" : "border-border"}`}
                  />
                  <Text>{member.user.name}</Text>
                </Pressable>
              ))}
          </ScrollView>
          <Button
            disabled={!successorMemberId}
            onPress={() => {
              setSuccessorDialogOpen(false);
              if (self && successorMemberId) confirmRemoval(self, successorMemberId);
            }}
          >
            <Text>Continue</Text>
          </Button>
        </DialogContent>
      </Dialog>
      {canManage && (
        <Button size="sm" onPress={() => setAddMemberDialogOpen(true)} className="self-start">
          <Icon as={PlusCircleIcon} size={20} className="text-white" />
          <Text>Invite member</Text>
        </Button>
      )}
      <View className="flex-row items-center justify-between px-1">
        <Text className="text-lg font-semibold text-foreground">Members</Text>
        <Text className="text-sm text-muted-foreground">{members?.length ?? 0}</Text>
      </View>
      {memberStatuses.map((member) => (
        <View key={member.id}>
          <MemberCard member={member} />
          {self?.role === "OWNER" && member.id !== self.id && (
            <View
              className="flex-row rounded-2xl bg-secondary p-1 my-2"
              accessibilityRole="radiogroup"
              accessibilityLabel={`Role for ${member.user.name}`}
            >
              {(["OWNER", "ADMIN", "MEMBER"] as const).map((role) => (
                <Pressable
                  key={role}
                  accessibilityRole="radio"
                  accessibilityState={{
                    checked: member.role === role,
                    disabled: updateRole.isPending,
                  }}
                  disabled={updateRole.isPending || member.role === role}
                  className={`flex-1 items-center rounded-xl px-2 py-3 ${member.role === role ? "bg-primary" : ""}`}
                  onPress={() =>
                    Alert.alert("Change role?", `Make ${member.user.name} ${role.toLowerCase()}?`, [
                      { text: "Cancel", style: "cancel" },
                      {
                        text: "Change",
                        onPress: async () => {
                          const result = await tryCatch(
                            updateRole.mutateAsync({ groupId, memberId: member.id, role }),
                          );
                          if (result.error) {
                            Alert.alert("Unable to change role", result.error.message);
                            return;
                          }
                          await Promise.all([
                            queryClient.invalidateQueries({
                              queryKey: trpc.groupMembership.members.queryKey({ groupId }),
                            }),
                            queryClient.invalidateQueries({
                              queryKey: trpc.groupMembership.get.queryKey({ groupId }),
                            }),
                            queryClient.invalidateQueries({
                              queryKey: trpc.groupMembership.list.queryKey(),
                            }),
                          ]);
                        },
                      },
                    ])
                  }
                >
                  <Text
                    className={
                      member.role === role ? "text-white font-semibold" : "text-foreground"
                    }
                  >
                    {role.charAt(0) + role.slice(1).toLowerCase()}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}
          {(member.id === self?.id ||
            (canManage && (self?.role === "OWNER" || member.role !== "OWNER"))) && (
            <Button
              variant="outline"
              size="sm"
              disabled={removeMember.isPending || deleteGroup.isPending}
              onPress={() => confirmRemoval(member)}
            >
              <Text>{member.id === self?.id ? "Leave group" : "Remove member"}</Text>
            </Button>
          )}
        </View>
      ))}
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
          <Text className="text-muted-foreground">{member.role}</Text>
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
