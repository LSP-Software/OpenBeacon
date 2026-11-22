import { useIsFocused } from "@react-navigation/native";
import { Alert } from "../../lib/alert.ts";
import { accountNameSchema } from "@openbeacon/schemas";
import { tryCatch } from "@openbeacon/shared";
import { skipToken, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CirclePauseIcon,
  EllipsisVerticalIcon,
  LogOutIcon,
  MapPinIcon,
  PencilIcon,
  UserMinusIcon,
  UserPlusIcon,
} from "lucide-react-native";
import { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, TextInput, View } from "react-native";
import { InviteMemberToGroupDialog } from "../dialogs/InviteMemberToGroupDialog.tsx";
import { LoadingIndicator } from "../LoadingIndicator.tsx";
import { groupedListClassName, groupedRowClassName, groupedRowStyle } from "./groupedRows.ts";
import { DecryptedAvatarImage } from "../image/DecryptedAvatarImage.tsx";
import { Avatar, AvatarFallback } from "../ui/Avatar.tsx";
import { BottomSheet } from "../ui/BottomSheet.tsx";
import { Button } from "../ui/Button.tsx";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/Dialog.tsx";
import { Icon } from "../ui/Icon.tsx";
import { ListRow, ListSection } from "../ui/List.tsx";
import { SegmentedControl } from "../ui/SegmentedControl.tsx";
import { Text } from "../ui/Text.tsx";
import { useCachedGroup } from "../../hooks/useCachedGroup.ts";
import { useMemberRemoval } from "../../hooks/useMemberRemoval.tsx";
import type { useLiveTrackingPositions } from "../../hooks/useLiveTrackingPositions.ts";
import { trpc } from "../../lib/api.ts";
import { loadPersonalNicknames, encryptPersonalNickname } from "../../lib/personalNicknames.ts";
import { authClient } from "../../lib/auth-client.ts";
import { cn } from "../../lib/cn.ts";
import { getBatteryVisual } from "../../lib/batteryVisual.ts";
import { buildMemberLiveStatuses } from "../../lib/buildMemberLiveStatuses.ts";
import { deviceIconFor } from "../../lib/deviceIcons.ts";
import { initials } from "../../lib/initials.ts";
import { mayBeOutOfBattery } from "../../lib/mayBeOutOfBattery.ts";
import { shortTimeSince, timeSince } from "../../lib/timeSince.ts";
import { useSingleFlight } from "../../lib/useSingleFlight.ts";
import { userMessage } from "../../lib/userMessage.ts";
import { thisDeviceNoun } from "../../lib/thisDeviceNoun.ts";

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
  const nicknameSave = useSingleFlight<"save">();
  const [changingRole, setChangingRole] = useState<{
    memberId: string;
    role: "OWNER" | "ADMIN" | "MEMBER";
  } | null>(null);
  const [addMemberDialogOpen, setAddMemberDialogOpen] = useState(false);
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const { data: session } = authClient.useSession();
  const isFocused = useIsFocused();
  const queryClient = useQueryClient();
  const removal = useMemberRemoval(groupId);
  const updateRole = useMutation(trpc.groupMembership.updateRole.mutationOptions());
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
  const canManage = self?.role === "OWNER" || self?.role === "ADMIN";

  if (isFetchingMembers) {
    return <LoadingIndicator />;
  }

  return (
    <View>
      <InviteMemberToGroupDialog
        open={addMemberDialogOpen}
        setOpen={setAddMemberDialogOpen}
        groupId={groupId}
        canInviteAdmins={self?.role === "OWNER"}
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
            Only you can see this nickname. It’s encrypted before it leaves this {thisDeviceNoun()},
            and your other phones can read it too. Leave it blank to use their profile name.
          </Text>
          {nicknameQuery.isError && (
            <Text>Unable to load nicknames. Try again before making changes.</Text>
          )}
          <TextInput
            accessibilityLabel="Nickname"
            value={nickname}
            onChangeText={setNickname}
            placeholder="Nickname"
            className="h-[52px] rounded-xl bg-card px-4 text-base text-foreground placeholder:text-tertiary"
          />
          <Button
            disabled={nicknameQuery.isPending || nicknameQuery.isError}
            loading={nicknameSave.isPending}
            onPress={() =>
              nicknameSave.run("save", async () => {
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
                  Alert.alert("Couldn’t save nickname", userMessage(result.error));
                  return;
                }
                await queryClient.invalidateQueries({
                  queryKey: ["personalNicknames", groupId, session?.user.id],
                });
                setNicknameMember(null);
              })
            }
          >
            <Text>Save nickname</Text>
          </Button>
        </DialogContent>
      </Dialog>
      {removal.successorDialog}
      <View className="flex-row items-center justify-between pb-3">
        <Text variant="label">
          {members?.length ?? 0} {members?.length === 1 ? "member" : "members"}
        </Text>
        {canManage && (
          <Button size="sm" className="rounded-full" onPress={() => setAddMemberDialogOpen(true)}>
            <Icon as={UserPlusIcon} className="size-4 text-white" />
            <Text>Invite</Text>
          </Button>
        )}
      </View>
      <View className={groupedListClassName}>
        {memberStatuses.map((member, index) => (
          <Pressable
            key={member.id}
            accessibilityRole="button"
            accessibilityLabel={`${member.nickname ?? member.user.name}, ${ROLE_LABELS[member.role]}`}
            accessibilityHint="Opens actions for this member"
            onPress={() => setSelectedMemberId(member.id)}
            className={cn(
              "flex-row items-start gap-3 py-3.5 pl-4 pr-2 active:bg-container",
              groupedRowClassName(index),
            )}
            style={groupedRowStyle(index, memberStatuses.length)}
          >
            <Avatar alt={member.nickname ?? member.user.name} className="size-11">
              <DecryptedAvatarImage url={member.user.image} />
              <AvatarFallback>
                <Text className="font-bold">{initials(member.nickname ?? member.user.name)}</Text>
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
                <View className="flex-1" />
                {changingRole?.memberId === member.id ? (
                  <ActivityIndicator size="small" />
                ) : (
                  <Text className="text-tertiary text-sm">{ROLE_LABELS[member.role]}</Text>
                )}
                <Icon as={EllipsisVerticalIcon} className="text-secondary size-5" />
              </View>
              <MemberStatus
                arrivalsOff={arrivalsOffLabel(member.user.id)}
                isSelf={member.id === self?.id}
                unreadableDeviceIds={liveStatus.undecryptable
                  .filter((device) => device.groupId === groupId)
                  .map((device) => device.deviceId)}
                member={member}
                sharingPaused={
                  liveStatus.sharing?.some((device) => device.userId === member.user.id) === true &&
                  liveStatus.sharing.every(
                    (device) => device.userId !== member.user.id || device.paused,
                  )
                }
              />
            </View>
          </Pressable>
        ))}
      </View>
      <BottomSheet visible={selectedMember !== undefined} onClose={() => setSelectedMemberId(null)}>
        {selectedMember ? (
          <>
            <View className="flex-row items-center gap-3">
              <Avatar alt={selectedMember.nickname ?? selectedMember.user.name} className="size-12">
                <DecryptedAvatarImage url={selectedMember.user.image} />
                <AvatarFallback>
                  <Text className="font-bold">
                    {initials(selectedMember.nickname ?? selectedMember.user.name)}
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
                <Text className="text-secondary text-sm">{ROLE_LABELS[selectedMember.role]}</Text>
              </View>
            </View>
            {self?.role === "OWNER" && selectedMember.id !== self.id ? (
              <View className="gap-2">
                <Text variant="label">Role</Text>
                <SegmentedControl
                  accessibilityLabel={`Role for ${selectedMember.nickname ?? selectedMember.user.name}`}
                  options={(["OWNER", "ADMIN", "MEMBER"] as const).map((role) => ({
                    value: role,
                    label: ROLE_LABELS[role],
                  }))}
                  selected={selectedMember.role}
                  disabled={changingRole !== null}
                  onChange={(role) => {
                    if (role === selectedMember.role) return;
                    setSelectedMemberId(null);
                    Alert.alert(
                      "Change role?",
                      `Make ${selectedMember.nickname ?? selectedMember.user.name} ${role.toLowerCase()}?`,
                      [
                        { text: "Cancel", style: "cancel" },
                        {
                          text: "Change",
                          onPress: async () => {
                            setChangingRole({
                              memberId: selectedMember.id,
                              role,
                            });
                            const result = await tryCatch(
                              updateRole.mutateAsync({
                                groupId,
                                memberId: selectedMember.id,
                                role,
                              }),
                            );
                            if (result.error) {
                              setChangingRole(null);
                              Alert.alert("Couldn’t change role", userMessage(result.error));
                              return;
                            }
                            await queryClient.invalidateQueries({
                              queryKey: trpc.groupMembership.list.queryKey(),
                            });
                            setChangingRole(null);
                          },
                        },
                      ],
                    );
                  }}
                />
              </View>
            ) : null}
            <ListSection>
              <ListRow
                title="Edit nickname"
                subtitle="Only you see nicknames"
                icon={PencilIcon}
                iconColor="blue"
                accessibilityHint="Only you see nicknames"
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
              />
              {selectedMember.id === self?.id ||
              (canManage && (self?.role === "OWNER" || selectedMember.role === "MEMBER")) ? (
                <ListRow
                  title={selectedMember.id === self?.id ? "Leave group" : "Remove from group"}
                  icon={selectedMember.id === self?.id ? LogOutIcon : UserMinusIcon}
                  tone="danger"
                  disabled={removal.isPending}
                  onPress={() => {
                    setSelectedMemberId(null);
                    removal.confirmRemoval({
                      id: selectedMember.id,
                      userId: selectedMember.user.id,
                      name: selectedMember.user.name,
                    });
                  }}
                />
              ) : null}
            </ListSection>
          </>
        ) : null}
      </BottomSheet>
    </View>
  );
};

const ROLE_LABELS = {
  OWNER: "Owner",
  ADMIN: "Admin",
  MEMBER: "Member",
} as const;

const MemberStatus = ({
  arrivalsOff,
  isSelf,
  member,
  sharingPaused,
  unreadableDeviceIds,
}: {
  arrivalsOff: string | null;
  isSelf: boolean;
  unreadableDeviceIds: readonly string[];
  member: ReturnType<typeof buildMemberLiveStatuses>[number];
  sharingPaused: boolean;
}) => {
  const mayWarn = (device: (typeof member.devices)[number]) =>
    !isSelf && !unreadableDeviceIds.includes(device.deviceId) && mayBeOutOfBattery(device);
  const batteryVisual = member.battery
    ? getBatteryVisual({
        batteryLevel: member.battery.level,
        charging: member.battery.charging,
      })
    : null;

  return (
    <View className="gap-1 pr-2">
      {sharingPaused ? (
        <View className="flex-row items-center gap-1.5 self-start rounded-full bg-warning px-2.5 py-1">
          <Icon as={CirclePauseIcon} className="text-warning-text size-3.5" />
          <Text className="text-warning-text text-xs font-semibold">Location sharing paused</Text>
        </View>
      ) : member.activeDeviceCount >= 2 && member.devices.length > 0 ? (
        member.devices.map((device) => {
          const deviceBattery = getBatteryVisual({
            batteryLevel: device.battery.level,
            charging: device.battery.charging,
          });
          const updated = timeSince(device.timestamp);
          const lowBattery = mayWarn(device);
          return (
            <View
              key={device.deviceId}
              accessible
              accessibilityLabel={[
                device.name ?? "Device",
                lowBattery && "may be out of battery",
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
              <Text className="text-secondary flex-1 text-sm" numberOfLines={lowBattery ? 2 : 1}>
                {device.name ?? "Device"},{" "}
                {lowBattery
                  ? `may be out of battery, ${shortTimeSince(device.timestamp)} ago`
                  : updated}
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
              {member.timestamp === null
                ? "Location unavailable"
                : member.devices[0] && mayWarn(member.devices[0])
                  ? `May be out of battery, ${shortTimeSince(member.timestamp)} ago`
                  : `Updated ${timeSince(member.timestamp)}`}
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
