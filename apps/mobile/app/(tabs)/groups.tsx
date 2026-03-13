import { useMutation, useQuery } from "@tanstack/react-query";
import { PlusIcon, ShieldIcon, TrashIcon } from "lucide-react-native";
import { Alert, Pressable, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button } from "../../components/Button.tsx";
import { Text } from "../../components/Text.tsx";
import { trpc } from "../../lib/api.ts";
import { tryCatch } from "../../lib/tryCatch.ts";

export default function GroupsScreen() {
  const {
    data: groupList,
    isLoading,
    refetch: refetchGroupList,
  } = useQuery(trpc.groups.list.queryOptions());
  const createGroupMutation = useMutation(trpc.groups.create.mutationOptions());
  const deleteGroupMutation = useMutation(trpc.groups.delete.mutationOptions());

  const handleCreateGroup = async () => {
    const { error } = await tryCatch(createGroupMutation.mutateAsync({ name: "Test" }));
    if (error) {
      Alert.alert("Failed to create group", error.message);
      return;
    }
    refetchGroupList();
  };

  const handleDeleteGroup = async (groupId: string) => {
    const { error } = await tryCatch(deleteGroupMutation.mutateAsync({ id: groupId }));
    if (error) {
      Alert.alert("Failed to delete group", error.message);
      return;
    }
    refetchGroupList();
  };

  if (isLoading) {
    return <Text>Loading...</Text>;
  }

  return (
    <View className="flex-1 bg-background">
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
            <PlusIcon color="white" size={16} onPress={handleCreateGroup} />
          </Pressable>
        </View>
      </SafeAreaView>

      <ScrollView
        className="flex-1"
        contentContainerClassName="px-6 pb-28 gap-4"
        showsVerticalScrollIndicator={false}
      >
        {!groupList?.length ? (
          <>
            <View className="items-center pt-10 gap-6">
              <View className="w-20 h-20 rounded-full border border-primary/30 items-center justify-center bg-primary/15">
                <ShieldIcon size={40} />
              </View>
              <View className="items-center gap-2">
                <Text className="text-foreground font-bold text-2xl">No groups yet</Text>
                <Text className="text-sm text-muted text-center max-w-80">
                  Groups keep your family connected. Create one to start sharing locations
                  privately; only members of your group can see each other.
                </Text>
              </View>
              <Button title="Create a Group" variant="primary" onPress={handleCreateGroup} />
            </View>

            <View className="flex flex-row items-start gap-2 p-4 mt-4 rounded-lg bg-surface border-border border">
              <View className="w-2 h-2 rounded-full mt-2 bg-primary" />
              <Text className="text-sm text-muted">
                Location data is encrypted end-to-end. The server never stores your plaintext
                location.
              </Text>
            </View>
          </>
        ) : (
          <View>
            {groupList.map((group) => (
              <View key={group.id} className="flex-row items-center justify-between">
                <Text>{group.name}</Text>
                <TrashIcon size={20} color="red" onPress={() => handleDeleteGroup(group.id)} />
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}
