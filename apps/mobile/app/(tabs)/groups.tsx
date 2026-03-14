import { useQuery } from "@tanstack/react-query";
import { ChevronRightIcon, PlusIcon, ShieldIcon } from "lucide-react-native";
import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button } from "../../components/Button.tsx";
import { CreateGroupDialog } from "../../components/dialogs/CreateGroupDialog.tsx";
import { LoadingIndicator } from "../../components/LoadingIndicator.tsx";
import { Avatar, AvatarFallback, AvatarImage } from "../../components/ui/Avatar.tsx";
import { Card, CardDescription, CardHeader, CardTitle } from "../../components/ui/Card.tsx";
import { Icon } from "../../components/ui/Icon.tsx";
import { Text } from "../../components/ui/Text.tsx";
import { type RouterOutputs, trpc } from "../../lib/api.ts";

export default function GroupsScreen() {
  const [createGroupDialogOpen, setCreateGroupDialogOpen] = useState(false);

  const {
    data: groupList,
    refetch: refetchGroupList,
    isFetching: isFetchingGroupList,
  } = useQuery(trpc.groups.list.queryOptions());
  const {
    data: groupInvites,
    refetch: refetchGroupInvites,
    isFetching: isFetchingGroupInvites,
  } = useQuery(trpc.groups.invites.queryOptions());

  if (isFetchingGroupList || isFetchingGroupInvites) {
    return <LoadingIndicator />;
  }

  return (
    <View className="flex-1 bg-background">
      <Button
        title="Refresh"
        onPress={() => {
          refetchGroupList();
          refetchGroupInvites();
        }}
      />

      <CreateGroupDialog open={createGroupDialogOpen} setOpen={setCreateGroupDialogOpen} />

      <SafeAreaView edges={["top"]} className="z-10">
        <View className="flex-row items-center justify-between px-8 pt-4 pb-10">
          <View>
            <Text className="text-muted font-bold uppercase">Your family</Text>
            <Text className="text-foreground font-bold text-3xl">Groups</Text>
          </View>
          <Pressable
            className="w-10 h-10 rounded-full items-center justify-center bg-primary"
            accessibilityRole="button"
            accessibilityLabel="Create new group"
          >
            <PlusIcon color="white" size={16} onPress={() => setCreateGroupDialogOpen(true)} />
          </Pressable>
        </View>
      </SafeAreaView>
      <ScrollView
        className="flex-1"
        contentContainerClassName="px-6 pb-28 gap-4"
        showsVerticalScrollIndicator={false}
      >
        <GroupInvitesList groupInvites={groupInvites ?? []} />
        <GroupList
          groupList={groupList ?? []}
          setCreateGroupDialogOpen={setCreateGroupDialogOpen}
        />
      </ScrollView>
    </View>
  );
}

interface GroupInvitesListProps {
  groupInvites: RouterOutputs["groups"]["invites"];
}

export const GroupInvitesList = ({ groupInvites }: GroupInvitesListProps) => {
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
              {invite.inviter.name} invited you to join {invite.groupName}
            </Text>
            <View className="flex-row items-center justify-between gap-2">
              <Button title="Decline" variant="secondary" onPress={() => {}} />
              <Button title="Accept" onPress={() => {}} />
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
            <Button
              title="Create a Group"
              variant="primary"
              onPress={() => setCreateGroupDialogOpen(true)}
            />
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
              <Card key={group.id}>
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
            );
          })}
        </View>
      )}
    </View>
  );
};
