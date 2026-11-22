import { tryCatch } from "@openbeacon/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { Button } from "../components/ui/Button.tsx";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/Dialog.tsx";
import { Text } from "../components/ui/Text.tsx";
import { Alert } from "../lib/alert.ts";
import { trpc } from "../lib/api.ts";
import { authClient } from "../lib/auth-client.ts";
import { buildRemoveGroupMemberInput, submitEpochChange } from "../lib/groupEncryption.ts";
import { forgetHiddenMapGroup } from "../lib/hiddenMapGroups.ts";
import { requestTrackingSync } from "../lib/trackingEvents.ts";
import { useSingleFlight } from "../lib/useSingleFlight.ts";
import { userMessage } from "../lib/userMessage.ts";
import { useCachedGroup } from "./useCachedGroup.ts";
import { useMemberNames } from "./useMemberNames.ts";

export const useMemberRemoval = (groupId: string) => {
  const { data: session } = authClient.useSession();
  const queryClient = useQueryClient();
  const router = useRouter();
  const removeMember = useMutation(trpc.groupMembership.remove.mutationOptions());
  const deleteGroup = useMutation(trpc.groupLifecycle.delete.mutationOptions());
  const removal = useSingleFlight<string>();
  const [successorDialogOpen, setSuccessorDialogOpen] = useState(false);
  const [successorMemberId, setSuccessorMemberId] = useState<string | null>(null);
  const { group } = useCachedGroup(groupId);
  const memberName = useMemberNames(groupId);
  const members = group?.members;
  const self = members?.find((member) => member.userId === session?.user.id);
  const nameOf = (member: { userId: string; name: string }) =>
    memberName(member.userId) ?? member.name;

  const confirmRemoval = (
    member: { id: string; userId: string; name: string },
    successor?: string,
  ) => {
    const isSelf = member.userId === session?.user.id;
    const isLastMember = isSelf && members?.length === 1;
    const anotherOwner = members?.some(
      (item) => item.role === "OWNER" && item.userId !== session?.user.id,
    );
    if (isSelf && self?.role === "OWNER" && !successor && !isLastMember && !anotherOwner) {
      setSuccessorMemberId(null);
      setSuccessorDialogOpen(true);
      return;
    }
    const chosen = successor ? members?.find((item) => item.id === successor) : undefined;
    Alert.alert(
      isSelf ? "Leave group?" : `Remove ${nameOf(member)}?`,
      isSelf
        ? isLastMember
          ? "You are the last person in this group. Leaving will permanently delete the group and its location history."
          : `${
              successor
                ? `${chosen ? nameOf(chosen) : "The selected member"} will become an owner. `
                : ""
            }You will leave this group, and your location history in this group will be deleted.`
        : `${nameOf(member)} will be removed from this group and their location history in this group will be deleted.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: isSelf ? "Leave" : "Remove",
          style: "destructive",
          onPress: async () => {
            const result = await tryCatch(
              removal.run(member.id, async () => {
                if (isLastMember) {
                  await deleteGroup.mutateAsync({
                    groupId,
                    onlyIfLastMember: true,
                  });
                } else {
                  await submitEpochChange({
                    build: () =>
                      buildRemoveGroupMemberInput({
                        groupId,
                        memberId: member.id,
                        leaving: isSelf,
                      }),
                    submit: (input) =>
                      removeMember.mutateAsync({
                        ...input,
                        ...(successor ? { successorMemberId: successor } : {}),
                      }),
                  });
                }
                if (isSelf) {
                  forgetHiddenMapGroup({ groupId, userId: member.userId });
                  router.dismissTo("/(tabs)/groups/list");
                }
                await queryClient.invalidateQueries({
                  queryKey: trpc.groupMembership.list.queryKey(),
                });
                requestTrackingSync();
              }),
            );
            if (result.error) {
              Alert.alert("Couldn’t update group", userMessage(result.error));
            }
          },
        },
      ],
    );
  };

  const successorDialog = (
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
                accessibilityState={{
                  checked: successorMemberId === member.id,
                }}
                onPress={() => setSuccessorMemberId(member.id)}
                className="flex-row items-center gap-3 rounded-lg p-3"
              >
                <View
                  className={`size-5 rounded-full border-2 ${successorMemberId === member.id ? "border-primary bg-primary" : "border-border"}`}
                />
                <Text>{nameOf(member)}</Text>
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
  );

  return {
    confirmRemoval,
    leave: () => {
      if (self) confirmRemoval(self);
    },
    isPending: removal.isPending,
    successorDialog,
  };
};
