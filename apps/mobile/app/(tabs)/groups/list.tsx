import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "expo-router";
import { ChevronRightIcon, PlusIcon, ShieldIcon } from "lucide-react-native";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { CreateGroupDialog } from "../../../components/dialogs/CreateGroupDialog";
import { LoadingIndicator } from "../../../components/LoadingIndicator";
import { RefreshablePage } from "../../../components/RefreshablePage";
import { Avatar, AvatarFallback, AvatarImage } from "../../../components/ui/Avatar";
import { Button } from "../../../components/ui/Button";
import { Card, CardDescription, CardHeader, CardTitle } from "../../../components/ui/Card";
import { Icon } from "../../../components/ui/Icon";
import { Text } from "../../../components/ui/Text";
import { type RouterOutputs, trpc } from "../../../lib/api";

export default function GroupsScreen() {
  const [createGroupDialogOpen, setCreateGroupDialogOpen] = useState(false);

  const { data: groupList, isFetching: isFetchingGroupList } = useQuery(
    trpc.groups.list.queryOptions(),
  );
  const { data: groupInvites, isFetching: isFetchingGroupInvites } = useQuery(
    trpc.groups.invites.queryOptions(),
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
  groupInvites: RouterOutputs["groups"]["invites"];
}

export const GroupInvitesList = ({ groupInvites }: GroupInvitesListProps) => {
  const queryClient = useQueryClient();
  const acceptInviteMutation = useMutation(trpc.groups.acceptInvite.mutationOptions());
  const declineInviteMutation = useMutation(trpc.groups.declineInvite.mutationOptions());

  const handleAcceptInvite = async (inviteId: string) => {
    await acceptInviteMutation.mutateAsync(
      { inviteId },
      {
        onSuccess: (data) => {
          queryClient.setQueryData(trpc.groups.invites.queryKey(), (previous) => {
            if (!previous) {
              return [];
            }
            return previous.filter((invite) => invite.id !== inviteId);
          });

          queryClient.setQueryData(trpc.groups.list.queryKey(), (previous) => {
            return [
              ...(previous ?? []),
              {
                ...data.group,
                members: data.group.members,
              },
            ] satisfies RouterOutputs["groups"]["list"];
          });
        },
      },
    );
  };
  const handleDeclineInvite = async (inviteId: string) => {
    await declineInviteMutation.mutateAsync(
      { inviteId },
      {
        onSuccess: () => {
          queryClient.setQueryData(trpc.groups.invites.queryKey(), (previous) => {
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
      {groupInvites?.map((invite) => (
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
              >
                <Text>Decline</Text>
              </Button>
              <Button
                size="sm"
                onPress={() => handleAcceptInvite(invite.id)}
                loading={acceptInviteMutation.isPending}
              >
                <Text>Accept</Text>
              </Button>
            </View>
          </CardHeader>
        </Card>
      ))}
    </View>
  );
};

interface GroupListProps {
  groupList: RouterOutputs["groups"]["list"];
  setCreateGroupDialogOpen: (open: boolean) => void;
}

export const GroupList = ({ groupList, setCreateGroupDialogOpen }: GroupListProps) => {
  return (
    <View>
      {!groupList?.length ? (
        <>
          <View className="items-center pt-10 gap-6">
            <View className="w-20 h-20 rounded-full border border-primary/30 items-center justify-center bg-primary/15">
              <ShieldIcon size={40} />
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

          <View className="flex flex-row items-start gap-2 p-4 mt-4 rounded-lg bg-card border-border border">
            <View className="w-2 h-2 rounded-full mt-2 bg-primary" />
            <Text className="text-sm text-muted">
              Location data is encrypted end-to-end. The server never stores your plaintext
              location.
            </Text>
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
