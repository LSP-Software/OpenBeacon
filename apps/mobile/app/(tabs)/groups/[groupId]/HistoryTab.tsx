import { useIsFocused } from "@react-navigation/native";
import { useInfiniteQuery } from "@tanstack/react-query";
import {
  CrownIcon,
  ImageIcon,
  LogInIcon,
  LogOutIcon,
  MapPinMinusIcon,
  MapPinPenIcon,
  MapPinPlusIcon,
  PencilIcon,
  ShieldIcon,
  SparklesIcon,
  UserMinusIcon,
  UserPlusIcon,
  UserXIcon,
} from "lucide-react-native";
import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { LoadingIndicator } from "../../../../components/LoadingIndicator.tsx";
import { Button } from "../../../../components/ui/Button.tsx";
import { Icon } from "../../../../components/ui/Icon.tsx";
import { Text } from "../../../../components/ui/Text.tsx";
import { useCachedGroup } from "../../../../hooks/useCachedGroup.ts";
import { useMemberNames } from "../../../../hooks/useMemberNames.ts";
import { type RouterInputs, trpcClient } from "../../../../lib/api.ts";
import { authClient } from "../../../../lib/auth-client.ts";
import { errorReason } from "../../../../lib/errorReason.ts";
import {
  describeGroupEvent,
  groupByDay,
  markGroupHistorySeen,
} from "../../../../lib/groupHistory.ts";

const eventIcons = {
  GROUP_CREATED: SparklesIcon,
  MEMBER_JOINED: UserPlusIcon,
  MEMBER_LEFT: UserMinusIcon,
  MEMBER_REMOVED: UserMinusIcon,
  ACCOUNT_DELETED: UserXIcon,
  ROLE_CHANGED: ShieldIcon,
  OWNER_CHANGED: CrownIcon,
  GROUP_RENAMED: PencilIcon,
  GROUP_IMAGE_CHANGED: ImageIcon,
  PLACE_ADDED: MapPinPlusIcon,
  PLACE_UPDATED: MapPinPenIcon,
  PLACE_DELETED: MapPinMinusIcon,
} as const;

const filters = [
  { label: "All", category: null, empty: "Nothing has happened" },
  {
    label: "Arrivals",
    category: "arrivals",
    empty: "No arrivals or departures",
  },
  { label: "Members", category: "members", empty: "No member changes" },
  { label: "Roles", category: "roles", empty: "No role changes" },
  { label: "Group", category: "group", empty: "No group changes" },
  { label: "Places", category: "places", empty: "No place changes" },
] as const;

const HistoryTab = ({ groupId, active }: { groupId: string; active: boolean }) => {
  const isFocused = useIsFocused();
  const { data: session } = authClient.useSession();
  const userId = session?.user.id;
  const memberName = useMemberNames(groupId);
  const [category, setCategory] = useState<(typeof filters)[number]["category"]>(null);
  const { group } = useCachedGroup(groupId);
  const history = useInfiniteQuery({
    queryKey: ["groupHistory", groupId, userId, category],
    initialPageParam: null,
    queryFn: ({
      pageParam,
    }: {
      pageParam: RouterInputs["groupHistory"]["list"]["before"] | null;
    }) =>
      trpcClient.groupHistory.list.query({
        groupId,
        ...(pageParam ? { before: pageParam } : {}),
        ...(category ? { categories: [category] } : {}),
      }),
    getNextPageParam: (page) => page.nextBefore,
    enabled: group?.onHold !== true,
    subscribed: isFocused,
  });
  const onHold = group?.onHold === true || errorReason(history.error) === "SEAT_ON_HOLD";

  const displayedLatestAt =
    category === null
      ? (history.data?.pages
          .flatMap((page) => page.items)
          .find(
            (item) =>
              item.kind === "group" && (item.actor?.userId ?? item.subject?.userId) !== userId,
          )?.at ?? null)
      : null;

  useEffect(() => {
    if (onHold || !active || !isFocused || !history.isSuccess || history.isFetching || !userId) {
      return;
    }
    markGroupHistorySeen({ groupId, latestAt: displayedLatestAt, userId });
  }, [
    active,
    displayedLatestAt,
    groupId,
    history.isFetching,
    history.isSuccess,
    isFocused,
    onHold,
    userId,
  ]);

  const filterBar = (
    <View
      accessibilityRole="tablist"
      accessibilityLabel="Filter history"
      className="flex-row flex-wrap gap-2 pb-1"
    >
      {filters.map((filter) => {
        const selected = filter.category === category;
        return (
          <Pressable
            key={filter.label}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => setCategory(filter.category)}
            hitSlop={{ top: 4, bottom: 4 }}
            className={`min-h-9 justify-center rounded-full border px-4 py-1.5 ${selected ? "border-foreground bg-foreground" : "border-border bg-card"}`}
          >
            <Text
              className={`text-sm font-semibold ${selected ? "text-background" : "text-foreground"}`}
            >
              {filter.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );

  if (onHold) {
    return (
      <View className="gap-1 rounded-2xl border border-border bg-card p-5 mt-1">
        <Text className="text-foreground text-lg font-semibold">History is on hold</Text>
        <Text className="text-secondary">
          This phone can’t see this group’s history while it’s on hold.
        </Text>
      </View>
    );
  }

  if (history.isPending) {
    return (
      <View className="gap-2 pt-1">
        {filterBar}
        <LoadingIndicator />
      </View>
    );
  }

  if (history.isError && !history.data) {
    return (
      <View className="gap-2 pt-1">
        {filterBar}
        <View className="gap-3 rounded-2xl border border-border bg-card p-5">
          <Text className="text-foreground text-lg font-semibold">Couldn’t load history</Text>
          <Text className="text-secondary">Check your connection and try again.</Text>
          <Button
            size="sm"
            variant="secondary"
            className="self-start"
            loading={history.isFetching}
            onPress={() => void history.refetch()}
          >
            <Text>Try again</Text>
          </Button>
        </View>
      </View>
    );
  }

  const sections = groupByDay({
    items: history.data.pages.flatMap((page) => page.items),
    now: new Date(),
  });
  const historyDays = history.data.pages[0]?.historyDays;

  return (
    <View className="gap-2 pt-1">
      {filterBar}
      {history.isError ? (
        <View className="flex-row items-center justify-between gap-3 rounded-2xl border border-border bg-card px-4 py-2">
          <Text className="flex-1 text-sm text-foreground">
            Couldn’t reach the server, so this may be out of date.
          </Text>
          <Button
            size="sm"
            variant="secondary"
            loading={history.isFetching}
            onPress={() => void history.refetch()}
          >
            <Text>Retry</Text>
          </Button>
        </View>
      ) : null}
      {sections.length === 0 ? (
        <Text className="py-6 text-center text-tertiary">
          {filters.find((filter) => filter.category === category)?.empty}
          {historyDays ? ` in the last ${historyDays} days` : ""}.
        </Text>
      ) : null}
      {sections.map((section) => (
        <View key={section.key}>
          <Text accessibilityRole="header" variant="label" className="mb-1 mt-3">
            {section.title}
          </Text>
          {section.items.map((item) => {
            const time = item.at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
            if (item.kind === "group") {
              const text = describeGroupEvent({ event: item, memberName, userId });
              return (
                <View
                  key={item.id}
                  accessible
                  accessibilityLabel={`${text}, ${time}`}
                  className="flex-row items-center gap-4 border-b border-border/60 px-1 py-3"
                >
                  <View className="size-12 items-center justify-center rounded-xl bg-secondary">
                    <Icon as={eventIcons[item.type]} size={22} className="text-primary-text" />
                  </View>
                  <View className="flex-1 gap-0.5">
                    <Text className="text-foreground">{text}</Text>
                    <Text className="text-sm text-tertiary">{time}</Text>
                  </View>
                </View>
              );
            }
            const arrived = item.direction === "ARRIVE";
            const owner =
              item.userId === userId ? "Your" : `${memberName(item.userId) ?? "Someone"}’s`;
            return (
              <View
                key={item.id}
                accessible
                accessibilityLabel={`${owner} ${item.deviceName} ${arrived ? "arrived at" : "left"} ${item.placeName}, ${time}`}
                className="flex-row items-center gap-4 border-b border-border/60 px-1 py-3"
              >
                <View className="size-12 items-center justify-center rounded-xl bg-secondary">
                  <Text className="text-2xl">{item.placeEmoji}</Text>
                </View>
                <View className="flex-1 gap-0.5">
                  <Text className="text-foreground">
                    <Text className="text-foreground font-semibold">
                      {owner} {item.deviceName}
                    </Text>{" "}
                    {arrived ? "arrived at" : "left"} {item.placeName}
                  </Text>
                  <Text className="text-sm text-tertiary">{time}</Text>
                </View>
                <Icon
                  as={arrived ? LogInIcon : LogOutIcon}
                  size={22}
                  className={arrived ? "text-success" : "text-warning-text"}
                />
              </View>
            );
          })}
        </View>
      ))}
      {history.hasNextPage ? (
        <Button
          size="sm"
          variant="secondary"
          className="mt-2 self-center"
          loading={history.isFetchingNextPage}
          onPress={() => void history.fetchNextPage()}
        >
          <Text>Show older</Text>
        </Button>
      ) : null}
      {historyDays ? (
        <Text className="mt-3 text-center text-sm text-tertiary">
          History is kept for {historyDays} days.
        </Text>
      ) : null}
    </View>
  );
};

export default HistoryTab;
