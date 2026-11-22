import { useIsFocused } from "@react-navigation/native";
import { useQuery } from "@tanstack/react-query";
import { Link } from "expo-router";
import {
  ChevronRightIcon,
  LockIcon,
  MailIcon,
  PlusIcon,
  QrCodeIcon,
  UsersIcon,
} from "lucide-react-native";
import { useState } from "react";
import { Platform, Pressable, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AnnouncementBanner } from "../../../components/AnnouncementBanner.tsx";
import {
  groupedListClassName,
  groupedRowClassName,
  groupedRowStyle,
} from "../../../components/groups/groupedRows.ts";
import { TabHeader, tabScreenEdges } from "../../../components/headers/TabHeader.tsx";
import { CreateGroupDialog } from "../../../components/dialogs/CreateGroupDialog.tsx";
import { LoadingIndicator } from "../../../components/LoadingIndicator.tsx";
import { RefreshablePage } from "../../../components/RefreshablePage.tsx";
import { DecryptedAvatarImage } from "../../../components/image/DecryptedAvatarImage.tsx";
import { Avatar, AvatarFallback } from "../../../components/ui/Avatar.tsx";
import { Button } from "../../../components/ui/Button.tsx";
import { Icon } from "../../../components/ui/Icon.tsx";
import { Text } from "../../../components/ui/Text.tsx";
import { useGroupColorRevision } from "../../../hooks/useGroupColorRevision.ts";
import { useRefetchWhileFocused } from "../../../hooks/useRefetchWhileFocused.ts";
import { useUnseenGroupHistory } from "../../../hooks/useUnseenGroupHistory.ts";
import { type RouterOutputs, trpc } from "../../../lib/api.ts";
import { cn } from "../../../lib/cn.ts";
import { getGroupColor } from "../../../lib/groupColor.ts";
import { initials } from "../../../lib/initials.ts";
import { thisDeviceNoun } from "../../../lib/thisDeviceNoun.ts";

const ios = Platform.OS === "ios";

const GroupsScreen = () => {
  const [createGroupDialogOpen, setCreateGroupDialogOpen] = useState(false);

  const isFocused = useIsFocused();
  const groups = useQuery({
    ...trpc.groupMembership.list.queryOptions(),
    subscribed: isFocused,
  });
  const invites = useQuery({
    ...trpc.groupInvites.list.queryOptions(),
    subscribed: isFocused,
  });
  useRefetchWhileFocused(
    [trpc.groupMembership.list.queryKey(), trpc.groupInvites.list.queryKey()],
    30_000,
  );

  if (groups.isPending || invites.isPending) {
    return <LoadingIndicator />;
  }

  if (!groups.data) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center gap-4 bg-background px-6">
        <AnnouncementBanner className="self-stretch" />
        <Text className="text-center text-tertiary">
          We couldn’t load your groups. Check your connection and try again.
        </Text>
        <Button
          variant="secondary"
          loading={groups.isFetching}
          onPress={() => Promise.all([groups.refetch(), invites.refetch()])}
        >
          <Text>Try again</Text>
        </Button>
      </SafeAreaView>
    );
  }

  const actions =
    groups.data.length > 0 ? (
      <>
        <Link href="/join" asChild>
          <Button
            size="sm"
            variant="secondary"
            className={ios ? "size-9 px-0" : ""}
            hitSlop={4}
            accessibilityLabel="Join a group with a QR code or join code"
          >
            <Icon as={QrCodeIcon} className="size-5 text-secondary-foreground" />
            {ios ? null : <Text>Join</Text>}
          </Button>
        </Link>
        <Button
          size="sm"
          className={ios ? "size-9 px-0" : ""}
          hitSlop={4}
          accessibilityLabel="Create new group"
          onPress={() => setCreateGroupDialogOpen(true)}
        >
          <Icon as={PlusIcon} className="size-5 text-white" />
          {ios ? null : <Text>New</Text>}
        </Button>
      </>
    ) : undefined;

  return (
    <RefreshablePage edges={tabScreenEdges}>
      <View className="flex-1 bg-background px-4 pb-32">
        <CreateGroupDialog open={createGroupDialogOpen} setOpen={setCreateGroupDialogOpen} />
        <TabHeader title="Groups" actions={actions} />
        <AnnouncementBanner className="mb-4" />
        {groups.isError || invites.isError ? (
          <Text accessibilityLiveRegion="polite" className="text-secondary mb-4 px-1 text-sm">
            We couldn’t reach the server, so this list may be out of date.
          </Text>
        ) : null}
        <GroupInvitesList groupInvites={invites.data ?? []} />
        <GroupList groupList={groups.data} setCreateGroupDialogOpen={setCreateGroupDialogOpen} />
      </View>
    </RefreshablePage>
  );
};

const GroupInvitesList = ({
  groupInvites,
}: {
  groupInvites: RouterOutputs["groupInvites"]["list"];
}) => {
  if (!groupInvites.length) return null;
  return (
    <View className="mb-4 gap-2">
      {groupInvites.map((invite) => (
        <View
          key={invite.id}
          className="flex-row items-center gap-3 rounded-3xl bg-primary-soft py-3 pl-4 pr-3"
        >
          <Icon as={MailIcon} className="text-primary-text size-5" />
          <Text className="text-foreground flex-1">
            You’ve been sent an invite to <Text className="font-bold">{invite.group.name}</Text>
          </Text>
          <Link href={{ pathname: "/join", params: { inviteId: invite.id } }} asChild>
            <Button size="sm">
              <Text>View invite</Text>
            </Button>
          </Link>
        </View>
      ))}
    </View>
  );
};

export const GroupList = ({
  groupList,
  setCreateGroupDialogOpen,
}: {
  groupList: RouterOutputs["groupMembership"]["list"];
  setCreateGroupDialogOpen: (open: boolean) => void;
}) => {
  useGroupColorRevision();
  const { unseenGroupIds } = useUnseenGroupHistory();

  if (!groupList.length) {
    return (
      <View className="gap-6 pt-8">
        <View className="items-center gap-3 px-4">
          <View className="size-20 items-center justify-center rounded-full bg-primary-soft">
            <Icon as={UsersIcon} className="text-primary-text size-9" />
          </View>
          <Text className="text-foreground pt-2 text-2xl font-bold">No groups yet</Text>
          <Text className="text-secondary text-center">
            Create a group to share your location with people you choose, or join one you’ve been
            invited to.
          </Text>
        </View>
        <View className="gap-3">
          <Button onPress={() => setCreateGroupDialogOpen(true)}>
            <Text>Create a group</Text>
          </Button>
          <Link href="/join" asChild>
            <Button variant="secondary">
              <Text>Scan QR or enter join code</Text>
            </Button>
          </Link>
        </View>
        <View className="flex-row items-center gap-3 rounded-3xl bg-card p-4">
          <Icon as={LockIcon} className="text-secondary size-5" />
          <Text className="text-secondary flex-1 text-sm">
            Your location is encrypted on this {thisDeviceNoun()} before it’s sent, and only your
            groups can decrypt it.
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View className={groupedListClassName}>
      {groupList.map((group, index) => (
        <Link
          href={`/groups/${group.id}`}
          key={group.id}
          asChild
          accessibilityLabel={`${group.name}, ${group.members.length} ${group.members.length === 1 ? "member" : "members"}${unseenGroupIds.has(group.id) ? ", new activity" : ""}`}
        >
          <Pressable
            className={cn(
              "flex-row items-center gap-3 py-3 pl-4 pr-3 active:bg-container",
              groupedRowClassName(index),
            )}
            style={groupedRowStyle(index, groupList.length)}
          >
            <View
              className="rounded-full p-0.5"
              style={{ borderWidth: 3, borderColor: getGroupColor(group.id) }}
            >
              <Avatar alt={`${group.name}'s image`} className="size-12">
                <DecryptedAvatarImage url={group.image} />
                <AvatarFallback>
                  <Text className="font-bold">{initials(group.name)}</Text>
                </AvatarFallback>
              </Avatar>
            </View>
            <View className="flex-1 gap-1.5">
              <View className="flex-row items-center gap-2">
                <Text
                  numberOfLines={1}
                  className={cn(
                    "text-foreground shrink",
                    ios ? "text-[17px] font-semibold" : "text-base font-medium",
                  )}
                >
                  {group.name}
                </Text>
                {unseenGroupIds.has(group.id) ? (
                  <View className="size-2 rounded-full bg-primary" />
                ) : null}
              </View>
              <View className="flex-row items-center gap-2">
                <View className="flex-row pl-1.5">
                  {group.members.slice(0, 4).map((member) => (
                    <Avatar
                      key={member.id}
                      alt={member.name}
                      className="-ml-1.5 size-6 border-2 border-card"
                    >
                      <DecryptedAvatarImage url={member.image} />
                      <AvatarFallback>
                        <Text className="text-[11px] font-bold">
                          {initials(member.name).slice(0, 1)}
                        </Text>
                      </AvatarFallback>
                    </Avatar>
                  ))}
                </View>
                <Text className="text-tertiary text-sm">
                  {group.members.length} {group.members.length === 1 ? "member" : "members"}
                </Text>
              </View>
            </View>
            {ios ? <Icon as={ChevronRightIcon} className="size-5 text-border-strong" /> : null}
          </Pressable>
        </Link>
      ))}
    </View>
  );
};

export default GroupsScreen;
