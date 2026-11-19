import { useIsFocused } from "@react-navigation/native";
import { Alert } from "../../../../lib/alert.ts";
import { accountNameSchema } from "@openbeacon/schemas";
import { tryCatch } from "@openbeacon/shared";
import { skipToken, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import {
  CirclePauseIcon,
  CircleSlashIcon,
  CrownIcon,
  EllipsisVerticalIcon,
  LogOutIcon,
  MapPinIcon,
  PencilIcon,
  UserMinusIcon,
  UserPlusIcon,
} from "lucide-react-native";
import { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, TextInput, View } from "react-native";
import { InviteMemberToGroupDialog } from "../../../../components/dialogs/InviteMemberToGroupDialog.tsx";
import { LoadingIndicator } from "../../../../components/LoadingIndicator.tsx";
import { DecryptedAvatarImage } from "../../../../components/image/DecryptedAvatarImage.tsx";
import { Avatar, AvatarFallback } from "../../../../components/ui/Avatar.tsx";
import { BottomSheet } from "../../../../components/ui/BottomSheet.tsx";
import { Button } from "../../../../components/ui/Button.tsx";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../../../../components/ui/Dialog.tsx";
import { Icon } from "../../../../components/ui/Icon.tsx";
import { SegmentedControl } from "../../../../components/ui/SegmentedControl.tsx";
import { Text } from "../../../../components/ui/Text.tsx";
import { useCachedGroup } from "../../../../hooks/useCachedGroup.ts";
import type { useLiveTrackingPositions } from "../../../../hooks/useLiveTrackingPositions.ts";
import { trpc } from "../../../../lib/api.ts";
import {
  loadPersonalNicknames,
  encryptPersonalNickname,
} from "../../../../lib/personalNicknames.ts";
import { authClient } from "../../../../lib/auth-client.ts";
import { cn } from "../../../../lib/cn.ts";
import { hasCustomServerUrl } from "../../../../lib/currentServer.ts";
import { getBatteryVisual } from "../../../../lib/batteryVisual.ts";
import { buildMemberLiveStatuses } from "../../../../lib/buildMemberLiveStatuses.ts";
import { deviceIconFor } from "../../../../lib/deviceIcons.ts";
import { buildRemoveGroupMemberInput, submitEpochChange } from "../../../../lib/groupEncryption.ts";
import {
  canEditGroup,
  type GroupRole,
  groupRoles,
  memberActions,
  roleLabel,
} from "../../../../lib/groupRoles.ts";
import { forgetHiddenMapGroup } from "../../../../lib/hiddenMapGroups.ts";
import { pluralize } from "../../../../lib/pluralize.ts";
import { timeSince } from "../../../../lib/timeSince.ts";
import { requestTrackingSync } from "../../../../lib/trackingEvents.ts";
import { useSingleFlight } from "../../../../lib/useSingleFlight.ts";

const MembersTab = ({
  groupId,
  live: { positions: livePositions, status: liveStatus },
}: {
  groupId: string;
  live: ReturnType<typeof useLiveTrackingPositions>;
}) => {
  const [nicknameMember, setNicknameMember] = useState<{
    id: string;
    name: string;
    nickname: string | null;
  } | null>(null);
  const [nickname, setNickname] = useState("");
  const updateNickname = useMutation(trpc.groupMembership.updateNickname.mutationOptions());
  const [changingRole, setChangingRole] = useState<{
    memberId: string;
    role: GroupRole;
  } | null>(null);
  const [addMemberDialogOpen, setAddMemberDialogOpen] = useState(false);
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const { data: session } = authClient.useSession();
  const isFocused = useIsFocused();
  const queryClient = useQueryClient();
  const router = useRouter();
  const removeMember = useMutation(trpc.groupMembership.remove.mutationOptions());
  const removal = useSingleFlight<string>();
  const deleteGroup = useMutation(trpc.groupLifecycle.delete.mutationOptions());
  const updateRole = useMutation(trpc.groupMembership.updateRole.mutationOptions());
  const offerOwnership = useMutation(trpc.groupOwnership.offer.mutationOptions());
  const cancelOwnershipOffer = useMutation(trpc.groupOwnership.cancel.mutationOptions());
  const { group, isPending: isFetchingMembers } = useCachedGroup(groupId);
  const members = useMemo(
    () =>
      group?.members.map((member) => ({
        id: member.id,
        role: member.role,
        user: { id: member.userId, image: member.image, name: member.name },
      })),
    [group],
  );
  const userId = session?.user.id;
  const nicknameQuery = useQuery({
    queryKey: ["personalNicknames", groupId, userId],
    subscribed: isFocused,
    queryFn: userId ? () => loadPersonalNicknames(groupId, userId) : skipToken,
  });
  const nicknames = nicknameQuery.data ?? {};
  const memberDevices = useQuery({
    ...trpc.groupMembership.listMemberDevices.queryOptions({ groupId }),
    subscribed: isFocused,
  });
  const placeSharing = useQuery({
    ...trpc.placeSharing.get.queryOptions({ groupId }),
    subscribed: isFocused,
  });
  const arrivalsOffLabel = (memberUserId: string) => {
    const off = placeSharing.data?.arrivalsOff.filter((item) => item.userId === memberUserId);
    if (!off?.length) return null;
    const devices = memberDevices.data?.filter((device) => device.userId === memberUserId) ?? [];
    if (devices.length <= 1) return "Arrivals off";
    const names = off.map(
      (item) => devices.find((device) => device.deviceId === item.deviceId)?.name ?? "a device",
    );
    return `Arrivals off on ${names.join(", ")}`;
  };
  const memberStatuses = buildMemberLiveStatuses({
    memberDevices: memberDevices.data ?? [],
    members: (members ?? []).map((member) => ({
      ...member,
      nickname: nicknames[member.id]?.name ?? null,
    })),
    positions: livePositions,
  });
  const self = members?.find((member) => member.user.id === session?.user.id);
  const selectedMember = memberStatuses.find((member) => member.id === selectedMemberId);
  const selectedActions = selectedMember
    ? memberActions({
        ownerId: group?.ownerId,
        self: self && { id: self.id, role: self.role, userId: self.user.id },
        target: {
          id: selectedMember.id,
          role: selectedMember.role,
          userId: selectedMember.user.id,
        },
      })
    : null;
  const canManage = canEditGroup(self?.role);
  const selfIsOwner = !!self && self.user.id === group?.ownerId;
  const refreshGroups = () =>
    queryClient.invalidateQueries({ queryKey: trpc.groupMembership.list.queryKey() });
  const leaveAsOwner = () => {
    const isLastMember = members?.length === 1;
    Alert.alert(
      isLastMember ? "Leave group?" : "Leave and delete the group?",
      isLastMember
        ? "You are the last person in this group. Leaving will permanently delete the group and its tracking data."
        : `You own ${group?.name ?? "this group"}, so leaving deletes it and its location history for everyone. To keep it going, make another Admin the owner first.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: isLastMember ? "Leave" : "Delete group",
          style: "destructive",
          onPress: async () => {
            const result = await tryCatch(
              removal.run(self?.id ?? "", async () => {
                await deleteGroup.mutateAsync({
                  groupId,
                  ...(isLastMember ? { onlyIfLastMember: true } : {}),
                });
                if (session) forgetHiddenMapGroup({ groupId, userId: session.user.id });
                router.replace("/(tabs)/groups/list");
                await refreshGroups();
                requestTrackingSync();
              }),
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
  const askToTakeOver = (member: { id: string; user: { name: string } }) =>
    Alert.alert(
      `Ask ${member.user.name} to become the owner?`,
      `${member.user.name} will see the request on their phone and can accept or decline it. Once they accept, ${hasCustomServerUrl() ? "" : "their account pays for this group’s seats and "}only they can delete the group or hand it on. You’ll stay an Admin.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Send request",
          onPress: async () => {
            const result = await tryCatch(
              offerOwnership.mutateAsync({ groupId, memberId: member.id }),
            );
            if (result.error) {
              Alert.alert("Unable to send the request", result.error.message);
              return;
            }
            await refreshGroups();
          },
        },
      ],
    );
  const cancelTakeOver = async () => {
    const result = await tryCatch(cancelOwnershipOffer.mutateAsync({ groupId }));
    if (result.error) {
      Alert.alert("Unable to cancel the request", result.error.message);
      return;
    }
    await refreshGroups();
  };
  const confirmRemoval = (member: { id: string; user: { id: string; name: string } }) => {
    const isSelf = member.user.id === session?.user.id;
    if (isSelf && selfIsOwner) {
      leaveAsOwner();
      return;
    }
    Alert.alert(
      isSelf ? "Leave group?" : `Remove ${member.user.name}?`,
      isSelf
        ? "You will leave this group, and your location history in this group will be deleted."
        : `${member.user.name} will be removed from this group and their location history in this group will be deleted.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: isSelf ? "Leave" : "Remove",
          style: "destructive",
          onPress: async () => {
            const result = await tryCatch(
              removal.run(member.id, async () => {
                await submitEpochChange({
                  build: () => buildRemoveGroupMemberInput({ groupId, memberId: member.id }),
                  submit: (input) => removeMember.mutateAsync(input),
                });
                if (isSelf) {
                  forgetHiddenMapGroup({ groupId, userId: member.user.id });
                  router.replace("/(tabs)/groups/list");
                }
                await refreshGroups();
                requestTrackingSync();
              }),
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
    <View>
      <InviteMemberToGroupDialog
        open={addMemberDialogOpen}
        setOpen={setAddMemberDialogOpen}
        groupId={groupId}
        isOwner={selfIsOwner}
        canInviteEditors={self?.role === "ADMIN"}
      />
      <Dialog
        open={nicknameMember !== null}
        onOpenChange={(open) => {
          if (!open) setNicknameMember(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Set nickname for {nicknameMember?.name}</DialogTitle>
          </DialogHeader>
          <Text>
            Only you can see this nickname. It’s encrypted before it leaves this phone, and your
            other phones can read it too. Leave it blank to use their profile name.
          </Text>
          {nicknameQuery.isError && (
            <Text>Unable to load nicknames. Try again before making changes.</Text>
          )}
          <TextInput
            accessibilityLabel="Nickname"
            value={nickname}
            onChangeText={setNickname}
            placeholder="Nickname"
            className="h-[52px] rounded-lg border border-border-strong bg-input px-4 text-base text-foreground"
          />
          <Button
            disabled={updateNickname.isPending || nicknameQuery.isPending || nicknameQuery.isError}
            onPress={async () => {
              if (!nicknameMember || nicknameQuery.isPending || nicknameQuery.isError) return;
              const parsed = nickname.trim() ? accountNameSchema.safeParse(nickname) : null;
              if (!parsed && nicknames[nicknameMember.id]?.name === null) {
                setNicknameMember(null);
                return;
              }
              if (parsed && !parsed.success) {
                Alert.alert("Invalid nickname", parsed.error.issues[0]?.message);
                return;
              }
              const result = await tryCatch(
                (async () => {
                  if (!session?.user.id) throw new Error("Please sign in again.");
                  const ciphertext = parsed?.data
                    ? await encryptPersonalNickname({
                        groupId,
                        memberId: nicknameMember.id,
                        userId: session.user.id,
                        nickname: parsed.data,
                      })
                    : null;
                  await updateNickname.mutateAsync({
                    groupId,
                    memberId: nicknameMember.id,
                    ciphertext,
                    expectedCiphertext: nicknames[nicknameMember.id]?.ciphertext ?? null,
                  });
                })(),
              );
              if (result.error) {
                await queryClient.invalidateQueries({
                  queryKey: ["personalNicknames", groupId, session?.user.id],
                });
                Alert.alert("Unable to save nickname", result.error.message);
                return;
              }
              await queryClient.invalidateQueries({
                queryKey: ["personalNicknames", groupId, session?.user.id],
              });
              setNicknameMember(null);
            }}
          >
            <Text>Save nickname</Text>
          </Button>
        </DialogContent>
      </Dialog>
      <View className="flex-row items-center justify-between pb-3">
        <Text variant="label">{pluralize(members?.length ?? 0, "member")}</Text>
        {canManage && (
          <Button size="sm" className="rounded-full" onPress={() => setAddMemberDialogOpen(true)}>
            <Icon as={UserPlusIcon} className="size-4 text-white" />
            <Text>Invite</Text>
          </Button>
        )}
      </View>
      <View className="overflow-hidden rounded-2xl border border-border bg-card">
        {memberStatuses.map((member, index) => (
          <Pressable
            key={member.id}
            accessibilityRole="button"
            accessibilityLabel={`${member.nickname ?? member.user.name}, ${member.user.id === group?.ownerId ? "Owner, " : ""}${roleLabel(member.role)}`}
            accessibilityHint="Opens actions for this member"
            onPress={() => setSelectedMemberId(member.id)}
            className={cn(
              "flex-row items-start gap-3 py-3.5 pl-4 pr-2 active:bg-secondary/60",
              index > 0 && "border-t border-border/60",
            )}
          >
            <Avatar alt={member.nickname ?? member.user.name} className="size-11">
              <DecryptedAvatarImage url={member.user.image} />
              <AvatarFallback>
                <Text className="font-bold">
                  {(member.nickname ?? member.user.name).slice(0, 2)}
                </Text>
              </AvatarFallback>
            </Avatar>
            <View className="flex-1 gap-1">
              <View className="flex-row items-center gap-2">
                <Text className="text-foreground shrink text-lg font-semibold" numberOfLines={1}>
                  {member.nickname ?? member.user.name}
                </Text>
                {member.id === self?.id ? (
                  <View className="rounded-full bg-secondary px-2 py-0.5">
                    <Text className="text-secondary text-xs font-semibold">You</Text>
                  </View>
                ) : null}
                {member.user.id === group?.ownerId ? (
                  <View className="flex-row items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5">
                    <Icon as={CrownIcon} size={12} className="text-primary" />
                    <Text className="text-primary-text text-xs font-semibold">Owner</Text>
                  </View>
                ) : null}
                <View className="flex-1" />
                {changingRole?.memberId === member.id ? (
                  <ActivityIndicator size="small" />
                ) : (
                  <Text className="text-tertiary text-sm">{roleLabel(member.role)}</Text>
                )}
                <Icon as={EllipsisVerticalIcon} className="text-secondary size-5" />
              </View>
              <MemberStatus
                arrivalsOff={arrivalsOffLabel(member.user.id)}
                locationHidden={group?.onHold === true}
                member={member}
                sharingPaused={
                  liveStatus.sharing?.some((device) => device.userId === member.user.id) === true &&
                  liveStatus.sharing.every(
                    (device) => device.userId !== member.user.id || device.paused,
                  )
                }
                sharingOnHold={
                  liveStatus.sharing?.some(
                    (device) => device.userId === member.user.id && device.onHold,
                  ) === true &&
                  liveStatus.sharing.every(
                    (device) => device.userId !== member.user.id || device.paused || device.onHold,
                  )
                }
              />
            </View>
          </Pressable>
        ))}
      </View>
      <BottomSheet
        visible={selectedMember !== undefined}
        onClose={() => setSelectedMemberId(null)}
        closeLabel="Close member actions"
      >
        {selectedMember ? (
          <>
            <View className="flex-row items-center gap-3">
              <Avatar alt={selectedMember.nickname ?? selectedMember.user.name} className="size-12">
                <DecryptedAvatarImage url={selectedMember.user.image} />
                <AvatarFallback>
                  <Text className="font-bold">
                    {(selectedMember.nickname ?? selectedMember.user.name).slice(0, 2)}
                  </Text>
                </AvatarFallback>
              </Avatar>
              <View className="flex-1">
                <Text
                  accessibilityRole="header"
                  className="text-foreground text-xl font-bold"
                  numberOfLines={1}
                >
                  {selectedMember.nickname ?? selectedMember.user.name}
                </Text>
                <Text className="text-secondary text-sm">
                  {selectedMember.user.id === group?.ownerId ? "Owner · " : ""}
                  {roleLabel(selectedMember.role)}
                </Text>
              </View>
            </View>
            {selectedActions?.changeRole ? (
              <View className="gap-2">
                <Text variant="label">Role</Text>
                <SegmentedControl
                  accessibilityLabel={`Role for ${selectedMember.user.name}`}
                  options={groupRoles.map((role) => ({ value: role, label: roleLabel(role) }))}
                  selected={selectedMember.role}
                  disabled={changingRole !== null}
                  onChange={(role) => {
                    if (role === selectedMember.role) return;
                    setSelectedMemberId(null);
                    Alert.alert(
                      "Change role?",
                      group?.ownershipOfferedToId === selectedMember.user.id
                        ? `Make ${selectedMember.user.name} ${roleLabel(role)}? This also cancels the request for them to become the owner.`
                        : `Make ${selectedMember.user.name} ${roleLabel(role)}?`,
                      [
                        { text: "Cancel", style: "cancel" },
                        {
                          text: "Change",
                          onPress: async () => {
                            setChangingRole({ memberId: selectedMember.id, role });
                            const result = await tryCatch(
                              updateRole.mutateAsync({
                                groupId,
                                memberId: selectedMember.id,
                                role,
                              }),
                            );
                            if (result.error) {
                              setChangingRole(null);
                              Alert.alert("Unable to change role", result.error.message);
                              return;
                            }
                            await refreshGroups();
                            setChangingRole(null);
                          },
                        },
                      ],
                    );
                  }}
                />
              </View>
            ) : null}
            {selectedActions?.makeOwner ? (
              group?.ownershipOfferedToId === selectedMember.user.id ? (
                <View className="flex-row items-center gap-2">
                  <Text className="text-secondary flex-1 text-sm">Asked to take over as owner</Text>
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={cancelOwnershipOffer.isPending}
                    onPress={() => void cancelTakeOver()}
                  >
                    <Text>Cancel request</Text>
                  </Button>
                </View>
              ) : (
                <Button
                  variant="secondary"
                  size="sm"
                  loading={offerOwnership.isPending}
                  onPress={() => {
                    setSelectedMemberId(null);
                    askToTakeOver(selectedMember);
                  }}
                >
                  <Icon as={CrownIcon} size={16} className="text-foreground" />
                  <Text>Make owner</Text>
                </Button>
              )
            ) : null}
            <View className="overflow-hidden rounded-2xl border border-border">
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Edit nickname"
                accessibilityHint="Only you see nicknames"
                accessibilityState={{
                  disabled:
                    nicknameQuery.isPending || nicknameQuery.isError || nicknameQuery.isFetching,
                }}
                disabled={
                  nicknameQuery.isPending || nicknameQuery.isError || nicknameQuery.isFetching
                }
                onPress={() => {
                  if (nicknameQuery.isPending || nicknameQuery.isError || nicknameQuery.isFetching)
                    return;
                  setSelectedMemberId(null);
                  setNicknameMember({
                    id: selectedMember.id,
                    name: selectedMember.user.name,
                    nickname: selectedMember.nickname,
                  });
                  setNickname(selectedMember.nickname ?? "");
                }}
                className="min-h-[52px] flex-row items-center gap-3 px-4 py-3 active:bg-secondary/60"
              >
                <Icon as={PencilIcon} className="text-secondary size-5" />
                <View className="flex-1">
                  <Text className="text-foreground font-medium">Edit nickname</Text>
                  <Text className="text-tertiary text-sm">Only you see nicknames</Text>
                </View>
              </Pressable>
              {selectedActions?.leaveOrRemove && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={
                    selectedMember.id === self?.id ? "Leave group" : "Remove from group"
                  }
                  accessibilityState={{ disabled: removal.isPending }}
                  disabled={removal.isPending}
                  onPress={() => {
                    setSelectedMemberId(null);
                    confirmRemoval(selectedMember);
                  }}
                  className="min-h-[52px] flex-row items-center gap-3 border-t border-border/60 px-4 py-3 active:bg-secondary/60"
                >
                  <Icon
                    as={selectedMember.id === self?.id ? LogOutIcon : UserMinusIcon}
                    className="text-destructive-text size-5"
                  />
                  <Text className="text-destructive-text font-medium">
                    {selectedMember.id === self?.id ? "Leave group" : "Remove from group"}
                  </Text>
                </Pressable>
              )}
            </View>
          </>
        ) : null}
      </BottomSheet>
    </View>
  );
};

const MemberStatus = ({
  arrivalsOff,
  locationHidden,
  member,
  sharingOnHold,
  sharingPaused,
}: {
  arrivalsOff: string | null;
  locationHidden: boolean;
  member: ReturnType<typeof buildMemberLiveStatuses<GroupRole>>[number];
  sharingOnHold: boolean;
  sharingPaused: boolean;
}) => {
  const batteryVisual = member.battery
    ? getBatteryVisual({
        batteryLevel: member.battery.level,
        charging: member.battery.charging,
      })
    : null;

  return (
    <View className="gap-1 pr-2">
      {locationHidden ? null : sharingPaused ? (
        <View className="flex-row items-center gap-1.5 self-start rounded-full bg-warning px-2.5 py-1">
          <Icon as={CirclePauseIcon} className="text-warning-text size-3.5" />
          <Text className="text-warning-text text-xs font-semibold">Location sharing paused</Text>
        </View>
      ) : sharingOnHold ? (
        <View className="flex-row items-center gap-1.5 self-start rounded-full bg-secondary px-2.5 py-1">
          <Icon as={CircleSlashIcon} className="text-secondary size-3.5" />
          <Text className="text-secondary text-xs font-semibold">On hold</Text>
        </View>
      ) : member.activeDeviceCount >= 2 && member.devices.length > 0 ? (
        member.devices.map((device) => {
          const deviceBattery = getBatteryVisual({
            batteryLevel: device.battery.level,
            charging: device.battery.charging,
          });
          const updated = timeSince(device.timestamp);
          return (
            <View
              key={device.deviceId}
              accessible
              accessibilityLabel={[
                device.name ?? "Device",
                `updated ${updated}`,
                deviceBattery.label && `battery ${deviceBattery.label}`,
              ]
                .filter(Boolean)
                .join(", ")}
              className="flex-row items-center gap-2"
            >
              <Icon
                as={deviceIconFor(device.icon ?? "phone", device.platform).icon}
                className="text-tertiary size-4"
              />
              <Text className="text-secondary flex-1 text-sm" numberOfLines={1}>
                {device.name ?? "Device"}, {updated}
              </Text>
              <Icon as={deviceBattery.icon} className={`${deviceBattery.colorClass} size-4`} />
              {deviceBattery.label ? (
                <Text className={`${deviceBattery.colorClass} text-sm`}>{deviceBattery.label}</Text>
              ) : null}
            </View>
          );
        })
      ) : (
        <View className="flex-row flex-wrap items-center gap-x-4 gap-y-1">
          <View className="flex-row items-center gap-1.5">
            <Icon as={MapPinIcon} className="text-tertiary size-4" />
            <Text className="text-secondary text-sm">
              {member.timestamp ? `Updated ${timeSince(member.timestamp)}` : "Location unavailable"}
            </Text>
          </View>
          {batteryVisual?.label ? (
            <View className="flex-row items-center gap-1.5">
              <Icon as={batteryVisual.icon} className={`${batteryVisual.colorClass} size-4`} />
              <Text className={`${batteryVisual.colorClass} text-sm`}>{batteryVisual.label}</Text>
            </View>
          ) : null}
        </View>
      )}
      {arrivalsOff ? <Text className="text-tertiary text-sm">{arrivalsOff}</Text> : null}
    </View>
  );
};

export default MembersTab;
