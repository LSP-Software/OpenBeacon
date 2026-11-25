import {
  Camera,
  type CameraRef,
  Map as MapLibreMap,
  type MapRef,
} from "@maplibre/maplibre-react-native";
import type { DriveRecord } from "@openbeacon/encryption";
import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  BellOffIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  FastForwardIcon,
  LocateFixedIcon,
  PauseIcon,
  PlayIcon,
  RewindIcon,
  SkipBackIcon,
  SirenIcon,
  SkipForwardIcon,
} from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  BackHandler,
  Pressable,
  ScrollView,
  useWindowDimensions,
  View,
} from "react-native";
import Animated from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MapStyleLayers } from "../components/map/MapStyleLayers.tsx";
import { DriveSheet } from "../components/timeline/DriveSheet.tsx";
import { DeviceSwitch } from "../components/timeline/DeviceSwitch.tsx";
import { DriveInfoBox } from "../components/timeline/DrivesList.tsx";
import { ProblemNote } from "../components/timeline/ProblemNote.tsx";
import { TimelineDrivesView } from "../components/timeline/TimelineDrivesView.tsx";
import { TimelineWeekView } from "../components/timeline/TimelineWeekView.tsx";
import { TimelineDriveLayers } from "../components/timeline/TimelineDriveLayers.tsx";
import { TimelineDriveRow } from "../components/timeline/TimelineDriveRow.tsx";
import { useNativeMapStyle } from "../components/map/useNativeMapStyle.ts";
import { TimelineClockText } from "../components/timeline/TimelineClockText.tsx";
import { TimelineDecryptCard } from "../components/timeline/TimelineDecryptCard.tsx";
import { TimelineMapLayers } from "../components/timeline/TimelineMapLayers.tsx";
import { TimelinePeopleChooser } from "../components/timeline/TimelinePeopleChooser.tsx";
import { TimelinePin } from "../components/timeline/TimelinePin.tsx";
import { TimelinePlaceLabel } from "../components/timeline/TimelinePlaceLabel.tsx";
import {
  TimelineCardShared,
  TimelinePlayerCard,
} from "../components/timeline/TimelinePlayerCard.tsx";
import {
  TimelineKey,
  TimelineMiniScrubber,
  TimelineScrubber,
} from "../components/timeline/TimelineScrubber.tsx";
import { DecryptedAvatarImage } from "../components/image/DecryptedAvatarImage.tsx";
import { Avatar, AvatarFallback } from "../components/ui/Avatar.tsx";
import { Button } from "../components/ui/Button.tsx";
import { Icon } from "../components/ui/Icon.tsx";
import { SegmentedControl } from "../components/ui/SegmentedControl.tsx";
import { Text } from "../components/ui/Text.tsx";
import { useCachedGroup } from "../hooks/useCachedGroup.ts";
import { useDriveLink } from "../hooks/useDriveLink.ts";
import { useGroupDrives, usePersonDrives } from "../hooks/useGroupDrives.ts";
import { useReducedMotion } from "../hooks/useReducedMotion.ts";
import { useTimelineClock } from "../hooks/useTimelineClock.ts";
import { useUnits } from "../hooks/useUnits.ts";
import { useTimelinePlayerCard } from "../hooks/useTimelinePlayerCard.ts";
import { useUses24HourClock } from "../hooks/useUses24HourClock.ts";
import { useTimelineDay, useTimelineDays } from "../hooks/useTimeline.ts";
import { trpc } from "../lib/api.ts";
import { authClient } from "../lib/auth-client.ts";
import { initialsFromName } from "../lib/buildLiveMapMarkers.ts";
import { mapFitBounds } from "../lib/fitLiveMapMarkers.ts";
import { driveFigures, driveTitle } from "../lib/driveFormat.ts";
import { driveAt, driveListDays, drivePlaceId } from "../lib/driveList.ts";
import type { LoadedDrive } from "../lib/driveLoad.ts";
import { drivingScore } from "../lib/drivingScore.ts";
import { localDayOf } from "../lib/timelineDays.ts";
import { historyShareNote, timelineEmptyLines } from "../lib/historyShare.ts";
import { cn } from "../lib/cn.ts";
import { GROUP_COLOR_PALETTE, getGroupColor } from "../lib/groupColor.ts";
import { loadPersonalNicknames } from "../lib/personalNicknames.ts";
import { groupPlacesQueryOptions } from "../lib/placeSync.ts";
import { formatDistance, timelineSpeedLabel } from "../lib/units.ts";
import {
  pickPersonDevices,
  timelineDayStats,
  timelinePauseDetail,
  timelinePlayStart,
  timelinePositionAt,
  timelineSegmentAt,
  timelineStopJump,
} from "../lib/timeline.ts";
import {
  formatTimelineClock,
  formatTimelineDate,
  formatTimelineDayEnd,
} from "../lib/timelineClock.ts";
import { pickTimelinePeople } from "../lib/timelineBudget.ts";
import { rememberTimelineGroup } from "../lib/timelineGroup.ts";
import {
  timelineArrowViewport,
  timelineFitKeys,
  timelineLaneRuns,
  timelineRoute,
} from "../lib/timelineMap.ts";
import { packTimelineTrack, timelineMinuteLabels } from "../lib/timelineTrack.ts";
import type { Coordinate, TimelineSender } from "../lib/timelineTypes.ts";
import { thisDeviceNoun } from "../lib/thisDeviceNoun.ts";

const SPEEDS = [60, 300, 900] as const;
const STEP_MS = 15 * 60_000;
const NO_SENDERS: readonly TimelineSender[] = [];
const NO_DRIVES: readonly LoadedDrive[] = [];

const TimelineScreen = () => {
  const {
    driveId: linkDriveId,
    groupId,
    passenger: linkPassenger,
    userId,
  } = useLocalSearchParams<{
    driveId?: string;
    groupId: string;
    passenger?: string;
    userId?: string;
  }>();
  const router = useRouter();
  const { data: session } = authClient.useSession();
  const selfUserId = session?.user.id;
  const { group, isError, isPending, refetch } = useCachedGroup(groupId);
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
        <ActivityIndicator className="text-primary" />
      </View>
    );
  }

  if (isError) {
    return (
      <View className="flex-1 items-center justify-center gap-4 bg-background px-8">
        <Text className="text-center text-foreground">
          Couldn’t load your groups. Check your connection and try again.
        </Text>
        <Button variant="secondary" onPress={() => void refetch()}>
          <Text>Try again</Text>
        </Button>
      </View>
    );
  }

  if (!group) {
    return (
      <View className="flex-1 items-center justify-center gap-4 bg-background px-8">
        <Text className="text-center text-foreground">
          This group isn’t available on this {thisDeviceNoun()}.
        </Text>
        <Button variant="secondary" onPress={close}>
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
      link={{ driveId: linkDriveId ?? null, passenger: linkPassenger === "1" }}
      onClose={close}
      onSwitchGroup={switchGroup}
      selfUserId={selfUserId}
    />
  );
};

const TimelineView = ({
  group,
  initialPersonId,
  link,
  onClose,
  onSwitchGroup,
  selfUserId,
}: {
  group: {
    id: string;
    members: ReadonlyArray<{
      id: string;
      image: string | null;
      name: string;
      userId: string;
    }>;
    name: string;
  };
  initialPersonId: string | null;
  link: { driveId: string | null; passenger: boolean };
  onClose: () => void;
  onSwitchGroup: (groupId: string) => void;
  selfUserId: string;
}) => {
  const insets = useSafeAreaInsets();
  const uses24HourClock = useUses24HourClock();
  const formatClock = (time: number) => formatTimelineClock(time, uses24HourClock);
  const map = useNativeMapStyle();
  const cameraRef = useRef<CameraRef>(null);
  const mapRef = useRef<MapRef>(null);
  const [viewport, setViewport] = useState<{
    bounds: [number, number, number, number];
    zoom: number;
  } | null>(null);
  const [styleLoaded, setStyleLoaded] = useState(false);
  const [topHeight, setTopHeight] = useState(0);
  const [groupMenuOpen, setGroupMenuOpen] = useState(false);
  const [personId, setPersonId] = useState(initialPersonId);
  const [deviceChoice, setDeviceChoice] = useState<Record<string, string>>({});
  const [pickedDayKey, setPickedDayKey] = useState<string | null>(null);
  const [following, setFollowing] = useState(false);
  const fittedView = useRef({ moved: false, view: "" });
  const [chosenPeople, setChosenPeople] = useState<string[] | null>(null);
  const [chooserOpen, setChooserOpen] = useState(false);
  const [view, setView] = useState<"day" | "drives" | "week">("day");
  const [weekStep, setWeekStep] = useState(0);
  const [weekPersonId, setWeekPersonId] = useState(initialPersonId);
  if (weekPersonId !== personId) {
    setWeekPersonId(personId);
    setWeekStep(0);
  }
  const [openDriveId, setOpenDriveId] = useState<string | null>(null);
  const [sheetHeight, setSheetHeight] = useState(0);
  const reduceMotion = useReducedMotion();
  const units = useUnits();
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
  const groupDrives = useGroupDrives(group.id, windowStart);
  const personDrives = usePersonDrives(personId, view === "week");
  const drives = groupDrives.query.data?.drives ?? NO_DRIVES;
  const openDrive = drives.find((drive) => drive.driveId === openDriveId);
  const openRecord = openDrive?.record ?? null;
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
    return note ? [note] : [];
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
    if (pickedDayKey === null && day) setPickedDayKey(day.key);
  }, [day, pickedDayKey]);

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
      const stats = timelineDayStats({
        places: placeList,
        segments: person.device.segments,
      });
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
  const tracks = useMemo(
    () => shownPeople.map((person) => packTimelineTrack(person.device.segments)),
    [shownPeople],
  );
  const selectedTrack = selectedPerson ? (tracks[0] ?? null) : null;
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
  const clock = useTimelineClock({
    dayKey: timeline?.day.key,
    from: timeline?.from ?? 0,
    selectedTrack,
    startTime,
    to: timeline?.to ?? 0,
    tracks,
  });
  const time = timeline ? clock.shownTime : 0;

  const pins = routes.flatMap((route, index) => {
    const at = timelinePositionAt(route.person.device.segments, time);
    const track = tracks[index];
    return at.position && track ? [{ ...at, route, track }] : [];
  });
  const selectedPin = selectedPerson ? (pins[0] ?? null) : null;
  const card = useTimelinePlayerCard({
    canCollapse: timeline !== null && routes.length > 0,
    loading: days
      ? day !== null && (timeline === null || dayQuery.isPending) && !dayQuery.isError
      : !daysQuery.isError,
    reduceMotion,
  });
  const panelHeight = openRecord
    ? sheetHeight
    : card.height === 0
      ? 0
      : card.height + insets.bottom + 8;
  const cameraPadding = {
    top: topHeight + 24,
    bottom: panelHeight + 24,
    left: 40,
    right: 40,
  };

  useEffect(() => {
    if (!openRecord && view === "day") return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (openRecord) setOpenDriveId(null);
      else setView("day");
      return true;
    });
    return () => subscription.remove();
  }, [openRecord, view]);

  useEffect(() => {
    if (!groupMenuOpen) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      setGroupMenuOpen(false);
      return true;
    });
    return () => subscription.remove();
  }, [groupMenuOpen]);

  const fit = timelineFitKeys({
    dayKey: timeline?.day.key ?? "",
    loaded: dayQuery.data !== undefined,
    personId,
    ready: styleLoaded && topHeight > 0 && panelHeight > 0,
    routeIds: routes.map((route) => route.deviceId),
    shownUserIds: budget?.shown ?? [],
  });

  const followLongitude = selectedPin?.position.longitude;
  const followLatitude = selectedPin?.position.latitude;
  const followView = useRef({ padding: cameraPadding, view: fit.view });
  followView.current = { padding: cameraPadding, view: fit.view };
  const followTo = useCallback((longitude: number, latitude: number) => {
    if (fittedView.current.view !== followView.current.view) return;
    cameraRef.current?.jumpTo({
      center: [longitude, latitude],
      padding: followView.current.padding,
    });
  }, []);

  const followedOpen = useRef(card.open);
  // biome-ignore lint/correctness/useExhaustiveDependencies: only the card opening or closing re-centres the followed pin, with the padding for its new size
  useEffect(() => {
    if (followedOpen.current === card.open) return;
    followedOpen.current = card.open;
    if (!following || followLongitude === undefined || followLatitude === undefined) return;
    cameraRef.current?.easeTo({
      center: [followLongitude, followLatitude],
      duration: 300,
      padding: cameraPadding,
    });
  }, [card.open]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the camera moves only when the day, people or layout change, not on every frame
  useEffect(() => {
    if (!styleLoaded || topHeight === 0 || panelHeight === 0 || openDriveId) return;
    const sameView = fittedView.current.view === fit.view;
    if (sameView && (fittedView.current.moved || (following && selectedPerson))) return;
    fittedView.current = { moved: false, view: fit.view };
    setFollowing(false);
    const coordinates = routes.flatMap((route) => [
      ...[...route.line, ...route.pauses.flat()].map(([longitude, latitude]) => ({
        latitude,
        longitude,
      })),
      ...route.stops,
    ]);
    const framed = coordinates.length > 0 ? coordinates : pins.map((pin) => pin.position);
    if (framed.length === 0) return;
    const { ne, sw } = mapFitBounds(framed);
    cameraRef.current?.fitBounds([sw[0], sw[1], ne[0], ne[1]], {
      duration: 600,
      padding: cameraPadding,
    });
  }, [fit.key]);

  const selectedRoute = selectedPerson ? routes[0] : undefined;
  const selectedSegment = selectedPerson
    ? timelineSegmentAt(selectedPerson.device.segments, time)
    : null;
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
  const drivePlaceName = (position: { latitude: number; longitude: number }) =>
    placeName(drivePlaceId(places.data ?? [], position));
  const driveLabel = (record: DriveRecord) =>
    driveTitle(drivePlaceName(record.start), drivePlaceName(record.end));
  const driveUnder =
    selectedPerson && !openRecord ? driveAt(drives, selectedPerson.device.deviceId, time) : null;
  const deviceName = (deviceId: string) =>
    memberDevices.data?.find((device) => device.deviceId === deviceId)?.name ?? "Another device";
  const latestPoint = dayQuery.data?.devices
    .find((device) => device.deviceId === selectedPerson?.device.deviceId)
    ?.points.at(-1);
  const driveDetectionOff = latestPoint?.driveDetectionOff === true;
  const statusBoxes = selectedPerson ? (
    <>
      {!driveDetectionOff && latestPoint?.crashAlertsOff ? (
        <DriveInfoBox
          icon={SirenIcon}
          title="Crash alerts are off."
          text={
            selectedPerson.isSelf
              ? `${deviceName(selectedPerson.device.deviceId)} won’t send a Crash alert after a possible crash. You can turn them on in Account › Drive detection on that device.`
              : `${selectedPerson.name}’s ${deviceName(selectedPerson.device.deviceId)} won’t send a Crash alert after a possible crash. Only ${selectedPerson.name} can change this.`
          }
        />
      ) : null}
      {!driveDetectionOff && latestPoint?.driveAlertsOff ? (
        <DriveInfoBox
          icon={BellOffIcon}
          title="Drive alerts are off."
          text={
            selectedPerson.isSelf
              ? `You don’t send ${group.name} a Drive alert when you finish a drive. Your drives still show here.`
              : `${selectedPerson.name} doesn’t send ${group.name} a Drive alert when they finish a drive. Their drives still show here. Only ${selectedPerson.name} can change this.`
          }
        />
      ) : null}
    </>
  ) : null;
  const driveDetectionOffText = (person: {
    device: { deviceId: string };
    isSelf: boolean;
    name: string;
  }) =>
    `Drive detection is off on ${deviceName(person.device.deviceId)}, so ${person.isSelf ? "your" : `${person.name}’s`} drives aren’t recorded there.`;
  const drivePath = useMemo((): Coordinate[] => {
    if (!openRecord || !openDrive) return [];
    const segments =
      people
        .flatMap((person) => person.devices)
        .find((device) => device.deviceId === openDrive.senderDeviceId)?.segments ?? [];
    const { end, start } = openRecord;
    const path: Coordinate[] = [[start.longitude, start.latitude]];
    for (const segment of segments) {
      if (segment.kind !== "moving" || segment.end < start.time || segment.start > end.time) {
        continue;
      }
      if (segment.start >= start.time) path.push([segment.from.longitude, segment.from.latitude]);
      if (segment.end <= end.time) path.push([segment.to.longitude, segment.to.latitude]);
    }
    path.push([end.longitude, end.latitude]);
    return path;
  }, [openDrive, openRecord, people]);

  const fittedDrive = useRef("");
  // biome-ignore lint/correctness/useExhaustiveDependencies: the camera fits a drive when it opens, its path arrives or the space around it changes, not on every frame
  useEffect(() => {
    if (!openDriveId || !styleLoaded || sheetHeight === 0 || drivePath.length === 0) return;
    const key = `${openDriveId}:${drivePath.length}:${topHeight}:${sheetHeight}`;
    if (fittedDrive.current === key) return;
    fittedDrive.current = key;
    setFollowing(false);
    const { ne, sw } = mapFitBounds(
      drivePath.map(([longitude, latitude]) => ({ latitude, longitude })),
    );
    cameraRef.current?.fitBounds([sw[0], sw[1], ne[0], ne[1]], {
      duration: 600,
      padding: cameraPadding,
    });
  }, [drivePath, openDriveId, sheetHeight, styleLoaded, topHeight]);

  const seekedDrive = useRef<string | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the scrubber jumps to a drive's start once, when its day has loaded
  useEffect(() => {
    if (!openRecord || !openDriveId || !timeline || seekedDrive.current === openDriveId) return;
    if (openRecord.start.time < timeline.day.start || openRecord.start.time >= timeline.day.end) {
      return;
    }
    seekedDrive.current = openDriveId;
    clock.seek(Math.min(Math.max(openRecord.start.time, timeline.from), timeline.to));
  }, [openDriveId, openRecord, timeline]);

  const openDriveFrom = (drive: LoadedDrive & { record: DriveRecord }) => {
    clock.setPlaying(false);
    setView("day");
    setPickedDayKey(localDayOf(drive.record.start.time).key);
    setPersonId(drive.senderUserId);
    setDeviceChoice((current) => ({
      ...current,
      [drive.senderUserId]: drive.senderDeviceId,
    }));
    seekedDrive.current = null;
    fittedDrive.current = "";
    setOpenDriveId(drive.driveId);
  };
  const closeDrive = () => {
    setOpenDriveId(null);
    setSheetHeight(0);
  };

  const askPassengerFor = useDriveLink({
    drives,
    isFetching: groupDrives.query.isFetching,
    link,
    open: openDriveFrom,
    refetch: groupDrives.query.refetch,
  });

  const personGroupDrives = drives.filter((drive) => drive.senderUserId === personId);
  const allPersonDrives = [...personGroupDrives, ...(personDrives.data?.drives ?? [])];
  const listDeviceIds = [
    ...new Set([
      ...(selectedPerson?.devices.map((device) => device.deviceId) ?? []),
      ...allPersonDrives.map((drive) => drive.senderDeviceId),
    ]),
  ];
  const listDeviceId =
    (personId ? deviceChoice[personId] : undefined) ??
    selectedPerson?.device.deviceId ??
    allPersonDrives.find((drive) => drive.record)?.senderDeviceId ??
    null;
  const drivesListDays =
    personId && listDeviceId
      ? driveListDays({
          deviceId: listDeviceId,
          drives: personGroupDrives,
          places: places.data ?? [],
        })
      : [];

  const driveRow = (drive: { record: DriveRecord }) => ({
    figures: driveFigures(drive.record, units),
    score: drivingScore(drive.record)?.score ?? null,
    title: driveLabel(drive.record),
  });

  const deviceSwitch =
    personId && listDeviceId && listDeviceIds.length > 1 ? (
      <DeviceSwitch
        current={listDeviceId}
        deviceIds={listDeviceIds}
        names={memberDevices.data ?? []}
        onSwitch={(deviceId) =>
          setDeviceChoice((current) => ({
            ...current,
            [personId]: deviceId,
          }))
        }
      />
    ) : null;

  const undecryptable = shownPeople.reduce(
    (total, person) => total + person.device.undecryptable,
    0,
  );
  const status = (() => {
    if (!timeline) return null;
    const date = formatTimelineDate(timeline.day.start);
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
      case "moving": {
        const speedLabel = timelineSpeedLabel(selectedPin, units.speed);
        return {
          title: driveUnder && !driveUnder.record.passenger ? "Driving" : "Moving",
          detail: speedLabel ? `${speedLabel} · ${date}` : date,
          speed: speedLabel,
        };
      }
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
          detail: timelinePauseDetail({
            clock: formatClock,
            from: Math.max(timeline.from, selectedPerson.device.historyStart),
            name: selectedPerson.name,
            segment: selectedSegment,
            to: timeline.to,
          }),
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

  const { setPlaying } = clock;
  const topOverlay = useMemo(
    () => (
      <View
        className="absolute left-3 right-3 gap-2"
        style={{ top: insets.top + 8 }}
        onLayout={(event) => setTopHeight(event.nativeEvent.layout.height + insets.top + 8)}
      >
        <View className="flex-row items-center gap-2 rounded-3xl bg-card px-2 py-2 shadow-md shadow-black/15">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back"
            onPress={onClose}
            className="size-10 items-center justify-center rounded-full bg-container"
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
            className="max-w-[55%] flex-row items-center gap-2 rounded-full bg-container px-3 py-2"
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
          <View className="self-end rounded-3xl bg-card p-1 shadow-md shadow-black/15">
            {groups?.map((item) => (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                accessibilityState={{ selected: item.id === group.id }}
                onPress={() => {
                  setGroupMenuOpen(false);
                  if (item.id !== group.id) onSwitchGroup(item.id);
                }}
                className="min-h-11 flex-row items-center gap-2 rounded-2xl px-3"
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
        {openDriveId ? null : (
          <>
            <SegmentedControl
              accessibilityLabel="Timeline view"
              options={[
                { label: "Day", value: "day" as const },
                { label: "Drives", value: "drives" as const },
                { label: "Week", value: "week" as const },
              ]}
              selected={view}
              onChange={(next) => {
                setPlaying(false);
                setOpenDriveId(null);
                setView(next);
              }}
            />
            {days && view === "day" ? (
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
                      accessibilityLabel={`${formatTimelineDate(item.start)}${isToday ? ", today" : ""}${item.pointCount > 0 ? "" : ", no new locations"}`}
                      accessibilityState={{
                        disabled: !item.selectable,
                        selected,
                      }}
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
                      <Text
                        className={cn("text-xs", selected ? "text-background" : "text-secondary")}
                      >
                        {isToday
                          ? "Today"
                          : date.toLocaleDateString(undefined, {
                              weekday: "short",
                            })}
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
                  }}
                />
              ))}
            </ScrollView>
          </>
        )}
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
      openDriveId,
      personId,
      setPlaying,
      view,
    ],
  );
  const lanes = useMemo(
    () =>
      routes.map((route) => ({
        color: route.color,
        drives: drives.flatMap((drive) =>
          drive.record && drive.senderDeviceId === route.deviceId
            ? [
                {
                  end: drive.record.end.time,
                  passenger: drive.record.passenger,
                  start: drive.record.start.time,
                },
              ]
            : [],
        ),
        historyStart: route.person.device.historyStart,
        id: route.deviceId,
        initials: route.person.initials,
        runs: route.lanes,
      })),
    [drives, routes],
  );

  const { playing, speed } = clock;
  const nextSpeed = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length] ?? 60;
  const timelineDay = timeline?.day;
  const dayEndLabel = timeline ? formatTimelineDayEnd(timeline.day.end, uses24HourClock) : "";
  const clockLabel = timeline && time >= timeline.day.end ? dayEndLabel : formatClock(time);
  const minuteLabels = useMemo(
    () =>
      timelineDay
        ? timelineMinuteLabels(timelineDay, (value) => formatTimelineClock(value, uses24HourClock))
        : [],
    [timelineDay, uses24HourClock],
  );
  const dayLabel = day ? formatTimelineDate(day.start) : "";

  const stops = routes.flatMap((route) => route.stats.stops);
  const previousStop = timelineStopJump({ direction: "previous", stops, time });
  const nextStop = timelineStopJump({ direction: "next", stops, time });
  const jumpToStop = (direction: "next" | "previous") => {
    const target = timelineStopJump({
      direction,
      stops,
      time: clock.time.value,
    });
    if (target !== null) clock.seek(target);
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
          onPress={card.collapse}
          onRegionWillChange={(event) => {
            if (!event.nativeEvent.userInteraction) return;
            setFollowing(false);
            card.collapse();
            fittedView.current.moved = true;
          }}
          onRegionDidChange={(event) => {
            const { bounds, zoom } = event.nativeEvent;
            setViewport((current) => timelineArrowViewport(current, { bounds, zoom }));
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
          <MapStyleLayers layers={map.styleLayers} />
          <TimelineMapLayers
            dayKey={timeline?.day.key}
            reduceMotion={reduceMotion}
            routes={routes}
            viewport={viewport}
          />
          {openRecord && openDrive ? (
            <TimelineDriveLayers
              dotted={!openRecord.passenger && !openRecord.speedLimitsChecked}
              driveId={openDrive.driveId}
              events={openRecord.events}
              path={drivePath}
            />
          ) : null}
          {visitedPlaces.map((place) =>
            place.geometry ? (
              <TimelinePlaceLabel
                key={place.id}
                emoji={place.emoji}
                id={place.id}
                latitude={place.geometry.latitude}
                longitude={place.geometry.longitude}
                name={place.name}
                stopLabel={placeStopLabel(place.id)}
              />
            ) : null,
          )}
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
              onFollow={following && pin === selectedPin ? followTo : undefined}
              paused={pin.state === "pause"}
              time={clock.time}
              track={pin.track}
            />
          ))}
        </MapLibreMap>
      ) : (
        <View className="flex-1 items-center justify-center gap-4 px-8">
          {map.isError || map.isMapNotReady ? (
            <>
              <Text className="text-center text-tertiary">
                {map.isMapNotReady
                  ? "The server is still preparing the map."
                  : "We couldn’t load the map. Check your connection and try again."}
              </Text>
              <Button variant="secondary" loading={map.isFetching} onPress={map.retryUrl}>
                <Text>Try again</Text>
              </Button>
            </>
          ) : (
            <ActivityIndicator className="text-primary" />
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
          className="absolute right-3 size-11 items-center justify-center rounded-full bg-card shadow-sm shadow-black/10"
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

      {openRecord && openDrive ? (
        <DriveSheet
          key={openDrive.driveId}
          askPassenger={askPassengerFor === openDrive.driveId}
          date={formatTimelineDate(openRecord.start.time)}
          deviceName={deviceName(openDrive.senderDeviceId)}
          driverName={memberLook(openDrive.senderUserId).name}
          formatClock={formatClock}
          groupName={group.name}
          groupNames={groups?.map((item) => item.name) ?? [group.name]}
          isOwn={openDrive.senderUserId === selfUserId}
          onClose={closeDrive}
          onDelete={async () => {
            await groupDrives.remove(openDrive);
            closeDrive();
          }}
          onDriving={() => groupDrives.rewrite(openDrive, "driving")}
          onHeight={setSheetHeight}
          onPassenger={() => groupDrives.rewrite(openDrive, "passenger")}
          placeNameAt={drivePlaceName}
          record={openRecord}
          recordedHere={openDrive.senderDeviceId === groupDrives.query.data?.thisDeviceId}
          title={driveLabel(openRecord)}
          units={units}
        />
      ) : view === "day" ? (
        <TimelinePlayerCard
          bottom={insets.bottom + 8}
          card={card}
          miniStatus={{
            date: dayLabel,
            speed: status && "speed" in status ? status.speed : null,
            title: status && status.title !== dayLabel ? status.title : null,
          }}
          miniScrubber={
            timeline ? (
              <TimelineMiniScrubber
                clock={clock.scrubber}
                day={timeline.day}
                from={timeline.from}
                step={STEP_MS}
                to={timeline.to}
                valueLabel={status ? `${clockLabel}, ${status.title}` : clockLabel}
                onSeek={clock.seek}
              />
            ) : (
              <View className="h-11 items-center justify-center">
                <ActivityIndicator size="small" className="text-primary" />
              </View>
            )
          }
        >
          {daysQuery.isError && !days ? (
            <ProblemNote
              message={`Couldn’t load the Timeline for ${group.name}. Check your connection and try again.`}
              loading={daysQuery.isFetching}
              onRetry={() => void daysQuery.refetch()}
            />
          ) : !days ? (
            <Animated.View {...card.fullOnly}>
              <ActivityIndicator className="py-6 text-primary" />
            </Animated.View>
          ) : !day ? (
            <View className="gap-1 py-4">
              {timelineEmptyLines({
                groupName: group.name,
                notes: shareNotes,
                personSelected: personId !== null,
              }).map((line) => (
                <Text key={line} className="text-center text-tertiary">
                  {line}
                </Text>
              ))}
            </View>
          ) : dayQuery.isError && !timeline ? (
            <ProblemNote
              message="Couldn’t load this day. Check your connection and try again."
              loading={dayQuery.isFetching}
              onRetry={() => void dayQuery.refetch()}
            />
          ) : !timeline ? (
            <Animated.View {...card.fullOnly}>
              <ActivityIndicator className="py-6 text-primary" />
            </Animated.View>
          ) : (
            <View className="gap-3">
              {daysQuery.isError || dayQuery.isError ? (
                <Animated.View {...card.fullOnly}>
                  <Text className="text-sm text-secondary">
                    Couldn’t reach the server, so this may be out of date.
                  </Text>
                </Animated.View>
              ) : null}
              <View
                className="flex-row flex-wrap items-center gap-3"
                onLayout={card.measure("topRow")}
              >
                <TimelineCardShared motion={card.shared.clock}>
                  <TimelineClockText
                    key={timeline.day.key}
                    accessibilityLabel={clockLabel}
                    day={timeline.day}
                    endLabel={dayEndLabel}
                    labels={minuteLabels}
                    time={clock.time}
                  />
                </TimelineCardShared>
                <Animated.View {...card.fullOnly} className="min-w-16 flex-1">
                  <Text
                    accessibilityLiveRegion="polite"
                    className="font-semibold text-foreground"
                    numberOfLines={1}
                  >
                    {status?.title}
                  </Text>
                  {status?.detail ? (
                    <Text className="text-sm text-secondary" numberOfLines={2}>
                      {status.detail}
                    </Text>
                  ) : null}
                </Animated.View>
                <TimelineCardShared motion={card.shared.speed}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Playback speed, ${speed} times. Double tap for ${nextSpeed} times`}
                    onPress={() => clock.setSpeed(nextSpeed)}
                    className="min-h-11 min-w-14 items-center justify-center rounded-full bg-container px-3"
                  >
                    <Text className="font-semibold text-foreground">{speed}×</Text>
                  </Pressable>
                </TimelineCardShared>
              </View>
              <Animated.View {...card.fullOnly} className="gap-3">
                {routes.length > 0 ? (
                  <TimelineScrubber
                    clock={clock.scrubber}
                    day={timeline.day}
                    from={timeline.from}
                    historyStart={timeline.historyStart}
                    lanes={lanes}
                    step={STEP_MS}
                    to={timeline.to}
                    uses24HourClock={uses24HourClock}
                    valueLabel={status ? `${clockLabel}, ${status.title}` : clockLabel}
                    onSeek={clock.seek}
                  />
                ) : (
                  <Text className="py-2 text-center text-tertiary">
                    {personId
                      ? `No locations from ${selectedName ?? "this person"} on this day.`
                      : "No locations on this day."}
                  </Text>
                )}
                {routes.length > 0 ? (
                  <TimelineKey
                    color={selectedPerson?.color}
                    showDrives={lanes.some((lane) => lane.drives.length > 0)}
                    showNotAvailable={
                      timeline.historyStart > timeline.day.start ||
                      lanes.some((lane) => lane.historyStart > timeline.day.start)
                    }
                  />
                ) : null}
                {driveUnder ? (
                  <TimelineDriveRow
                    detail={`${formatClock(driveUnder.record.start.time)}–${formatClock(driveUnder.record.end.time)} · ${driveFigures(driveUnder.record, units)}`}
                    onPress={() => openDriveFrom(driveUnder)}
                    passenger={driveUnder.record.passenger}
                    score={drivingScore(driveUnder.record)?.score ?? null}
                    title={driveLabel(driveUnder.record)}
                  />
                ) : null}
                {selectedPerson && driveDetectionOff ? (
                  <DriveInfoBox text={driveDetectionOffText(selectedPerson)} />
                ) : null}
                {statusBoxes}
                {selectedPerson && selectedRoute ? (
                  <>
                    <View className="flex-row flex-wrap gap-2">
                      <StatCard
                        value={formatDistance(selectedRoute.stats.distanceMeters, units.distance)}
                        label="travelled"
                      />
                      <StatCard
                        value={String(selectedRoute.stats.stops.length)}
                        label={selectedRoute.stats.stops.length === 1 ? "stop" : "stops"}
                      />
                      <StatCard
                        value={formatDuration(selectedRoute.stats.movingMs)}
                        label="moving"
                      />
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
              </Animated.View>
              {routes.length > 0 ? (
                <View className="flex-row items-center" onLayout={card.measure("controls")}>
                  <Animated.View {...card.fullOnly} className="flex-1 flex-row justify-around">
                    <ControlButton
                      disabled={previousStop === null}
                      icon={SkipBackIcon}
                      label="Previous stop"
                      onPress={() => jumpToStop("previous")}
                    />
                    <ControlButton
                      icon={RewindIcon}
                      label="Back 15 minutes"
                      onPress={() => clock.seek(clock.time.value - STEP_MS)}
                    />
                  </Animated.View>
                  <TimelineCardShared motion={card.shared.play}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={playing ? "Pause" : "Play"}
                      accessibilityState={{ disabled: !styleLoaded }}
                      disabled={!styleLoaded}
                      onPress={() => {
                        if (playing) {
                          clock.setPlaying(false);
                          return;
                        }
                        clock.play(
                          timelinePlayStart({
                            from: timeline.from,
                            located,
                            scrubbed: clock.scrubbed,
                            time: clock.time.value,
                            to: timeline.to,
                            today: showingToday,
                          }),
                        );
                        setFollowing(true);
                      }}
                      className="size-14 items-center justify-center rounded-full bg-primary"
                    >
                      <Icon as={playing ? PauseIcon : PlayIcon} size={24} className="text-white" />
                    </Pressable>
                  </TimelineCardShared>
                  <Animated.View {...card.fullOnly} className="flex-1 flex-row justify-around">
                    <ControlButton
                      icon={FastForwardIcon}
                      label="Forward 15 minutes"
                      onPress={() => clock.seek(clock.time.value + STEP_MS)}
                    />
                    <ControlButton
                      disabled={nextStop === null}
                      icon={SkipForwardIcon}
                      label="Next stop"
                      onPress={() => jumpToStop("next")}
                    />
                  </Animated.View>
                </View>
              ) : null}
              {personId === null && hiddenCount > 0 ? (
                <Animated.View
                  {...card.fullOnly}
                  className="gap-2 rounded-2xl border border-warning-accent bg-card p-3"
                >
                  <Text className="text-sm text-foreground">
                    There are too many locations on this day to show everyone, so Timeline is
                    showing {peopleWithLocations.length - hiddenCount} of{" "}
                    {peopleWithLocations.length} people.
                  </Text>
                  <Button
                    size="sm"
                    variant="secondary"
                    className="self-start"
                    onPress={() => setChooserOpen(true)}
                  >
                    <Text>Choose people</Text>
                  </Button>
                </Animated.View>
              ) : null}
              {undecryptable > 0 ? (
                <Animated.View {...card.fullOnly}>
                  <Text className="text-xs text-secondary">
                    {undecryptable === 1
                      ? `1 location couldn’t be decrypted on this ${thisDeviceNoun()}, so it’s left out.`
                      : `${undecryptable.toLocaleString()} locations couldn’t be decrypted on this ${thisDeviceNoun()}, so they’re left out.`}
                  </Text>
                </Animated.View>
              ) : null}
            </View>
          )}
        </TimelinePlayerCard>
      ) : null}

      {view === "drives" ? (
        <TimelineDrivesView
          days={drivesListDays}
          deviceName={deviceName}
          formatClock={formatClock}
          groupName={group.name}
          header={
            <>
              {deviceSwitch}
              {selectedPerson && driveDetectionOff ? (
                <DriveInfoBox text={driveDetectionOffText(selectedPerson)} />
              ) : null}
              {statusBoxes}
            </>
          }
          name={selectedName}
          onOpen={openDriveFrom}
          onSwitchDevice={(deviceId) => {
            if (personId) {
              setDeviceChoice((current) => ({
                ...current,
                [personId]: deviceId,
              }));
            }
          }}
          personId={personId}
          placeName={placeName}
          query={groupDrives.query}
          rowOf={driveRow}
          top={topHeight + 4}
        />
      ) : null}

      {view === "week" ? (
        <TimelineWeekView
          detectionOffText={
            selectedPerson && driveDetectionOff
              ? selectedPerson.isSelf
                ? `${deviceName(selectedPerson.device.deviceId)} isn’t recording drives. You can turn it on in Account on that device.`
                : `${selectedPerson.name}’s ${deviceName(selectedPerson.device.deviceId)} isn’t recording drives. Only ${selectedPerson.name} can turn it on.`
              : null
          }
          deviceId={listDeviceId}
          groupDrives={drives}
          groupName={group.name}
          header={
            <>
              {deviceSwitch}
              {statusBoxes}
            </>
          }
          isOwn={personId === selfUserId}
          name={selectedName ?? "this person"}
          onOpen={openDriveFrom}
          onSeeAll={() => setView("drives")}
          onStep={(weeks) => setWeekStep((current) => Math.min(0, current + weeks))}
          personDrives={personDrives}
          personId={personId}
          rowOf={driveRow}
          top={topHeight + 4}
          units={units}
          weekStep={weekStep}
        />
      ) : null}

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

const StatCard = ({ label, value }: { label: string; value: string }) => {
  const { fontScale } = useWindowDimensions();
  return (
    <View
      className="flex-1 rounded-2xl bg-container px-3 py-2"
      style={{ minWidth: 72 * Math.max(fontScale, 1) }}
    >
      <Text
        adjustsFontSizeToFit
        className="text-lg font-semibold text-foreground"
        numberOfLines={1}
      >
        {value}
      </Text>
      <Text adjustsFontSizeToFit className="text-xs text-secondary" numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
};

const ControlButton = ({
  disabled = false,
  icon,
  label,
  onPress,
}: {
  disabled?: boolean;
  icon: typeof PlayIcon;
  label: string;
  onPress: () => void;
}) => (
  <Pressable
    accessibilityRole="button"
    accessibilityLabel={label}
    accessibilityState={{ disabled }}
    disabled={disabled}
    onPress={onPress}
    className={cn(
      "size-11 items-center justify-center rounded-full bg-container",
      disabled && "opacity-40",
    )}
  >
    <Icon as={icon} size={20} className="text-foreground" />
  </Pressable>
);

const formatDuration = (ms: number) => {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} m`;
};

export default TimelineScreen;
