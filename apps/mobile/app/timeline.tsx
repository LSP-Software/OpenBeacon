import {
  Camera,
  type CameraRef,
  Layer,
  Map as MapLibreMap,
  type MapRef,
  Marker,
} from "@maplibre/maplibre-react-native";
import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  ChevronDownIcon,
  ChevronLeftIcon,
  FastForwardIcon,
  LocateFixedIcon,
  PauseIcon,
  PlayIcon,
  RewindIcon,
  SkipBackIcon,
  SkipForwardIcon,
} from "lucide-react-native";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, BackHandler, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNativeMapStyle } from "../components/map/useNativeMapStyle.ts";
import { TimelineDecryptCard } from "../components/timeline/TimelineDecryptCard.tsx";
import { TimelineMapLayers } from "../components/timeline/TimelineMapLayers.tsx";
import { TimelinePeopleChooser } from "../components/timeline/TimelinePeopleChooser.tsx";
import { TimelinePin } from "../components/timeline/TimelinePin.tsx";
import { TimelineScrubber } from "../components/timeline/TimelineScrubber.tsx";
import { DecryptedAvatarImage } from "../components/image/DecryptedAvatarImage.tsx";
import { Avatar, AvatarFallback } from "../components/ui/Avatar.tsx";
import { Button } from "../components/ui/Button.tsx";
import { Icon } from "../components/ui/Icon.tsx";
import { Text } from "../components/ui/Text.tsx";
import { useCachedGroup } from "../hooks/useCachedGroup.ts";
import { useReducedMotion } from "../hooks/useReducedMotion.ts";
import { useTimelineDay, useTimelineDays } from "../hooks/useTimeline.ts";
import { trpc } from "../lib/api.ts";
import { authClient } from "../lib/auth-client.ts";
import { initialsFromName } from "../lib/buildLiveMapMarkers.ts";
import { historyShareNote } from "../lib/historyShare.ts";
import { cn } from "../lib/cn.ts";
import { GROUP_COLOR_PALETTE, getGroupColor } from "../lib/groupColor.ts";
import { loadPersonalNicknames } from "../lib/personalNicknames.ts";
import { groupPlacesQueryOptions } from "../lib/placeSync.ts";
import { getSymbolVisibility } from "../lib/protomaps-style.ts";
import { pickPersonDevices, timelineDayStats, timelinePositionAt } from "../lib/timeline.ts";
import { pickTimelinePeople } from "../lib/timelineBudget.ts";
import { rememberTimelineGroup } from "../lib/timelineGroup.ts";
import { timelineLaneRuns, timelineRoute } from "../lib/timelineMap.ts";

const SPEEDS = [60, 300, 900] as const;
const STEP_MS = 15 * 60_000;
const DRAW_IN_MS = 1200;
const NO_SENDERS: ReadonlyArray<{ firstHour: number | null; userId: string }> = [];

const TimelineScreen = () => {
  const { groupId, userId } = useLocalSearchParams<{ groupId: string; userId?: string }>();
  const router = useRouter();
  const { data: session } = authClient.useSession();
  const selfUserId = session?.user.id;
  const { group, isPending } = useCachedGroup(groupId);
  const close = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace("/(tabs)/map");
  }, [router]);
  const switchGroup = useCallback(
    (id: string) => router.setParams({ groupId: id, userId: undefined }),
    [router],
  );

  if (isPending || !selfUserId) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator />
      </View>
    );
  }

  if (!group) {
    return (
      <View className="flex-1 items-center justify-center gap-4 bg-background px-8">
        <Text className="text-center text-foreground">
          This group isn’t available on this phone.
        </Text>
        <Button variant="outline" onPress={close}>
          <Text>Go back</Text>
        </Button>
      </View>
    );
  }

  return (
    <TimelineView
      key={group.id}
      group={group}
      initialPersonId={userId ?? null}
      onClose={close}
      onSwitchGroup={switchGroup}
      selfUserId={selfUserId}
    />
  );
};

const TimelineView = ({
  group,
  initialPersonId,
  onClose,
  onSwitchGroup,
  selfUserId,
}: {
  group: {
    id: string;
    members: ReadonlyArray<{ id: string; image: string | null; name: string; userId: string }>;
    name: string;
  };
  initialPersonId: string | null;
  onClose: () => void;
  onSwitchGroup: (groupId: string) => void;
  selfUserId: string;
}) => {
  const insets = useSafeAreaInsets();
  const map = useNativeMapStyle();
  const cameraRef = useRef<CameraRef>(null);
  const mapRef = useRef<MapRef>(null);
  const [viewport, setViewport] = useState<{
    bounds: [number, number, number, number];
    zoom: number;
  } | null>(null);
  const [styleLoaded, setStyleLoaded] = useState(false);
  const [topHeight, setTopHeight] = useState(0);
  const [panelHeight, setPanelHeight] = useState(0);
  const [groupMenuOpen, setGroupMenuOpen] = useState(false);
  const [personId, setPersonId] = useState(initialPersonId);
  const [deviceChoice, setDeviceChoice] = useState<Record<string, string>>({});
  const [pickedDayKey, setPickedDayKey] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(60);
  const [following, setFollowing] = useState(true);
  const [timeState, setTimeState] = useState<{ key: string; time: number } | null>(null);
  const [drawIn, setDrawIn] = useState<{ clock: number; starts: Record<string, number> }>({
    clock: 0,
    starts: {},
  });
  const [chosenPeople, setChosenPeople] = useState<string[] | null>(null);
  const [chooserOpen, setChooserOpen] = useState(false);
  const reduceMotion = useReducedMotion();
  const timeRef = useRef(0);
  const dayStripRef = useRef<ScrollView>(null);

  const { data: groups } = useQuery({
    ...trpc.groupMembership.list.queryOptions(),
    staleTime: Number.POSITIVE_INFINITY,
    select: (items) => items.map((item) => ({ id: item.id, name: item.name })),
  });
  const nicknames = useQuery({
    queryKey: ["personalNicknames", group.id, selfUserId],
    queryFn: () => loadPersonalNicknames(group.id, selfUserId),
  });
  const places = useQuery(groupPlacesQueryOptions(group.id, selfUserId));
  const memberDevices = useQuery(
    trpc.groupMembership.listMemberDevices.queryOptions({ groupId: group.id }),
  );
  const { days, query: daysQuery, windowStart } = useTimelineDays(group.id, personId ?? undefined);
  const day =
    days?.find((item) => item.key === pickedDayKey && item.selectable) ??
    days?.findLast((item) => item.selectable) ??
    null;
  const members = useMemo(
    () =>
      group.members
        .map((member, memberIndex) => {
          const isSelf = member.userId === selfUserId;
          const name = isSelf ? "You" : (nicknames.data?.[member.id]?.name ?? member.name);
          return {
            color:
              GROUP_COLOR_PALETTE[memberIndex % GROUP_COLOR_PALETTE.length] ??
              GROUP_COLOR_PALETTE[0],
            image: member.image,
            initials: initialsFromName(name),
            isSelf,
            name,
            userId: member.userId,
          };
        })
        .sort((first, second) => Number(first.isSelf) - Number(second.isSelf)),
    [group.members, nicknames.data, selfUserId],
  );
  const budget = useMemo(
    () =>
      day && daysQuery.data
        ? pickTimelinePeople({
            chosen: chosenPeople,
            day,
            devices: daysQuery.data.devices,
            memberIds: members.map((member) => member.userId),
            selectedUserId: personId,
          })
        : null,
    [chosenPeople, day, daysQuery.data, members, personId],
  );
  const {
    joinStart,
    progress,
    query: dayQuery,
    timeline,
  } = useTimelineDay({
    day,
    groupId: group.id,
    senders: daysQuery.data?.senders ?? NO_SENDERS,
    userIds: budget?.shown ?? [],
    windowStart,
  });
  const shareNotes = (daysQuery.data?.senders ?? []).flatMap((sender) => {
    if (personId !== null && sender.userId !== personId) return [];
    const member = members.find((item) => item.userId === sender.userId);
    const note = member
      ? historyShareNote(member.isSelf ? null : member.name, sender.historyShare)
      : null;
    return note ? [{ note, userId: sender.userId }] : [];
  });
  const peopleWithLocations = budget?.people.filter((person) => person.points > 0) ?? [];
  const hiddenCount = peopleWithLocations.filter(
    (person) => !budget?.shown.includes(person.userId),
  ).length;
  const memberLook = useCallback(
    (userId: string) =>
      members.find((member) => member.userId === userId) ?? {
        color: GROUP_COLOR_PALETTE[0],
        image: null,
        initials: initialsFromName("Former member"),
        isSelf: false,
        name: "Former member",
        userId,
      },
    [members],
  );

  useEffect(() => {
    rememberTimelineGroup(selfUserId, group.id);
  }, [group.id, selfUserId]);

  const people = useMemo(() => {
    if (!timeline) return [];
    const userIds = [...new Set(timeline.devices.map((device) => device.userId))];
    return userIds
      .flatMap((userId) => {
        const picked = pickPersonDevices(timeline.devices, userId);
        if (!picked) return [];
        const devices = [picked.selected, ...picked.others];
        return [
          {
            ...memberLook(userId),
            device:
              devices.find((device) => device.deviceId === deviceChoice[userId]) ?? picked.selected,
            devices,
          },
        ];
      })
      .sort((first, second) => {
        const firstIndex = members.findIndex((member) => member.userId === first.userId);
        const secondIndex = members.findIndex((member) => member.userId === second.userId);
        return (
          (firstIndex === -1 ? members.length : firstIndex) -
          (secondIndex === -1 ? members.length : secondIndex)
        );
      });
  }, [deviceChoice, memberLook, members, timeline]);
  const shownPeople = useMemo(
    () => (personId ? people.filter((person) => person.userId === personId) : people),
    [people, personId],
  );
  const selectedPerson = personId ? (shownPeople[0] ?? null) : null;
  const selectedName =
    members.find((member) => member.userId === personId)?.name ?? selectedPerson?.name;

  const routes = useMemo(() => {
    const placeList = places.data ?? [];
    return shownPeople.map((person) => {
      const stats = timelineDayStats({ places: placeList, segments: person.device.segments });
      return {
        ...timelineRoute(person.device.segments),
        color: person.color,
        deviceId: person.device.deviceId,
        lanes: timelineLaneRuns(person.device.segments),
        person,
        stats,
        stops: stats.stops.map((stop) => stop.position),
      };
    });
  }, [places.data, shownPeople]);
  const routeIds = routes.map((route) => route.deviceId).join(",");
  const routeKey = `${timeline?.day.key ?? ""}:${routeIds}`;
  const drawn = useMemo(
    () =>
      Object.fromEntries(
        routes.map((route) => [
          route.deviceId,
          Math.min(
            Math.max(
              (drawIn.clock -
                (drawIn.starts[`${timeline?.day.key}:${route.deviceId}`] ?? Infinity)) /
                DRAW_IN_MS,
              0,
            ),
            1,
          ),
        ]),
      ),
    [drawIn, routes, timeline?.day.key],
  );
  const visitedPlaces = useMemo(
    () =>
      (places.data ?? []).filter(
        (place) =>
          place.geometry !== null &&
          routes.some((route) => route.stats.stops.some((stop) => stop.placeId === place.id)),
      ),
    [places.data, routes],
  );

  const showingToday = timeline !== null && timeline.to < timeline.day.end;
  const located = shownPeople.flatMap((person) =>
    person.device.segments.filter((segment) => segment.kind !== "noLocation"),
  );
  const startTime = !timeline
    ? 0
    : showingToday
      ? located.length > 0
        ? Math.max(...located.map((segment) => segment.end))
        : timeline.to
      : Math.min(timeline.to, ...located.map((segment) => segment.start));
  const time = timeline
    ? Math.min(
        Math.max(timeState?.key === timeline.day.key ? timeState.time : startTime, timeline.from),
        timeline.to,
      )
    : 0;
  useLayoutEffect(() => {
    timeRef.current = time;
  });
  const setTime = (value: number) => {
    if (timeline) setTimeState({ key: timeline.day.key, time: value });
  };

  const pins = routes.flatMap((route) => {
    const at = timelinePositionAt(route.person.device.segments, time);
    return at.position ? [{ ...at, route }] : [];
  });
  const selectedPin = selectedPerson ? (pins[0] ?? null) : null;
  const cameraPadding = {
    top: topHeight + 24,
    bottom: panelHeight + 24,
    left: 40,
    right: 40,
  };

  const timelineDayKey = timeline?.day.key;
  const timelineTo = timeline?.to;
  useEffect(() => {
    if (!playing || timelineDayKey === undefined || timelineTo === undefined) return;
    let current = timeRef.current;
    let last = performance.now();
    let rendered = last;
    let frame = 0;
    const tick = (now: number) => {
      current = Math.min(current + (now - last) * speed, timelineTo);
      last = now;
      if (now - rendered >= 33 || current >= timelineTo) {
        rendered = now;
        setTimeState({ key: timelineDayKey, time: current });
      }
      if (current >= timelineTo) {
        setPlaying(false);
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, speed, timelineDayKey, timelineTo]);

  useEffect(() => {
    if (timelineDayKey === undefined || routeIds === "") return;
    const start = performance.now();
    setDrawIn((current) => {
      const starts = Object.fromEntries(
        Object.entries(current.starts).filter(([key]) => key.startsWith(`${timelineDayKey}:`)),
      );
      for (const deviceId of routeIds.split(",")) {
        starts[`${timelineDayKey}:${deviceId}`] ??= reduceMotion ? -Infinity : start;
      }
      return { clock: start, starts };
    });
    if (reduceMotion) return;
    let frame = 0;
    const step = (now: number) => {
      setDrawIn((current) => ({ ...current, clock: now }));
      if (now - start < DRAW_IN_MS) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [reduceMotion, routeIds, timelineDayKey]);

  useEffect(() => {
    if (!groupMenuOpen) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      setGroupMenuOpen(false);
      return true;
    });
    return () => subscription.remove();
  }, [groupMenuOpen]);

  const fitKey = `${routeKey}:${styleLoaded}:${personId ?? ""}:${topHeight > 0 && panelHeight > 0}`;
  // biome-ignore lint/correctness/useExhaustiveDependencies: the camera moves only when the day, people or layout change, not on every frame
  useEffect(() => {
    if (!styleLoaded || topHeight === 0 || panelHeight === 0) return;
    if (selectedPerson) {
      setFollowing(true);
      const at = timelinePositionAt(selectedPerson.device.segments, timeRef.current);
      if (at.position) {
        cameraRef.current?.easeTo({
          center: [at.position.longitude, at.position.latitude],
          duration: 600,
          padding: cameraPadding,
          zoom: 15,
        });
        return;
      }
    }
    const coordinates = routes.flatMap((route) => [
      ...route.line,
      ...route.pauses.flat(),
      ...route.stops.map((stop): [number, number] => [stop.longitude, stop.latitude]),
    ]);
    if (coordinates.length === 0) return;
    const longitudes = coordinates.map(([longitude]) => longitude);
    const latitudes = coordinates.map(([, latitude]) => latitude);
    cameraRef.current?.fitBounds(
      [
        Math.min(...longitudes),
        Math.min(...latitudes),
        Math.max(...longitudes),
        Math.max(...latitudes),
      ],
      { duration: 600, padding: cameraPadding },
    );
  }, [fitKey]);

  const followLongitude = selectedPin?.position.longitude;
  const followLatitude = selectedPin?.position.latitude;
  // biome-ignore lint/correctness/useExhaustiveDependencies: following tracks the pin's position, and padding changes are picked up on the next move
  useEffect(() => {
    if (!following || followLongitude === undefined || followLatitude === undefined) return;
    if (timeState?.key !== timeline?.day.key) return;
    cameraRef.current?.jumpTo({
      center: [followLongitude, followLatitude],
      padding: cameraPadding,
    });
  }, [followLatitude, followLongitude, following]);

  const selectedRoute = selectedPerson ? routes[0] : undefined;
  const selectedSegment = selectedPerson?.device.segments.find(
    (segment) => segment.start <= time && time <= segment.end,
  );
  const selectedStop = selectedRoute?.stats.stops.find(
    (stop) => stop.start <= time && time <= stop.end,
  );
  const placeName = (placeId: string | null) =>
    places.data?.find((place) => place.id === placeId)?.name ?? null;
  const placeStopLabel = (placeId: string) => {
    if (!selectedRoute || !timeline) return null;
    const distance = (stop: { end: number; start: number }) =>
      time < stop.start ? stop.start - time : time > stop.end ? time - stop.end : 0;
    const stop = selectedRoute.stats.stops
      .filter((item) => item.placeId === placeId)
      .reduce<{ end: number; start: number } | null>(
        (closest, item) => (!closest || distance(item) < distance(closest) ? item : closest),
        null,
      );
    if (!stop) return null;
    const fromBefore = stop.start <= timeline.from;
    const toAfter = stop.end >= timeline.to;
    if (fromBefore && toAfter) return null;
    if (fromBefore) return `until ${formatClock(stop.end)}`;
    if (toAfter) return `from ${formatClock(stop.start)}`;
    return `${formatClock(stop.start)}–${formatClock(stop.end)}`;
  };
  const undecryptable = shownPeople.reduce(
    (total, person) => total + person.device.undecryptable,
    0,
  );
  const status = (() => {
    if (!timeline) return null;
    const date = formatDate(timeline.day.start);
    if (!selectedPerson || !selectedSegment) {
      return {
        title: date,
        detail:
          timeline.historyStart > timeline.day.start
            ? `from ${formatClock(timeline.historyStart)}`
            : null,
      };
    }
    switch (selectedSegment.kind) {
      case "moving":
        return { title: "Moving", detail: date };
      case "stay": {
        const stop = selectedStop ?? selectedSegment;
        const name = selectedStop ? placeName(selectedStop.placeId) : null;
        return {
          title: name ? `At ${name}` : "Stopped",
          detail: `${formatClock(stop.start)}–${formatClock(stop.end)}`,
        };
      }
      case "pause":
        return {
          title: "Sharing paused",
          detail: `${selectedPerson.name} paused from ${formatClock(selectedSegment.start)} to ${formatClock(selectedSegment.end)}`,
        };
      case "noLocation":
        return {
          title: "No location",
          detail: `${formatClock(selectedSegment.start)}–${formatClock(selectedSegment.end)}`,
        };
    }
  })();

  const mapStyleJson = useMemo(
    () => (map.mapStyle ? JSON.stringify(map.mapStyle) : null),
    [map.mapStyle],
  );
  const firstCoordinate = routes[0]?.line[0];

  const topOverlay = useMemo(
    () => (
      <View
        className="absolute left-3 right-3 gap-2"
        style={{ top: insets.top + 8 }}
        onLayout={(event) => setTopHeight(event.nativeEvent.layout.height + insets.top + 8)}
      >
        <View className="flex-row items-center gap-2 rounded-2xl border border-border bg-card px-2 py-2 shadow-md shadow-black/15">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back"
            onPress={onClose}
            className="size-10 items-center justify-center rounded-xl bg-background"
          >
            <Icon as={ChevronLeftIcon} size={22} className="text-foreground" />
          </Pressable>
          <Text className="flex-1 text-lg font-bold text-foreground">Timeline</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Group: ${group.name}`}
            accessibilityState={{ expanded: groupMenuOpen }}
            disabled={(groups?.length ?? 0) < 2}
            onPress={() => setGroupMenuOpen((open) => !open)}
            className="max-w-[55%] flex-row items-center gap-2 rounded-full bg-background px-3 py-2"
          >
            <View
              className="size-2.5 rounded-full"
              style={{ backgroundColor: getGroupColor(group.id) }}
            />
            <Text className="shrink font-semibold text-foreground" numberOfLines={1}>
              {group.name}
            </Text>
            {(groups?.length ?? 0) >= 2 ? (
              <Icon as={ChevronDownIcon} size={16} className="text-foreground" />
            ) : null}
          </Pressable>
        </View>
        {groupMenuOpen ? (
          <View className="self-end rounded-2xl border border-border bg-card p-1 shadow-md shadow-black/15">
            {groups?.map((item) => (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                accessibilityState={{ selected: item.id === group.id }}
                onPress={() => {
                  setGroupMenuOpen(false);
                  if (item.id !== group.id) onSwitchGroup(item.id);
                }}
                className="min-h-11 flex-row items-center gap-2 rounded-xl px-3"
              >
                <View
                  className="size-2.5 rounded-full"
                  style={{ backgroundColor: getGroupColor(item.id) }}
                />
                <Text
                  className={cn("text-foreground", item.id === group.id && "font-bold")}
                  numberOfLines={1}
                >
                  {item.name}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        {days ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerClassName="gap-1.5"
            ref={dayStripRef}
            onContentSizeChange={() => dayStripRef.current?.scrollToEnd({ animated: false })}
          >
            {days.map((item) => {
              const isToday = item === days.at(-1);
              const selected = item.key === day?.key;
              const date = new Date(item.start);
              return (
                <Pressable
                  key={item.key}
                  accessibilityRole="button"
                  accessibilityLabel={`${formatDate(item.start)}${isToday ? ", today" : ""}${item.pointCount > 0 ? "" : ", no new locations"}`}
                  accessibilityState={{ disabled: !item.selectable, selected }}
                  disabled={!item.selectable}
                  onPress={() => {
                    setPlaying(false);
                    setDeviceChoice({});
                    setPickedDayKey(item.key);
                  }}
                  className={cn(
                    "w-[52px] items-center rounded-xl border py-1.5",
                    selected ? "border-foreground bg-foreground" : "border-border bg-card",
                    !item.selectable && "opacity-40",
                  )}
                >
                  <Text className={cn("text-[11px]", selected ? "text-background" : "text-muted")}>
                    {isToday ? "Today" : date.toLocaleDateString(undefined, { weekday: "short" })}
                  </Text>
                  <Text
                    className={cn(
                      "text-lg font-semibold",
                      selected ? "text-background" : "text-foreground",
                    )}
                  >
                    {date.getDate()}
                  </Text>
                  <View
                    className={cn(
                      "size-1.5 rounded-full",
                      item.pointCount > 0
                        ? selected
                          ? "bg-background"
                          : "bg-primary"
                        : "bg-transparent",
                    )}
                  />
                </Pressable>
              );
            })}
          </ScrollView>
        ) : null}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerClassName="gap-1.5"
        >
          <PersonChip
            label="Everyone"
            selected={personId === null}
            onPress={() => setPersonId(null)}
          />
          {members.map((member) => (
            <PersonChip
              key={member.userId}
              color={member.color}
              image={member.image}
              initials={member.initials}
              label={member.name}
              notShown={budget !== null && !budget.shown.includes(member.userId)}
              selected={member.userId === personId}
              onPress={() => {
                setPersonId(member.userId);
                setFollowing(true);
              }}
            />
          ))}
        </ScrollView>
      </View>
    ),
    [
      budget,
      day,
      days,
      group,
      groupMenuOpen,
      groups,
      insets.top,
      members,
      onClose,
      onSwitchGroup,
      personId,
    ],
  );
  const lanes = useMemo(
    () =>
      routes.map((route) => ({
        color: route.color,
        historyStart: route.person.device.historyStart,
        id: route.deviceId,
        initials: route.person.initials,
        runs: route.lanes,
      })),
    [routes],
  );

  const nextSpeed = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length] ?? 60;
  const clockLabel = timeline && time >= timeline.day.end ? "24:00" : formatClock(time);

  const scrubTo = (value: number) => {
    setPlaying(false);
    setTime(value);
  };

  return (
    <View className="flex-1 bg-background">
      {mapStyleJson ? (
        <MapLibreMap
          key={map.mapRevision}
          ref={mapRef}
          style={{ flex: 1 }}
          mapStyle={mapStyleJson}
          attribution={false}
          logo={false}
          touchPitch={false}
          touchRotate={false}
          androidView="surface"
          onRegionWillChange={(event) => {
            if (event.nativeEvent.userInteraction) setFollowing(false);
          }}
          onRegionDidChange={(event) => {
            const { bounds, zoom } = event.nativeEvent;
            setViewport({ bounds, zoom });
          }}
          onDidFailLoadingMap={map.onMapLoadFailure}
          onDidFinishLoadingStyle={() => {
            map.onStyleLoaded();
            setStyleLoaded(true);
            void mapRef.current
              ?.getViewState()
              .then(({ bounds, zoom }) => setViewport({ bounds, zoom }));
          }}
        >
          <Camera
            ref={cameraRef}
            initialViewState={{
              center: firstCoordinate ?? [0, 20],
              zoom: firstCoordinate ? 13 : 2,
            }}
          />
          {map.symbolLayerIds.map((id) => (
            <Layer
              key={id}
              id={id}
              type="symbol"
              layout={{ visibility: getSymbolVisibility(map.showSymbols) }}
            />
          ))}
          <TimelineMapLayers drawn={drawn} routes={routes} viewport={viewport} />
          {visitedPlaces.map((place) => {
            if (!place.geometry) return null;
            const stopLabel = placeStopLabel(place.id);
            return (
              <Marker
                key={place.id}
                anchor="bottom"
                lngLat={[place.geometry.longitude, place.geometry.latitude]}
              >
                <View style={{ paddingBottom: 30 }}>
                  <View
                    accessible
                    accessibilityLabel={`Stopped at ${place.name}${stopLabel ? `, ${stopLabel}` : ""}`}
                    className="flex-row items-center gap-1 rounded-full border border-border bg-card px-2.5 py-1 shadow-sm shadow-black/10"
                  >
                    <Text className="text-xs">{place.emoji}</Text>
                    <Text className="text-xs font-semibold text-foreground" numberOfLines={1}>
                      {place.name}
                      {stopLabel ? (
                        <Text className="text-xs font-normal text-muted"> · {stopLabel}</Text>
                      ) : null}
                    </Text>
                  </View>
                </View>
              </Marker>
            );
          })}
          {pins.map((pin) => (
            <TimelinePin
              key={pin.route.deviceId}
              color={pin.route.color}
              id={pin.route.deviceId}
              image={pin.route.person.image}
              initials={pin.route.person.initials}
              latitude={pin.position.latitude}
              longitude={pin.position.longitude}
              name={pin.route.person.name}
              paused={pin.state === "pause"}
            />
          ))}
        </MapLibreMap>
      ) : (
        <View className="flex-1 items-center justify-center gap-4 px-8">
          {map.isError || map.isMapNotReady ? (
            <>
              <Text className="text-center text-muted-foreground">
                {map.isMapNotReady
                  ? "The server is still preparing the map."
                  : "We couldn’t load the map. Check your connection and try again."}
              </Text>
              <Button variant="outline" loading={map.isFetching} onPress={map.retryUrl}>
                <Text>Try again</Text>
              </Button>
            </>
          ) : (
            <ActivityIndicator />
          )}
        </View>
      )}

      {groupMenuOpen ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close group menu"
          className="absolute inset-0"
          onPress={() => setGroupMenuOpen(false)}
        />
      ) : null}

      {topOverlay}

      {selectedPerson && !following && selectedPin ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Follow ${selectedPerson.name}`}
          onPress={() => {
            setFollowing(true);
            cameraRef.current?.easeTo({
              center: [selectedPin.position.longitude, selectedPin.position.latitude],
              duration: 400,
              padding: cameraPadding,
            });
          }}
          className="absolute right-3 size-11 items-center justify-center rounded-full border border-border bg-card shadow-sm shadow-black/10"
          style={{ top: topHeight + 8 }}
        >
          <Icon as={LocateFixedIcon} size={20} className="text-foreground" />
        </Pressable>
      ) : null}

      <TimelineDecryptCard
        loading={day !== null && dayQuery.isPending}
        people={
          progress?.map((person) => {
            const look = memberLook(person.userId);
            return { ...person, color: look.color, name: look.name };
          }) ?? null
        }
        top={topHeight + 40}
      />

      <View
        className="absolute left-3 right-3 rounded-2xl border border-border bg-card px-4 pb-3 pt-3 shadow-md shadow-black/15"
        style={{ bottom: insets.bottom + 8 }}
        onLayout={(event) => setPanelHeight(event.nativeEvent.layout.height + insets.bottom + 8)}
      >
        {daysQuery.isError ? (
          <ProblemNote
            message={`Couldn’t load the Timeline for ${group.name}. Check your connection and try again.`}
            loading={daysQuery.isFetching}
            onRetry={() => void daysQuery.refetch()}
          />
        ) : !days ? (
          <ActivityIndicator className="py-6" />
        ) : !day ? (
          <Text className="py-4 text-center text-muted-foreground">
            {personId
              ? "No location history for this person in this group yet."
              : `No location history in ${group.name} yet.`}
          </Text>
        ) : dayQuery.isError ? (
          <ProblemNote
            message="Couldn’t load this day. Check your connection and try again."
            loading={dayQuery.isFetching}
            onRetry={() => void dayQuery.refetch()}
          />
        ) : !timeline ? (
          <ActivityIndicator className="py-6" />
        ) : (
          <View className="gap-3">
            <View className="flex-row items-center gap-3">
              <Text className="text-3xl font-semibold text-foreground">{clockLabel}</Text>
              <View className="min-w-0 flex-1">
                <Text
                  accessibilityLiveRegion="polite"
                  className="font-semibold text-foreground"
                  numberOfLines={1}
                >
                  {status?.title}
                </Text>
                {status?.detail ? (
                  <Text className="text-sm text-muted" numberOfLines={2}>
                    {status.detail}
                  </Text>
                ) : null}
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Playback speed, ${speed} times. Double tap for ${nextSpeed} times`}
                onPress={() => setSpeed(nextSpeed)}
                className="min-h-11 min-w-14 items-center justify-center rounded-full bg-background px-3"
              >
                <Text className="font-semibold text-foreground">{speed}×</Text>
              </Pressable>
            </View>
            {routes.length > 0 ? (
              <TimelineScrubber
                day={timeline.day}
                from={timeline.from}
                historyStart={timeline.historyStart}
                lanes={lanes}
                step={STEP_MS}
                time={time}
                to={timeline.to}
                valueLabel={status ? `${clockLabel}, ${status.title}` : clockLabel}
                onScrub={scrubTo}
              />
            ) : (
              <Text className="py-2 text-center text-muted-foreground">
                {personId
                  ? `No locations from ${selectedName ?? "this person"} on this day.`
                  : "No locations on this day."}
              </Text>
            )}
            {routes.length > 0 ? (
              <View className="flex-row flex-wrap gap-x-3 gap-y-1">
                <LegendItem kind="moving" label="Moving" color={selectedPerson?.color} />
                <LegendItem kind="stopped" label="Stopped" color={selectedPerson?.color} />
                <LegendItem kind="paused" label="Paused" />
                <LegendItem kind="noLocation" label="No location" />
              </View>
            ) : null}
            {selectedPerson && selectedRoute ? (
              <>
                <View className="flex-row gap-2">
                  <StatCard
                    value={formatDistance(selectedRoute.stats.distanceMeters)}
                    label="travelled"
                  />
                  <StatCard
                    value={String(selectedRoute.stats.stops.length)}
                    label={selectedRoute.stats.stops.length === 1 ? "stop" : "stops"}
                  />
                  <StatCard value={formatDuration(selectedRoute.stats.movingMs)} label="moving" />
                </View>
                {selectedPerson.devices.length > 1 ? (
                  <DeviceSwitch
                    current={selectedPerson.device.deviceId}
                    deviceIds={selectedPerson.devices.map((device) => device.deviceId)}
                    names={memberDevices.data ?? []}
                    onSwitch={(deviceId) =>
                      setDeviceChoice((current) => ({
                        ...current,
                        [selectedPerson.userId]: deviceId,
                      }))
                    }
                  />
                ) : null}
              </>
            ) : null}
            {routes.length > 0 ? (
              <View className="flex-row items-center justify-between px-2">
                <ControlButton
                  icon={SkipBackIcon}
                  label="Start of day"
                  onPress={() => scrubTo(timeline.from)}
                />
                <ControlButton
                  icon={RewindIcon}
                  label="Back 15 minutes"
                  onPress={() => scrubTo(Math.max(time - STEP_MS, timeline.from))}
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={playing ? "Pause" : "Play"}
                  onPress={() => {
                    if (playing) {
                      setPlaying(false);
                      return;
                    }
                    if (time >= timeline.to) setTime(timeline.from);
                    setFollowing(true);
                    setPlaying(true);
                  }}
                  className="size-14 items-center justify-center rounded-full bg-primary"
                >
                  <Icon as={playing ? PauseIcon : PlayIcon} size={24} className="text-white" />
                </Pressable>
                <ControlButton
                  icon={FastForwardIcon}
                  label="Forward 15 minutes"
                  onPress={() => scrubTo(Math.min(time + STEP_MS, timeline.to))}
                />
                <ControlButton
                  icon={SkipForwardIcon}
                  label="End of day"
                  onPress={() => scrubTo(timeline.to)}
                />
              </View>
            ) : null}
            {shareNotes.length > 0 ? (
              <View className="gap-1 rounded-xl bg-background p-3">
                {shareNotes.map((item) => (
                  <Text key={item.userId} className="text-sm text-foreground">
                    {item.note}
                  </Text>
                ))}
              </View>
            ) : null}
            {timeline.historyStart > timeline.day.start ? (
              <View className="rounded-xl bg-background p-3">
                <Text className="text-sm text-foreground">
                  {joinStart !== null && timeline.historyStart === joinStart
                    ? `You joined ${group.name} on ${formatDate(joinStart)} at ${formatClock(joinStart)}. Members see history only from when they joined.`
                    : `History from before ${formatClock(timeline.historyStart)} on this day is no longer kept.`}
                </Text>
              </View>
            ) : null}
            {personId === null && hiddenCount > 0 ? (
              <View className="gap-2 rounded-xl border border-amber-600 dark:border-amber-400 bg-card p-3">
                <Text className="text-sm text-foreground">
                  There are too many locations on this day to show everyone, so Timeline is showing{" "}
                  {peopleWithLocations.length - hiddenCount} of {peopleWithLocations.length} people.
                </Text>
                <Button
                  size="sm"
                  variant="outline"
                  className="self-start"
                  onPress={() => setChooserOpen(true)}
                >
                  <Text>Choose people</Text>
                </Button>
              </View>
            ) : null}
            {undecryptable > 0 ? (
              <Text className="text-xs text-muted">
                {undecryptable === 1
                  ? "1 location couldn’t be decrypted on this phone, so it’s left out."
                  : `${undecryptable.toLocaleString()} locations couldn’t be decrypted on this phone, so they’re left out.`}
              </Text>
            ) : null}
          </View>
        )}
      </View>

      {budget ? (
        <TimelinePeopleChooser
          open={chooserOpen}
          people={peopleWithLocations.map((person) => ({
            ...person,
            color: memberLook(person.userId).color,
            name: memberLook(person.userId).name,
          }))}
          shown={budget.shown}
          onApply={(userIds) => {
            setChooserOpen(false);
            setChosenPeople(userIds);
          }}
          onClose={() => setChooserOpen(false)}
        />
      ) : null}
    </View>
  );
};

const PersonChip = ({
  color,
  image,
  initials,
  label,
  notShown = false,
  onPress,
  selected,
}: {
  color?: string;
  image?: string | null;
  initials?: string;
  label: string;
  notShown?: boolean;
  onPress: () => void;
  selected: boolean;
}) => (
  <Pressable
    accessibilityRole="button"
    accessibilityLabel={notShown ? `${label}, not shown on this day` : label}
    accessibilityState={{ selected }}
    onPress={onPress}
    className={cn(
      "min-h-10 flex-row items-center gap-1.5 rounded-full border py-1 pl-1 pr-3",
      selected ? "border-foreground bg-foreground" : "border-border bg-card",
      !color && "pl-3",
      notShown && "opacity-50",
    )}
  >
    {color && initials ? (
      <View className="rounded-full p-[2px]" style={{ backgroundColor: color }}>
        <Avatar alt={label} className="size-6">
          <DecryptedAvatarImage url={image ?? null} />
          <AvatarFallback style={{ backgroundColor: color }}>
            <Text className="text-[10px] font-bold">{initials}</Text>
          </AvatarFallback>
        </Avatar>
      </View>
    ) : null}
    <Text
      className={cn("font-semibold", selected ? "text-background" : "text-foreground")}
      numberOfLines={1}
    >
      {label}
    </Text>
  </Pressable>
);

const LegendItem = ({
  color,
  kind,
  label,
}: {
  color?: string | undefined;
  kind: "moving" | "noLocation" | "paused" | "stopped";
  label: string;
}) => (
  <View className="flex-row items-center gap-1.5">
    <View className="h-2.5 w-4 justify-center">
      <View
        className={cn(
          "rounded-sm",
          kind === "stopped" ? "h-1.5" : "h-full",
          (kind === "moving" || kind === "stopped") && "bg-foreground",
          kind === "paused" && "border border-dashed border-muted",
          kind === "noLocation" && "bg-muted/40",
        )}
        style={{
          ...(color && (kind === "moving" || kind === "stopped") ? { backgroundColor: color } : {}),
          opacity: kind === "stopped" ? 0.45 : 1,
        }}
      />
    </View>
    <Text className="text-xs text-muted">{label}</Text>
  </View>
);

const StatCard = ({ label, value }: { label: string; value: string }) => (
  <View className="flex-1 rounded-xl bg-background px-3 py-2">
    <Text className="text-lg font-semibold text-foreground">{value}</Text>
    <Text className="text-xs text-muted">{label}</Text>
  </View>
);

const DeviceSwitch = ({
  current,
  deviceIds,
  names,
  onSwitch,
}: {
  current: string;
  deviceIds: readonly string[];
  names: ReadonlyArray<{ deviceId: string; name: string }>;
  onSwitch: (deviceId: string) => void;
}) => {
  const nameOf = (deviceId: string) =>
    names.find((device) => device.deviceId === deviceId)?.name ?? "Another device";
  const next = deviceIds[(deviceIds.indexOf(current) + 1) % deviceIds.length] ?? current;
  return (
    <View className="flex-row items-center justify-between gap-2">
      <Text className="shrink text-sm text-muted" numberOfLines={1}>
        Showing {nameOf(current)}
      </Text>
      <Button size="sm" variant="ghost" onPress={() => onSwitch(next)}>
        <Text numberOfLines={1}>Switch to {nameOf(next)}</Text>
      </Button>
    </View>
  );
};

const ControlButton = ({
  icon,
  label,
  onPress,
}: {
  icon: typeof PlayIcon;
  label: string;
  onPress: () => void;
}) => (
  <Pressable
    accessibilityRole="button"
    accessibilityLabel={label}
    onPress={onPress}
    className="size-11 items-center justify-center rounded-full bg-background"
  >
    <Icon as={icon} size={20} className="text-foreground" />
  </Pressable>
);

const ProblemNote = ({
  loading,
  message,
  onRetry,
}: {
  loading: boolean;
  message: string;
  onRetry: () => void;
}) => (
  <View className="items-center gap-3 py-3">
    <Text className="text-center text-foreground">{message}</Text>
    <Button size="sm" variant="outline" loading={loading} onPress={onRetry}>
      <Text>Try again</Text>
    </Button>
  </View>
);

const formatClock = (time: number) =>
  new Date(time).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

const formatDate = (time: number) =>
  new Date(time).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });

const formatDistance = (meters: number) =>
  meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`;

const formatDuration = (ms: number) => {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} m`;
};

export default TimelineScreen;
