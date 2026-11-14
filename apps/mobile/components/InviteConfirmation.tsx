import { tryCatch } from "@openbeacon/shared";
import { useQuery } from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";
import { Link, router, useNavigation } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, ScrollView, View } from "react-native";
import { Alert } from "../lib/alert.ts";
import { queryClient, trpc, trpcClient } from "../lib/api.ts";
import {
  buildAcceptInviteInput,
  buildAcceptSharedInviteInput,
  submitEpochChange,
} from "../lib/groupEncryption.ts";
import { groupLimitAlert } from "../lib/groupLimitAlert.ts";
import { initials } from "../lib/initials.ts";
import type { InviteToConfirm } from "../lib/inviteTypes.ts";
import { requestTrackingSync } from "../lib/trackingEvents.ts";
import { useSingleFlight } from "../lib/useSingleFlight.ts";
import { Avatar, AvatarFallback, AvatarImage } from "./ui/Avatar.tsx";
import { Button } from "./ui/Button.tsx";
import { Text } from "./ui/Text.tsx";

export const InviteConfirmation = ({
  invite,
  onTryAnotherCode,
}: {
  invite: InviteToConfirm;
  onTryAnotherCode: () => void;
}) => {
  const navigation = useNavigation();
  const [unavailable, setUnavailable] = useState(false);
  const action = useSingleFlight<"join" | "decline">();
  const preview = useQuery({
    queryKey: ["invitePreview", invite],
    queryFn: () =>
      invite.kind === "code"
        ? trpcClient.groupInvites.sharedPreview.mutate({ code: invite.code })
        : trpcClient.groupInvites.preview.query({ inviteId: invite.inviteId }),
    gcTime: 0,
    staleTime: Infinity,
    retry: false,
  });

  const backToGroups = () => router.dismissTo("/(tabs)/groups/list");
  const leaveIfStillHere = () => {
    if (navigation.isFocused()) backToGroups();
  };
  const refreshInvites = () =>
    queryClient.invalidateQueries({ queryKey: trpc.groupInvites.list.queryKey() });

  const join = () =>
    action.run("join", async () => {
      const result = await tryCatch(
        invite.kind === "code"
          ? submitEpochChange({
              build: () => buildAcceptSharedInviteInput({ code: invite.code }),
              submit: (input) => trpcClient.groupInvites.acceptShared.mutate(input),
            })
          : submitEpochChange({
              build: () => buildAcceptInviteInput({ inviteId: invite.inviteId }),
              submit: (input) => trpcClient.groupInvites.accept.mutate(input),
            }),
      );
      const limit = groupLimitAlert(result.error);
      if (limit) {
        Alert.alert(limit.title, limit.message);
        return;
      }
      if (isNotFound(result.error)) {
        setUnavailable(true);
        void refreshInvites();
        return;
      }
      if (result.error) {
        Alert.alert("Unable to join", result.error.message);
        return;
      }
      void queryClient.invalidateQueries({
        predicate: (query) => query.queryKey[0] !== "invitePreview",
      });
      requestTrackingSync();
      leaveIfStillHere();
    });

  const decline = () =>
    action.run("decline", async () => {
      if (invite.kind === "email") {
        const result = await tryCatch(
          trpcClient.groupInvites.decline.mutate({ inviteId: invite.inviteId }),
        );
        if (result.error && !isNotFound(result.error)) {
          Alert.alert("Unable to decline invite", result.error.message);
          return;
        }
        await refreshInvites();
      }
      leaveIfStillHere();
    });

  if (unavailable || isNotFound(preview.error)) {
    return (
      <View className="flex-1">
        <View className="flex-1 items-center justify-center gap-3">
          <View
            aria-hidden
            className="size-28 items-center justify-center rounded-full border-2 border-dashed border-border"
          >
            <Text className="text-4xl text-secondary">?</Text>
          </View>
          <Text role="heading" className="mt-4 text-2xl font-bold">
            Invite unavailable
          </Text>
          <Text className="text-center text-secondary">
            {invite.kind === "code"
              ? "This code is wrong, has expired or was already used. Ask for a new one."
              : "This invite has expired or is no longer available. Ask for a new one."}
          </Text>
        </View>
        <View className="gap-3">
          {invite.kind === "code" ? (
            <Button onPress={onTryAnotherCode}>
              <Text>Try another code</Text>
            </Button>
          ) : null}
          <Button variant="secondary" onPress={backToGroups}>
            <Text>Back to groups</Text>
          </Button>
        </View>
      </View>
    );
  }

  if (preview.isPending) {
    return (
      <View className="flex-1 items-center justify-center gap-4">
        <ActivityIndicator size="large" className="text-primary" />
        <Text className="text-secondary">Checking invite…</Text>
      </View>
    );
  }

  if (preview.isError) {
    return (
      <View className="flex-1">
        <View className="flex-1 items-center justify-center">
          <Text className="text-center text-secondary">
            {!(preview.error instanceof TRPCClientError) || !preview.error.data
              ? "We couldn’t load this invite. Check your connection and try again."
              : preview.error.data.code === "TOO_MANY_REQUESTS"
                ? "Too many attempts. Wait a minute and try again."
                : preview.error.message}
          </Text>
        </View>
        <View className="gap-3">
          <Button onPress={() => preview.refetch()} loading={preview.isFetching}>
            <Text>Try again</Text>
          </Button>
          <Button variant="secondary" onPress={backToGroups}>
            <Text>Back</Text>
          </Button>
        </View>
      </View>
    );
  }

  const { group, inviter, alreadyMember, joinBlockedBy } = preview.data;
  const backButton = (
    <Button variant="secondary" onPress={backToGroups}>
      <Text>Back</Text>
    </Button>
  );

  return (
    <ScrollView className="flex-1" contentContainerClassName="flex-grow">
      <View className="flex-1 items-center justify-center py-6">
        <View className="relative">
          <Avatar alt={`${group.name}'s image`} className="size-28">
            <AvatarImage source={{ uri: group.image ?? "" }} />
            <AvatarFallback>
              <Text className="text-4xl font-bold">{initials(group.name)}</Text>
            </AvatarFallback>
          </Avatar>
          <View className="absolute -bottom-1 -right-1 rounded-full border-4 border-background">
            <Avatar alt={`${inviter.name}'s profile picture`} className="size-11">
              <AvatarImage source={{ uri: inviter.image ?? "" }} />
              <AvatarFallback>
                <Text className="text-sm font-bold">{initials(inviter.name)}</Text>
              </AvatarFallback>
            </Avatar>
          </View>
        </View>
        <View
          accessible
          accessibilityLabel={`${inviter.name} invited you to join ${group.name}`}
          className="mt-6 items-center"
        >
          <Text className="text-center text-secondary">
            <Text className="font-semibold">{inviter.name}</Text> invited you to join
          </Text>
          <Text
            role="heading"
            numberOfLines={3}
            className="mt-1 text-center text-3xl font-extrabold"
          >
            {group.name}
          </Text>
        </View>
        <View className="mt-2 rounded-full bg-secondary px-3 py-1">
          <Text className="text-sm text-secondary-foreground">
            {group.memberCount} {group.memberCount === 1 ? "member" : "members"}
          </Text>
        </View>
        {alreadyMember ? (
          <Text className="mt-8 text-center text-secondary">You’re already in this group.</Text>
        ) : joinBlockedBy ? (
          <Text className="mt-8 text-center text-secondary">
            {joinBlockedBy === "GROUP_LIMIT"
              ? "You’re already in as many groups as your account allows. Leave a group before joining another."
              : "Your account is scheduled for deletion, so it can’t join groups."}
          </Text>
        ) : (
          <>
            <Text className="mt-8 text-center text-lg font-semibold">
              Do you want to join this group?
            </Text>
            <Text className="mt-1 text-center text-sm text-secondary">
              Members will be able to see your location.
            </Text>
          </>
        )}
      </View>
      <View className="gap-3">
        {alreadyMember ? (
          <>
            <Link href={`/groups/${group.id}`} dismissTo asChild>
              <Button>
                <Text>Open group</Text>
              </Button>
            </Link>
            {backButton}
          </>
        ) : joinBlockedBy ? (
          <>
            {backButton}
            {invite.kind === "email" ? (
              <Button variant="outline" onPress={decline} loading={action.pendingKey === "decline"}>
                <Text>Decline invite</Text>
              </Button>
            ) : null}
          </>
        ) : (
          <>
            <Button
              onPress={join}
              loading={action.pendingKey === "join"}
              disabled={action.pendingKey === "decline"}
            >
              <Text>Join Group</Text>
            </Button>
            <Button
              variant="secondary"
              onPress={decline}
              loading={action.pendingKey === "decline"}
              disabled={action.pendingKey === "join"}
            >
              <Text>No</Text>
            </Button>
          </>
        )}
      </View>
    </ScrollView>
  );
};

const isNotFound = (error: unknown) =>
  error instanceof TRPCClientError && error.data?.code === "NOT_FOUND";
