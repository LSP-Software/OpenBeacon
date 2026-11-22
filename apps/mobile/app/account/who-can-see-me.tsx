import { useIsFocused } from "@react-navigation/native";
import { skipToken, useQueries, useQuery } from "@tanstack/react-query";
import { ScrollView, View } from "react-native";
import { ScreenHeader } from "../../components/headers/ScreenHeader.tsx";
import { LoadingIndicator } from "../../components/LoadingIndicator.tsx";
import { LocationSharingCard } from "../../components/LocationSharingCard.tsx";
import { DecryptedAvatarImage } from "../../components/image/DecryptedAvatarImage.tsx";
import { Avatar, AvatarFallback } from "../../components/ui/Avatar.tsx";
import { HistoryIcon } from "lucide-react-native";
import { Button } from "../../components/ui/Button.tsx";
import { ListRow, ListSection } from "../../components/ui/List.tsx";
import { Text } from "../../components/ui/Text.tsx";
import { useHistoryShare } from "../../hooks/useHistoryShare.ts";
import { trpc } from "../../lib/api.ts";
import { groupHistoryShare, historyShareAmount } from "../../lib/historyShare.ts";
import { authClient } from "../../lib/auth-client.ts";
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
}: {
  image: string | null;
  name: string;
  accountName: string | null;
  details: { key: string; text: string }[];
}) => (
  <ListRow
    title={name}
    subtitle={[accountName, ...details.map((detail) => detail.text)].filter(Boolean).join("\n")}
    leading={
      <Avatar alt={`${name}'s profile picture`} className="size-11">
        <DecryptedAvatarImage url={image} />
        <AvatarFallback>
          <Text className="text-sm font-bold">{initials(name)}</Text>
        </AvatarFallback>
      </Avatar>
    }
  />
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
          contentInsetAdjustmentBehavior="automatic"
          contentContainerClassName="gap-6 px-4 pb-10 pt-2"
          showsVerticalScrollIndicator={false}
        >
          <LocationSharingCard />

          <ListSection
            title="Can see you now"
            footer="Everyone in a group with you can see where you are while you’re sharing. They can also replay where you’ve been, as far back as you chose for that group (shown above, at most 14 days), but only from when they joined that group, and see roughly when you paused and resumed sharing. While you’ve paused, they can see that you’ve paused, but not where you are."
          >
            {viewers.data.current.length === 0 ? (
              <ListRow title="No one. You’re not in a group with anyone else." />
            ) : (
              viewers.data.current.map((viewer) => (
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
                />
              ))
            )}
          </ListSection>
          <ListSection>
            <ListRow
              title="Choose how much history to share"
              icon={HistoryIcon}
              iconColor="indigo"
              href="/account/location-history"
            />
          </ListSection>

          <ListSection
            title="Could see you recently"
            footer={`People who stopped being in a group with you since ${formatViewerDate(viewers.data.since)}. They can’t see where you go now, but they may have kept what they saw before.`}
          >
            {viewers.data.past.length === 0 ? (
              <ListRow title="No one." />
            ) : (
              viewers.data.past.map((viewer) => {
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
                  />
                );
              })
            )}
          </ListSection>
        </ScrollView>
      )}
    </View>
  );
};

export default WhoCanSeeMeScreen;
