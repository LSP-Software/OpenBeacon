import { useIsFocused } from "@react-navigation/native";
import { skipToken, useQueries, useQuery } from "@tanstack/react-query";
import { Link } from "expo-router";
import { ScrollView, View } from "react-native";
import { ScreenHeader } from "../../components/headers/ScreenHeader.tsx";
import { LoadingIndicator } from "../../components/LoadingIndicator.tsx";
import { LocationSharingCard } from "../../components/LocationSharingCard.tsx";
import { DecryptedAvatarImage } from "../../components/image/DecryptedAvatarImage.tsx";
import { Avatar, AvatarFallback } from "../../components/ui/Avatar.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Text } from "../../components/ui/Text.tsx";
import { useHistoryShare } from "../../hooks/useHistoryShare.ts";
import { trpc } from "../../lib/api.ts";
import { groupHistoryShare, historyShareAmount } from "../../lib/historyShare.ts";
import { authClient } from "../../lib/auth-client.ts";
import { cn } from "../../lib/cn.ts";
import { initials } from "../../lib/initials.ts";
import { loadPersonalNicknames } from "../../lib/personalNicknames.ts";
import { viewerName } from "../../lib/viewerNames.ts";
import { formatViewerDate, formatViewerStretch } from "../../lib/viewerStretch.ts";

const endedReason = {
  theyLeft: "They left the group",
  theyWereRemoved: "They were removed from the group",
  youLeft: "You left the group",
  youWereRemoved: "You were removed from the group",
} as const;

const Person = ({
  image,
  name,
  accountName,
  details,
  last,
}: {
  image: string | null;
  name: string;
  accountName: string | null;
  details: { key: string; text: string }[];
  last: boolean;
}) => (
  <View
    accessible
    className={cn("flex-row items-center gap-4 px-5 py-4", !last && "border-b border-border/50")}
  >
    <Avatar alt={`${name}'s profile picture`} className="size-11">
      <DecryptedAvatarImage url={image} />
      <AvatarFallback>
        <Text className="text-sm font-bold">{initials(name)}</Text>
      </AvatarFallback>
    </Avatar>
    <View className="flex-1 gap-1">
      <Text className="text-foreground text-base font-medium">{name}</Text>
      {accountName && <Text className="text-tertiary text-sm">{accountName}</Text>}
      {details.map((detail) => (
        <Text key={detail.key} className="text-tertiary text-sm">
          {detail.text}
        </Text>
      ))}
    </View>
  </View>
);

const WhoCanSeeMeScreen = () => {
  const isFocused = useIsFocused();
  const viewers = useQuery({ ...trpc.account.viewers.queryOptions(), subscribed: isFocused });
  const { data: session } = authClient.useSession();
  const userId = session?.user.id;
  const groups = useQuery({ ...trpc.groupMembership.list.queryOptions(), subscribed: isFocused });
  const historyShare = useHistoryShare(isFocused);
  const nicknameQueries = useQueries({
    queries: (groups.data ?? []).map((group) => ({
      queryKey: ["personalNicknames", group.id, userId],
      queryFn: userId ? () => loadPersonalNicknames(group.id, userId) : skipToken,
      subscribed: isFocused,
    })),
  });
  const nicknames = Object.fromEntries(
    (groups.data ?? []).map((group, index) => [group.id, nicknameQueries[index]?.data]),
  );
  const nameFor = (viewer: { userId: string; name: string }, groupIds: string[]) =>
    viewerName({
      accountName: viewer.name,
      groupIds,
      groups: groups.data ?? [],
      nicknames,
      userId: viewer.userId,
    });

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title="Who can see me" />

      {viewers.isPending ? (
        <LoadingIndicator />
      ) : viewers.isError && !viewers.data ? (
        <View className="flex-1 items-center justify-center gap-4 px-6">
          <Text className="text-tertiary text-center">
            We couldn’t load who can see you. Check your connection and try again.
          </Text>
          <Button variant="secondary" onPress={() => viewers.refetch()}>
            <Text>Try again</Text>
          </Button>
        </View>
      ) : (
        <ScrollView
          className="flex-1"
          contentContainerClassName="gap-6 px-4 pb-32 pt-2"
          showsVerticalScrollIndicator={false}
        >
          <LocationSharingCard />

          <Text accessibilityRole="header" className="text-foreground text-lg font-semibold">
            Can see you now
          </Text>
          <Text className="text-secondary text-base">
            Everyone in a group with you can see where you are while you’re sharing. They can also
            replay where you’ve been, as far back as you chose for that group (shown below, at most
            30 days), but only from when they joined that group, and see roughly when you paused and
            resumed sharing. While you’ve paused, they can see that you’ve paused, but not where you
            are.
          </Text>
          <Link href="/account/location-history" asChild>
            <Button variant="secondary" className="self-start">
              <Text>Choose how much history to share</Text>
            </Button>
          </Link>
          {viewers.data.current.length === 0 ? (
            <Text className="text-tertiary text-base">
              No one. You’re not in a group with anyone else.
            </Text>
          ) : (
            <View className="overflow-hidden rounded-2xl border border-border bg-card">
              {viewers.data.current.map((viewer, index) => (
                <Person
                  key={viewer.userId}
                  image={viewer.image}
                  {...nameFor(
                    viewer,
                    viewer.groups.map((group) => group.id),
                  )}
                  details={viewer.groups.map((group) => ({
                    key: group.id,
                    text: [
                      group.name,
                      `since ${formatViewerDate(group.since)}`,
                      ...(historyShare.setting
                        ? [
                            historyShareAmount(
                              groupHistoryShare(historyShare.setting, group.id).share,
                            ),
                          ]
                        : []),
                    ].join(" · "),
                  }))}
                  last={index === viewers.data.current.length - 1}
                />
              ))}
            </View>
          )}

          <Text accessibilityRole="header" className="text-foreground text-lg font-semibold">
            Could see you recently
          </Text>
          <Text className="text-secondary text-base">
            People who stopped being in a group with you since{" "}
            {formatViewerDate(viewers.data.since)}. They can’t see where you go now, but they may
            have kept what they saw before.
          </Text>
          {viewers.data.past.length === 0 ? (
            <Text className="text-tertiary text-base">No one.</Text>
          ) : (
            <View className="overflow-hidden rounded-2xl border border-border bg-card">
              {viewers.data.past.map((viewer, index) => {
                const stillSharing = viewers.data.current.find(
                  (person) => person.userId === viewer.userId,
                );
                return (
                  <Person
                    key={`${viewer.groupId}-${viewer.userId}-${viewer.to.getTime()}`}
                    image={viewer.image}
                    {...nameFor(viewer, [
                      viewer.groupId,
                      ...(stillSharing?.groups.map((group) => group.id) ?? []),
                    ])}
                    details={[
                      {
                        key: "stretch",
                        text: `${viewer.groupName} · ${formatViewerStretch(viewer)}`,
                      },
                      { key: "reason", text: endedReason[viewer.reason] },
                      ...(stillSharing
                        ? [
                            {
                              key: "stillSharing",
                              text: `Can still see you in ${stillSharing.groups.map((group) => group.name).join(", ")}`,
                            },
                          ]
                        : []),
                    ]}
                    last={index === viewers.data.past.length - 1}
                  />
                );
              })}
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
};

export default WhoCanSeeMeScreen;
