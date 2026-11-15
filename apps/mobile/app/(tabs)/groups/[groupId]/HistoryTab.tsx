import { useIsFocused } from "@react-navigation/native";
import { useInfiniteQuery } from "@tanstack/react-query";
import { LogInIcon, LogOutIcon } from "lucide-react-native";
import { View } from "react-native";
import { LoadingIndicator } from "../../../../components/LoadingIndicator.tsx";
import { Button } from "../../../../components/ui/Button.tsx";
import { Icon } from "../../../../components/ui/Icon.tsx";
import { Text } from "../../../../components/ui/Text.tsx";
import { useMemberNames } from "../../../../hooks/useMemberNames.ts";
import { type RouterInputs, trpcClient } from "../../../../lib/api.ts";
import { authClient } from "../../../../lib/auth-client.ts";
import { groupByDay } from "../../../../lib/places.ts";

const HistoryTab = ({ groupId }: { groupId: string }) => {
  const isFocused = useIsFocused();
  const { data: session } = authClient.useSession();
  const memberName = useMemberNames(groupId);
  const history = useInfiniteQuery({
    queryKey: ["placeTransitions", groupId, session?.user.id],
    initialPageParam: undefined as RouterInputs["placeTransitions"]["recent"]["before"],
    queryFn: ({ pageParam }) =>
      trpcClient.placeTransitions.recent.query({
        groupId,
        ...(pageParam ? { before: pageParam } : {}),
      }),
    getNextPageParam: (page) => page.nextBefore ?? undefined,
    subscribed: isFocused,
  });

  if (history.isPending) {
    return <LoadingIndicator />;
  }

  if (history.isError) {
    return (
      <View className="gap-3 rounded-2xl border border-border bg-card p-5">
        <Text className="text-foreground text-lg font-semibold">Couldn’t load history</Text>
        <Text className="text-muted-foreground">Check your connection and try again.</Text>
        <Button
          size="sm"
          variant="outline"
          className="self-start"
          loading={history.isFetching}
          onPress={() => void history.refetch()}
        >
          <Text>Try again</Text>
        </Button>
      </View>
    );
  }

  const sections = groupByDay({
    items: history.data.pages.flatMap((page) => page.transitions),
    now: new Date(),
  });

  return (
    <View className="gap-2 pt-1">
      {sections.length === 0 ? (
        <Text className="py-6 text-center text-muted-foreground">
          No arrivals or departures yet.
        </Text>
      ) : null}
      {sections.map((section) => (
        <View key={section.key}>
          <Text className="mb-1 mt-3 text-sm font-bold uppercase tracking-wider text-muted-foreground">
            {section.title}
          </Text>
          {section.items.map((transition) => {
            const arrived = transition.direction === "ARRIVE";
            const owner =
              transition.userId === session?.user.id
                ? "Your"
                : `${memberName(transition.userId) ?? "Someone"}’s`;
            const time = transition.occurredAt.toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            });
            return (
              <View
                key={transition.id}
                accessible
                accessibilityLabel={`${owner} ${transition.deviceName} ${arrived ? "arrived at" : "left"} ${transition.placeName}, ${time}`}
                className="flex-row items-center gap-4 border-b border-border py-3"
              >
                <View className="size-12 items-center justify-center rounded-xl bg-primary/10">
                  <Text className="text-2xl">{transition.placeEmoji}</Text>
                </View>
                <View className="flex-1 gap-0.5">
                  <Text className="text-foreground">
                    <Text className="text-foreground font-bold">
                      {owner} {transition.deviceName}
                    </Text>{" "}
                    {arrived ? "arrived at" : "left"} {transition.placeName}
                  </Text>
                  <Text className="text-sm text-muted-foreground">{time}</Text>
                </View>
                <Icon
                  as={arrived ? LogInIcon : LogOutIcon}
                  size={22}
                  className={
                    arrived
                      ? "text-emerald-700 dark:text-emerald-400"
                      : "text-orange-700 dark:text-orange-400"
                  }
                />
              </View>
            );
          })}
        </View>
      ))}
      {history.hasNextPage ? (
        <Button
          size="sm"
          variant="outline"
          className="mt-2 self-center"
          loading={history.isFetchingNextPage}
          onPress={() => void history.fetchNextPage()}
        >
          <Text>Show older</Text>
        </Button>
      ) : null}
      <Text className="mt-3 text-center text-sm text-muted-foreground">
        Arrivals and departures are kept for 14 days.
      </Text>
    </View>
  );
};

export default HistoryTab;
