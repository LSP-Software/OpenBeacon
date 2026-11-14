import { Alert } from "../../../lib/alert.ts";
import { useIsFocused } from "@react-navigation/native";
import { tryCatch } from "@openbeacon/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "expo-router";
import { ChevronRightIcon, PlusIcon, ShieldIcon } from "lucide-react-native";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { CreateGroupDialog } from "../../../components/dialogs/CreateGroupDialog.tsx";
import { LoadingIndicator } from "../../../components/LoadingIndicator.tsx";
import { RefreshablePage } from "../../../components/RefreshablePage.tsx";
import { Avatar, AvatarFallback, AvatarImage } from "../../../components/ui/Avatar.tsx";
import { Button } from "../../../components/ui/Button.tsx";
import { Card, CardDescription, CardHeader, CardTitle } from "../../../components/ui/Card.tsx";
import { Icon } from "../../../components/ui/Icon.tsx";
import { Text } from "../../../components/ui/Text.tsx";
import { useGroupColorRevision } from "../../../hooks/useGroupColorRevision.ts";
import { useRefetchWhileFocused } from "../../../hooks/useRefetchWhileFocused.ts";
import { type RouterOutputs, trpc } from "../../../lib/api.ts";
import { getGroupColor } from "../../../lib/groupColor.ts";
import { initials } from "../../../lib/initials.ts";

export default function GroupsScreen() {
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
  const { data: joinAlerts } = useQuery({
    ...trpc.groupInvites.joinAlerts.queryOptions(),
    subscribed: isFocused,
  });
  useRefetchWhileFocused(
    [
      trpc.groupMembership.list.queryKey(),
      trpc.groupInvites.list.queryKey(),
      trpc.groupInvites.joinAlerts.queryKey(),
    ],
    30_000,
  );

  if (groups.isPending || invites.isPending) {
    return <LoadingIndicator />;
  }

  if (!groups.data) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center gap-4 bg-background px-6">
        <Text className="text-center text-muted-foreground">
          We couldn’t load your groups. Check your connection and try again.
        </Text>
        <Button
          variant="outline"
          loading={groups.isFetching}
          onPress={() => Promise.all([groups.refetch(), invites.refetch()])}
        >
          <Text>Try again</Text>
        </Button>
      </SafeAreaView>
    );
  }

  return (
    <RefreshablePage>
      <SafeAreaView className="flex-1 bg-background px-6 py-4" edges={["top"]}>
        <CreateGroupDialog open={createGroupDialogOpen} setOpen={setCreateGroupDialogOpen} />
        <View className="flex-row items-center justify-between pb-10">
          <Text className="text-foreground font-bold text-3xl">Your Groups</Text>
          <Pressable
            className="w-10 h-10 rounded-full items-center justify-center bg-primary"
            accessibilityRole="button"
            accessibilityLabel="Create new group"
            onPress={() => setCreateGroupDialogOpen(true)}
          >
            <PlusIcon color="white" size={16} />
          </Pressable>
        </View>
        <Link href="/join" asChild>
          <Button variant="outline" className="mb-4">
            <Text>Scan QR or enter join code</Text>
          </Button>
        </Link>
        {groups.isError || invites.isError ? (
          <Text accessibilityLiveRegion="polite" className="mb-4 text-sm text-muted-foreground">
            We couldn’t reach the server, so this list may be out of date.
          </Text>
        ) : null}
        <GroupJoinAlerts alerts={joinAlerts ?? []} />
        <GroupInvitesList groupInvites={invites.data ?? []} />
        <GroupList groupList={groups.data} setCreateGroupDialogOpen={setCreateGroupDialogOpen} />
      </SafeAreaView>
    </RefreshablePage>
  );
}

const GroupJoinAlerts = ({ alerts }: { alerts: RouterOutputs["groupInvites"]["joinAlerts"] }) => {
  const queryClient = useQueryClient();
  const dismiss = useMutation(trpc.groupInvites.dismissJoinAlert.mutationOptions());
  if (!alerts.length) return null;
  return (
    <View className="gap-3 mb-4">
      <Text className="font-bold text-lg">Group activity</Text>
      {alerts.map((item) => (
        <Card key={item.id}>
          <CardHeader>
            <Text>
              {item.memberName} joined {item.group.name}
            </Text>
            <Button
              variant="outline"
              size="sm"
              onPress={async () => {
                const result = await tryCatch(dismiss.mutateAsync({ id: item.id }));
                if (result.error) {
                  Alert.alert("Unable to dismiss alert", result.error.message);
                  return;
                }
                await queryClient.invalidateQueries({
                  queryKey: trpc.groupInvites.joinAlerts.queryKey(),
                });
              }}
            >
              <Text>Dismiss</Text>
            </Button>
          </CardHeader>
        </Card>
      ))}
    </View>
  );
};

const GroupInvitesList = ({
  groupInvites,
}: {
  groupInvites: RouterOutputs["groupInvites"]["list"];
}) => {
  if (!groupInvites.length) return null;
  return (
    <View className="gap-3 mb-4">
      <Text className="text-foreground font-bold text-lg">Group Invites</Text>
      {groupInvites.map((invite) => (
        <Card key={invite.id}>
          <CardHeader className="flex-row items-center gap-3">
            <Text className="flex-1">
              You’ve been sent an invite to <Text className="font-bold">{invite.group.name}</Text>
            </Text>
            <Link href={{ pathname: "/join", params: { inviteId: invite.id } }} asChild>
              <Button size="sm">
                <Text>View invite</Text>
              </Button>
            </Link>
          </CardHeader>
        </Card>
      ))}
    </View>
  );
};

interface GroupListProps {
  groupList: RouterOutputs["groupMembership"]["list"];
  setCreateGroupDialogOpen: (open: boolean) => void;
}

export const GroupList = ({ groupList, setCreateGroupDialogOpen }: GroupListProps) => {
  useGroupColorRevision();

  return (
    <View>
      {!groupList?.length ? (
        <>
          <View className="items-center pt-10 gap-6">
            <View className="w-20 h-20 rounded-full border border-primary/30 items-center justify-center bg-primary/15">
              <Icon as={ShieldIcon} size={40} className="text-primary" />
            </View>
            <View className="items-center gap-2">
              <Text className="text-foreground font-bold text-2xl">No groups yet</Text>
              <Text className="text-sm text-muted text-center max-w-80">
                Groups keep your family connected. Create one to start sharing locations privately;
                only members of your group can see each other.
              </Text>
            </View>
            <Button onPress={() => setCreateGroupDialogOpen(true)}>
              <Text>Create a Group</Text>
            </Button>
          </View>

          <View className="mt-6 overflow-hidden rounded-2xl border border-primary/20 bg-card px-5 py-4">
            <View className="flex-row items-center gap-3 pr-6">
              <View className="size-10 items-center justify-center rounded-full border border-primary/20 bg-primary/10">
                <Icon as={ShieldIcon} size={18} className="text-primary" />
              </View>
              <View className="flex-1 gap-1">
                <Text className="text-xs font-semibold uppercase tracking-[1px] text-primary-text">
                  Privacy-first by default
                </Text>
                <Text className="text-base font-semibold text-foreground">
                  Location data is encrypted end-to-end
                </Text>
                <Text className="text-sm leading-6 text-muted-foreground">
                  The server never stores your plaintext location, so only members of your group can
                  read it.
                </Text>
              </View>
            </View>
          </View>
        </>
      ) : (
        <View className="gap-2">
          <Text className="text-foreground font-bold text-lg">Your Groups</Text>
          {groupList.map((group) => {
            const maxMembersToShow = 3;
            const membersToShow = group.members.slice(0, maxMembersToShow);

            return (
              <Link href={`/groups/${group.id}`} key={group.id}>
                <Card className="w-full">
                  <CardHeader className="flex-row items-center justify-between">
                    <View className="flex-row items-center gap-3">
                      <View
                        className="rounded-full p-0.5"
                        style={{ borderWidth: 3, borderColor: getGroupColor(group.id) }}
                      >
                        <Avatar alt={`${group.name}'s image`} className="size-12">
                          <AvatarImage source={{ uri: group.image ?? "" }} />
                          <AvatarFallback>
                            <Text className="font-bold">{initials(group.name)}</Text>
                          </AvatarFallback>
                        </Avatar>
                      </View>
                      <View className="gap-1">
                        <CardTitle>{group.name}</CardTitle>
                        <CardDescription>{group.members.length} members</CardDescription>
                      </View>
                    </View>

                    <View className="flex-row items-center gap-4">
                      <View className="flex-row items-center">
                        {membersToShow.map((member) => (
                          <Avatar
                            key={member.id}
                            alt={member.name}
                            className="border border-card size-8 -mr-2"
                          >
                            <AvatarImage source={{ uri: member.image ?? "" }} />
                            <AvatarFallback>
                              <Text className="font-bold">{initials(member.name)}</Text>
                            </AvatarFallback>
                          </Avatar>
                        ))}
                        {group.members.length > maxMembersToShow && (
                          <View className="size-8 rounded-full bg-gray-100 border border-card flex items-center justify-center">
                            <Text className="font-medium text-secondary">
                              +{group.members.length - maxMembersToShow}
                            </Text>
                          </View>
                        )}
                      </View>
                      <Icon as={ChevronRightIcon} size={20} className="text-muted-foreground" />
                    </View>
                  </CardHeader>
                </Card>
              </Link>
            );
          })}
        </View>
      )}
    </View>
  );
};
