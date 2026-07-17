import { tryCatch } from "@openbeacon/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "expo-router";
import { ChevronRightIcon, PlusIcon, ShieldIcon } from "lucide-react-native";
import { useState } from "react";
import { Alert, Pressable, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { CreateGroupDialog } from "../../../components/dialogs/CreateGroupDialog.tsx";
import { LoadingIndicator } from "../../../components/LoadingIndicator.tsx";
import { RefreshablePage } from "../../../components/RefreshablePage.tsx";
import { Avatar, AvatarFallback, AvatarImage } from "../../../components/ui/Avatar.tsx";
import { Button } from "../../../components/ui/Button.tsx";
import { Card, CardDescription, CardHeader, CardTitle } from "../../../components/ui/Card.tsx";
import { Icon } from "../../../components/ui/Icon.tsx";
import { Text } from "../../../components/ui/Text.tsx";
import { type RouterOutputs, trpc } from "../../../lib/api.ts";
import { buildAcceptInviteInput } from "../../../lib/groupEncryption.ts";
import { requestTrackingSync } from "../../../lib/trackingEvents.ts";
import { useSingleFlight } from "../../../lib/useSingleFlight.ts";

export default function GroupsScreen() {
  const [createGroupDialogOpen, setCreateGroupDialogOpen] = useState(false);

  const { data: groupList, isFetching: isFetchingGroupList } = useQuery(
    trpc.groupMembership.list.queryOptions(),
  );
  const { data: groupInvites, isFetching: isFetchingGroupInvites } = useQuery(
    trpc.groupInvites.list.queryOptions(),
  );

  if (isFetchingGroupList || isFetchingGroupInvites) {
    return <LoadingIndicator />;
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
        <GroupInvitesList groupInvites={groupInvites ?? []} />
        <GroupList
          groupList={groupList ?? []}
          setCreateGroupDialogOpen={setCreateGroupDialogOpen}
        />
      </SafeAreaView>
    </RefreshablePage>
  );
}

interface GroupInvitesListProps {
  groupInvites: RouterOutputs["groupInvites"]["list"];
}

export const GroupInvitesList = ({ groupInvites }: GroupInvitesListProps) => {
  const queryClient = useQueryClient();
  const acceptInviteMutation = useMutation(trpc.groupInvites.accept.mutationOptions());
  const declineInviteMutation = useMutation(trpc.groupInvites.decline.mutationOptions());
  const acceptInviteSubmission = useSingleFlight<string>();

  const handleAcceptInvite = async (inviteId: string) => {
    if (declineInviteMutation.isPending) return;

    await acceptInviteSubmission.run(inviteId, async () => {
      const result = await tryCatch(
        (async () => {
          const acceptInviteInput = await buildAcceptInviteInput({ inviteId });
          const data = await acceptInviteMutation.mutateAsync(acceptInviteInput);

          queryClient.setQueryData(trpc.groupInvites.list.queryKey(), (previous) => {
            if (!previous) {
              return [];
            }
            return previous.filter((invite) => invite.id !== inviteId);
          });

          queryClient.setQueryData(trpc.groupMembership.list.queryKey(), (previous) => {
            return [
              ...(previous ?? []),
              {
                ...data.group,
                members: data.group.members,
              },
            ] satisfies RouterOutputs["groupMembership"]["list"];
          });
          requestTrackingSync();
        })(),
      );

      if (result.error) {
        Alert.alert(
          "Unable to accept invite",
          result.error instanceof Error ? result.error.message : "Something went wrong.",
        );
      }
    });
  };
  const handleDeclineInvite = async (inviteId: string) => {
    await declineInviteMutation.mutateAsync(
      { inviteId },
      {
        onSuccess: () => {
          queryClient.setQueryData(trpc.groupInvites.list.queryKey(), (previous) => {
            if (!previous) {
              return [];
            }
            return previous.filter((invite) => invite.id !== inviteId);
          });
        },
      },
    );
  };

  if (!groupInvites?.length) {
    return null;
  }

  return (
    <View className="gap-4">
      <Text className="text-foreground font-bold text-lg">Group Invites</Text>
      {groupInvites?.map((invite) => {
        const isAcceptingInvite =
          acceptInviteSubmission.pendingKey === invite.id && !declineInviteMutation.isPending;

        return (
          <Card key={invite.id}>
            <CardHeader>
              <Text>
                {invite.inviter.name} invited you to join {invite.group.name}
              </Text>
              <View className="flex-row items-center justify-between gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onPress={() => handleDeclineInvite(invite.id)}
                  loading={declineInviteMutation.isPending}
                  disabled={acceptInviteSubmission.isPending}
                >
                  <Text>Decline</Text>
                </Button>
                <Button
                  size="sm"
                  onPress={() => handleAcceptInvite(invite.id)}
                  loading={isAcceptingInvite}
                  disabled={
                    declineInviteMutation.isPending ||
                    (acceptInviteSubmission.isPending && !isAcceptingInvite)
                  }
                >
                  <Text>Accept</Text>
                </Button>
              </View>
            </CardHeader>
          </Card>
        );
      })}
    </View>
  );
};

interface GroupListProps {
  groupList: RouterOutputs["groupMembership"]["list"];
  setCreateGroupDialogOpen: (open: boolean) => void;
}

export const GroupList = ({ groupList, setCreateGroupDialogOpen }: GroupListProps) => {
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
                <Text className="text-xs font-semibold uppercase tracking-[1px] text-primary">
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
                      <Avatar alt={`${group.name}'s image`} className="size-12">
                        <AvatarImage source={{ uri: group.image ?? "" }} />
                        <AvatarFallback>
                          <Text className="font-bold">
                            {(group.name.charAt(0) + group.name.charAt(1)).toUpperCase()}
                          </Text>
                        </AvatarFallback>
                      </Avatar>
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
                              <Text className="font-bold">
                                {(member.name.charAt(0) + member.name.charAt(1)).toUpperCase()}
                              </Text>
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
