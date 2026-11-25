import { useIsFocused } from "@react-navigation/native";
import { useInfiniteQuery } from "@tanstack/react-query";
import {
  CarIcon,
  CircleCheckIcon,
  ClockIcon,
  GaugeIcon,
  ImageIcon,
  LogInIcon,
  LogOutIcon,
  MapPinMinusIcon,
  MapPinPenIcon,
  MapPinPlusIcon,
  PencilIcon,
  RefreshCwIcon,
  RouteIcon,
  ShieldIcon,
  SirenIcon,
  SparklesIcon,
  UserMinusIcon,
  UserPlusIcon,
  UserXIcon,
} from "lucide-react-native";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { LoadingIndicator } from "../LoadingIndicator.tsx";
import { cn } from "../../lib/cn.ts";
import { groupedListClassName, groupedRowClassName, groupedRowStyle } from "./groupedRows.ts";
import { Button } from "../ui/Button.tsx";
import { Icon } from "../ui/Icon.tsx";
import { Text } from "../ui/Text.tsx";
import { useGroupDrives } from "../../hooks/useGroupDrives.ts";
import { useMemberNameList } from "../../hooks/useMemberNames.ts";
import { useUnits } from "../../hooks/useUnits.ts";
import { type RouterInputs, trpcClient } from "../../lib/api.ts";
import { authClient } from "../../lib/auth-client.ts";
import { describeGroupEvent, groupByDay, markGroupHistorySeen } from "../../lib/groupHistory.ts";
import { crashHistoryItems } from "../../lib/crashAlertInbox.ts";
import { crashWords, useGroupCrashAlerts } from "../../lib/crashAlertSync.ts";
import { driveHistoryItems } from "../../lib/driveHistory.ts";
import { ownedDeviceName } from "../../lib/ownedDeviceName.ts";

const HOUR_MS = 3_600_000;
const chipIcons = [RouteIcon, ClockIcon, GaugeIcon];

const eventIcons = {
  GROUP_CREATED: SparklesIcon,
  MEMBER_JOINED: UserPlusIcon,
  MEMBER_LEFT: UserMinusIcon,
  MEMBER_REMOVED: UserMinusIcon,
  ACCOUNT_DELETED: UserXIcon,
  ROLE_CHANGED: ShieldIcon,
  LOCATION_UPDATE_REQUESTED: RefreshCwIcon,
  GROUP_RENAMED: PencilIcon,
  GROUP_IMAGE_CHANGED: ImageIcon,
  PLACE_ADDED: MapPinPlusIcon,
  PLACE_UPDATED: MapPinPenIcon,
  PLACE_DELETED: MapPinMinusIcon,
} as const;

const filters = [
  { label: "All", category: null, empty: "Nothing has happened in the last 14 days." },
  {
    label: "Arrivals",
    category: "arrivals",
    empty: "No arrivals or departures in the last 14 days.",
  },
  { label: "Members", category: "members", empty: "No member changes in the last 14 days." },
  { label: "Roles", category: "roles", empty: "No role changes in the last 14 days." },
  { label: "Group", category: "group", empty: "No group changes in the last 14 days." },
  { label: "Places", category: "places", empty: "No place changes in the last 14 days." },
] as const;

const HistoryTab = ({
  active,
  groupId,
  latestAt,
}: {
  active: boolean;
  groupId: string;
  latestAt: Date | null;
}) => {
  const isFocused = useIsFocused();
  const { data: session } = authClient.useSession();
  const userId = session?.user.id;
  const memberNames = useMemberNameList(groupId);
  const memberName = (memberUserId: string) => memberNames(memberUserId)[0] ?? null;
  const [category, setCategory] = useState<(typeof filters)[number]["category"]>(null);
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
    subscribed: isFocused,
  });

  const router = useRouter();
  const units = useUnits();
  const [driveWindowStart] = useState(
    () => new Date(Math.floor((Date.now() - 14 * 24 * HOUR_MS) / HOUR_MS) * HOUR_MS),
  );
  const groupDrives = useGroupDrives(groupId, category === null ? driveWindowStart : null);

  const crashAlerts = useGroupCrashAlerts({
    enabled: category === null && isFocused,
    groupId,
    userId,
  });

  const loadedItems = history.data?.pages.flatMap((page) => page.items) ?? [];
  const loadedLatestAt =
    loadedItems.find(
      (item) => item.kind === "group" && (item.actor?.userId ?? item.subject?.userId) !== userId,
    )?.at ?? null;
  const newestLoadedAt = loadedItems[0]?.at ?? null;
  const displayedLatestAt =
    category === null
      ? latestAt &&
        newestLoadedAt &&
        latestAt <= newestLoadedAt &&
        (!loadedLatestAt || latestAt > loadedLatestAt)
        ? latestAt
        : loadedLatestAt
      : null;

  useEffect(() => {
    if (!active || !isFocused || !history.isSuccess || history.isFetching || !userId) return;
    markGroupHistorySeen({ groupId, latestAt: displayedLatestAt, userId });
  }, [
    active,
    displayedLatestAt,
    groupId,
    history.isFetching,
    history.isSuccess,
    isFocused,
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
            className={`min-h-9 justify-center rounded-full border px-4 py-1.5 ${selected ? "border-foreground bg-foreground" : "border-border-strong bg-transparent"}`}
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
        <View className="gap-3 rounded-3xl bg-card p-5">
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

  const serverItems = history.data.pages
    .flatMap((page) => page.items)
    .filter((item) => item.kind !== "group" || Object.hasOwn(eventIcons, item.type));
  const oldestShown = history.hasNextPage ? serverItems.at(-1)?.at.getTime() : undefined;
  const crashItems =
    category === null
      ? crashHistoryItems(
          crashAlerts,
          crashWords((personId) => memberName(personId) ?? "Someone"),
          (personId, deviceName) =>
            ownedDeviceName({
              deviceName,
              ownerNames: memberNames(personId),
              isYou: personId === userId,
            }),
        ).filter((item) => oldestShown === undefined || item.at.getTime() >= oldestShown)
      : [];
  const driveItems =
    category === null
      ? driveHistoryItems({
          drives: groupDrives.query.data?.drives ?? [],
          nameOf: (personId) => memberName(personId) ?? "Someone",
          units,
        }).filter((item) => oldestShown === undefined || item.at.getTime() >= oldestShown)
      : [];
  const sections = groupByDay({
    items: [...serverItems, ...crashItems, ...driveItems].sort(
      (a, b) => b.at.getTime() - a.at.getTime(),
    ),
    now: new Date(),
  });

  return (
    <View className="gap-2 pt-1">
      {filterBar}
      {history.isError ? (
        <View className="flex-row items-center justify-between gap-3 rounded-3xl bg-card px-4 py-2">
          <Text className="flex-1 text-sm text-foreground">
            Couldn’t reach the server, so this may be out of date.
          </Text>
          <Button
            size="sm"
            variant="secondary"
            loading={history.isFetching}
            onPress={() => void history.refetch()}
          >
            <Text>Try again</Text>
          </Button>
        </View>
      ) : null}
      {sections.length === 0 ? (
        <Text className="py-6 text-center text-tertiary">
          {filters.find((filter) => filter.category === category)?.empty}
        </Text>
      ) : null}
      {sections.map((section) => {
        const items = section.items.filter(
          (item) =>
            item.kind !== "group" ||
            Boolean(describeGroupEvent({ event: item, memberName, userId })),
        );
        return (
          <View key={section.key} className="gap-2">
            <Text accessibilityRole="header" variant="label" className="mt-3 px-4">
              {section.title}
            </Text>
            <View className={groupedListClassName}>
              {items.map((item, index) => {
                const time = item.at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
                if (item.kind === "drive") {
                  return (
                    <Pressable
                      key={item.id}
                      accessibilityRole="link"
                      accessibilityLabel={`${[item.title, ...item.chips, item.note ?? ""].filter(Boolean).join(", ")}, ${time}`}
                      accessibilityHint="Opens this drive in Timeline"
                      onPress={() =>
                        router.push({
                          pathname: "/timeline",
                          params: { groupId, driveId: item.driveId },
                        })
                      }
                      className={cn(
                        "flex-row items-start gap-4 px-4 py-3",
                        groupedRowClassName(index),
                      )}
                      style={groupedRowStyle(index, items.length)}
                    >
                      <View
                        className="size-11 items-center justify-center rounded-full"
                        style={{ backgroundColor: "#7A1240" }}
                      >
                        <Icon as={CarIcon} size={22} className="text-white" />
                      </View>
                      <View className="flex-1 gap-1">
                        <Text className="text-foreground">{item.title}</Text>
                        {item.chips.length > 0 ? (
                          <View className="flex-row flex-wrap gap-1">
                            {item.chips.map((chip, chipIndex) => (
                              <View
                                key={chip}
                                className="flex-row items-center gap-1 rounded-lg px-1.5 py-0.5"
                                style={{ backgroundColor: "#F4DDE6" }}
                              >
                                {chipIcons[chipIndex] ? (
                                  <Icon as={chipIcons[chipIndex]} size={13} color="#7A1240" />
                                ) : null}
                                <Text
                                  className="text-sm font-semibold"
                                  style={{ color: "#7A1240" }}
                                >
                                  {chip}
                                </Text>
                              </View>
                            ))}
                          </View>
                        ) : null}
                        {item.note ? (
                          <Text className="text-sm text-secondary">{item.note}</Text>
                        ) : null}
                        <Text className="text-sm text-tertiary">{time}</Text>
                      </View>
                    </Pressable>
                  );
                }
                if (item.kind === "crash") {
                  return (
                    <View
                      key={item.id}
                      accessible
                      accessibilityLabel={`${item.text}, ${time}`}
                      className={cn(
                        "flex-row items-center gap-4 px-4 py-3",
                        groupedRowClassName(index),
                      )}
                      style={groupedRowStyle(index, items.length)}
                    >
                      <View
                        className="size-11 items-center justify-center rounded-full"
                        style={{ backgroundColor: item.ok ? "#1E6B3A" : "#B3261E" }}
                      >
                        <Icon
                          as={item.ok ? CircleCheckIcon : SirenIcon}
                          size={22}
                          className="text-white"
                        />
                      </View>
                      <View className="flex-1 gap-0.5">
                        <Text className="text-foreground">{item.text}</Text>
                        <Text className="text-sm text-tertiary">{time}</Text>
                      </View>
                    </View>
                  );
                }
                if (item.kind === "group") {
                  const text = describeGroupEvent({ event: item, memberName, userId });
                  if (!text) return null;
                  return (
                    <View
                      key={item.id}
                      accessible
                      accessibilityLabel={`${text}, ${time}`}
                      className={cn(
                        "flex-row items-center gap-4 px-4 py-3",
                        groupedRowClassName(index),
                      )}
                      style={groupedRowStyle(index, items.length)}
                    >
                      <View className="size-11 items-center justify-center rounded-full bg-container">
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
                const device = ownedDeviceName({
                  deviceName: item.deviceName,
                  ownerNames: memberNames(item.userId),
                  isYou: item.userId === userId,
                });
                return (
                  <View
                    key={item.id}
                    accessible
                    accessibilityLabel={`${device} ${arrived ? "arrived at" : "left"} ${item.placeName}, ${time}`}
                    className={cn(
                      "flex-row items-center gap-4 px-4 py-3",
                      groupedRowClassName(index),
                    )}
                    style={groupedRowStyle(index, items.length)}
                  >
                    <View className="size-11 items-center justify-center rounded-full bg-container">
                      <Text className="text-2xl">{item.placeEmoji}</Text>
                    </View>
                    <View className="flex-1 gap-0.5">
                      <Text className="text-foreground">
                        <Text className="text-foreground font-semibold">{device}</Text>{" "}
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
          </View>
        );
      })}
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
      <Text className="mt-3 text-center text-sm text-tertiary">History is kept for 14 days.</Text>
    </View>
  );
};

export default HistoryTab;
