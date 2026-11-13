import { useIsFocused } from "@react-navigation/native";
import {
  skipToken,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Link } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppState, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LocationSharingPausedBanner } from "../../../components/map/LocationSharingPausedBanner.tsx";
import { NativeMap } from "../../../components/map/NativeMap.tsx";
import { NewSignInBanner } from "../../../components/NewSignInBanner.tsx";
import { Button } from "../../../components/ui/Button.tsx";
import { Text } from "../../../components/ui/Text.tsx";
import { useGroupColorRevision } from "../../../hooks/useGroupColorRevision.ts";
import { useCurrentGroupKeyAccess } from "../../../hooks/useGroupKeyAccess.ts";
import { useMapLivePositions } from "../../../hooks/useMapLivePositions.ts";
import { useHiddenMapGroupIds } from "../../../hooks/useHiddenMapGroupIds.ts";
import { useMembershipSnapshot } from "../../../hooks/useMembershipSnapshot.ts";
import { useTrackingUploadTime } from "../../../hooks/useTrackingUploadTime.ts";
import { useSelfDeviceLocation } from "../../../hooks/useSelfDeviceLocation.ts";
import { trpc } from "../../../lib/api.ts";
import { applySelfDeviceLocation } from "../../../lib/applySelfDeviceLocation.ts";
import { authClient } from "../../../lib/auth-client.ts";
import { buildLiveMapMarkers, labelDeviceIcons } from "../../../lib/buildLiveMapMarkers.ts";
import { classifyMapPeople, flagUnreadableMarkers } from "../../../lib/classifyMapPeople.ts";
import { loadPersonalNicknames } from "../../../lib/personalNicknames.ts";
import { canShowSharedLocation } from "../../../lib/locationSharingVisibility.ts";
import { getGroupColor } from "../../../lib/groupColor.ts";
import { setMapGroupHidden } from "../../../lib/hiddenMapGroups.ts";
import {
  hideMapGroupMarkers,
  listHiddenMapPeople,
  resolveHiddenGroupIds,
  shownMapGroups,
} from "../../../lib/mapGroupVisibility.ts";
import { nextMapMarkerSelection } from "../../../lib/mapMarkerSelection.ts";
import type { MapMemberDevice } from "../../../lib/mapPeopleTypes.ts";
import { readRegisteredDevice } from "../../../lib/registeredDevice.ts";
import { resolveSelfDeviceLocationFallback } from "../../../lib/resolveSelfDeviceLocationFallback.ts";
import { storage } from "../../../lib/storage.ts";
import { TAB_BAR_CONTENT_HEIGHT } from "../../../lib/tabBarLayout.ts";
import { dismissTrackingQueueEviction, getTrackingQueueEviction } from "../../../lib/tracking.ts";

const keyBannerDismissedKey = (userId: string, groupId: string) =>
  `map.keyBannerDismissed.${userId}.${groupId}`;

const MapScreen = () => {
  const insets = useSafeAreaInsets();
  const {
    dropRemovedDevices,
    positions: livePositions,
    status: trackingStatus,
  } = useMapLivePositions();
  const { data: session } = authClient.useSession();
  const userId = session?.user.id;
  const isFocused = useIsFocused();
  const { data: groupsQueryData } = useQuery({
    ...trpc.groupMembership.list.queryOptions(),
    enabled: false,
  });
  const groups = useMembershipSnapshot(groupsQueryData);
  const nicknames = useQueries({
    queries: (groups ?? []).map((group) => ({
      queryKey: ["personalNicknames", group.id, userId],
      queryFn: userId ? () => loadPersonalNicknames(group.id, userId) : skipToken,
    })),
    combine: (results) => results.map((result) => result.data),
    subscribed: isFocused,
  });
  const groupsWithNicknames = useMemo(
    () =>
      groups?.map((group, index) => ({
        ...group,
        members: group.members.map((member) => ({
          ...member,
          name: nicknames[index]?.[member.id]?.name ?? member.name,
        })),
      })),
    [groups, nicknames],
  );
  const keyAccess = useCurrentGroupKeyAccess(
    groups?.map((group) => group.id) ?? [],
    session?.user.id,
  );
  const keyAccessSignature = keyAccess
    .map((access) => access.data?.current ?? (access.isError ? "failed" : ""))
    .join(",");
  const keyAccessByGroupId = useMemo(() => {
    const statuses = keyAccessSignature.split(",");
    const byGroupId = new Map<string, "available" | "failed" | "missing" | "unavailable">();
    groups?.forEach((group, index) => {
      const status = (["available", "failed", "missing", "unavailable"] as const).find(
        (item) => item === statuses[index],
      );
      if (status) byGroupId.set(group.id, status);
    });
    return byGroupId;
  }, [groups, keyAccessSignature]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const selfUserId = session?.user.id ?? "";
  const { data: registeredDevice } = useQuery({
    queryKey: ["registeredDevice", selfUserId],
    enabled: selfUserId.length > 0,
    staleTime: Number.POSITIVE_INFINITY,
    queryFn: readRegisteredDevice,
  });
  const selfDeviceId = registeredDevice?.userId === selfUserId ? registeredDevice.deviceId : "";
  const memberDeviceLists = useQueries({
    queries: (groups ?? []).map((group) => ({
      ...trpc.groupMembership.listMemberDevices.queryOptions({ groupId: group.id }),
      subscribed: isFocused,
    })),
    combine: listMemberDeviceResults,
  });
  const memberDevices = useMemo(
    () => [
      ...new Map(
        memberDeviceLists
          .flatMap((devices) => devices ?? [])
          .map((device) => [device.deviceId, device]),
      ).values(),
    ],
    [memberDeviceLists],
  );
  const appliedMemberDeviceLists = useRef(new WeakSet<readonly MapMemberDevice[]>());
  useEffect(() => {
    groups?.forEach((group, index) => {
      const devices = memberDeviceLists[index];
      if (!devices || appliedMemberDeviceLists.current.has(devices)) return;
      appliedMemberDeviceLists.current.add(devices);
      dropRemovedDevices({
        activeDeviceIds: new Set(devices.map(({ deviceId }) => deviceId)),
        groupId: group.id,
      });
    });
  }, [dropRemovedDevices, groups, memberDeviceLists]);
  const peopleTrayKey = `map.peopleTrayOpen.${selfUserId}`;
  const storedPeopleTrayOpen = useMemo(
    () => storage.getBoolean(peopleTrayKey) ?? false,
    [peopleTrayKey],
  );
  const [peopleTrayOverride, setPeopleTrayOverride] = useState<{
    open: boolean;
    userId: string;
  } | null>(null);
  const peopleTrayOpen =
    peopleTrayOverride?.userId === selfUserId ? peopleTrayOverride.open : storedPeopleTrayOpen;
  const [appActive, setAppActive] = useState(() => AppState.currentState === "active");
  const [now, setNow] = useState(() => Date.now());
  const selfDeviceLocation = useSelfDeviceLocation(selfUserId.length > 0);
  const lastSentAt = useTrackingUploadTime(selfUserId, groups?.map((group) => group.id) ?? []);
  const queryClient = useQueryClient();
  const evictionQueryKey = ["trackingQueueEviction", selfUserId];
  const { data: queueEviction } = useQuery({
    queryKey: evictionQueryKey,
    enabled: selfUserId.length > 0,
    subscribed: isFocused,
    refetchInterval: 60_000,
    queryFn: () => getTrackingQueueEviction(selfUserId),
  });
  const dismissQueueEviction = useMutation({
    mutationFn: dismissTrackingQueueEviction,
    networkMode: "always",
    onSettled: () => queryClient.invalidateQueries({ queryKey: evictionQueryKey }),
  });
  const groupColorRevision = useGroupColorRevision();
  const storedHiddenGroupIds = useHiddenMapGroupIds(session?.user.id);
  const hiddenGroupIds = useMemo(
    () => resolveHiddenGroupIds(groups ?? [], storedHiddenGroupIds),
    [groups, storedHiddenGroupIds],
  );
  const groupOptions = useMemo(() => {
    void groupColorRevision;
    return (groups ?? []).map((group) => ({
      color: getGroupColor(group.id),
      hidden: hiddenGroupIds.has(group.id),
      id: group.id,
      memberCount: group.members.filter((member) => member.userId !== selfUserId).length,
      name: group.name,
    }));
  }, [groupColorRevision, groups, hiddenGroupIds, selfUserId]);
  const shownGroups = useMemo(
    () =>
      groupsWithNicknames &&
      shownMapGroups({ groups: groupsWithNicknames, hiddenGroupIds, selfUserId }),
    [groupsWithNicknames, hiddenGroupIds, selfUserId],
  );
  const [, setKeyBannerRevision] = useState(0);
  const groupsMissingKeys =
    groups?.filter(
      (group, index) =>
        !hiddenGroupIds.has(group.id) &&
        keyAccess[index]?.data?.current === "missing" &&
        !storage.getBoolean(keyBannerDismissedKey(selfUserId, group.id)),
    ) ?? [];
  const dismissKeyBanners = (groupIds: readonly string[]) => {
    for (const groupId of groupIds) storage.set(keyBannerDismissedKey(selfUserId, groupId), true);
    setKeyBannerRevision((revision) => revision + 1);
  };

  const selfFallback = useMemo(() => {
    void groupColorRevision;
    return resolveSelfDeviceLocationFallback({
      getGroupColor,
      groups: groupsWithNicknames ?? [],
      selfUserId,
      selfUser: session?.user
        ? { name: session.user.name, image: session.user.image ?? null }
        : null,
    });
  }, [groupColorRevision, groupsWithNicknames, selfUserId, session?.user]);

  const markers = useMemo(() => {
    void groupColorRevision;
    if (!selfUserId) {
      return [];
    }

    return labelDeviceIcons({
      markers: flagUnreadableMarkers({
        groups: shownGroups ?? [],
        markers: hideMapGroupMarkers({
          getGroupColor,
          groups: groupsWithNicknames ?? [],
          hiddenGroupIds,
          markers: applySelfDeviceLocation({
            markers: buildLiveMapMarkers({
              getGroupColor,
              groups: groupsWithNicknames ?? [],
              positions: livePositions,
              selfDeviceId,
            }),
            selfDeviceId,
            selfDeviceLocation,
            selfFallback,
            selfUserId,
            lastSentAt,
          }),
          selfUserId,
        }),
        status: trackingStatus,
      }),
      memberDevices,
    }).filter((marker) => canShowSharedLocation(marker, trackingStatus.sharing));
  }, [
    groupColorRevision,
    groupsWithNicknames,
    hiddenGroupIds,
    livePositions,
    memberDevices,
    shownGroups,
    selfDeviceId,
    selfDeviceLocation,
    selfFallback,
    selfUserId,
    lastSentAt,
    trackingStatus,
  ]);

  const people = useMemo(() => {
    if (!selfUserId || !groupsWithNicknames || !shownGroups) {
      return null;
    }

    return {
      ...classifyMapPeople({
        groups: shownGroups,
        keyAccess: keyAccessByGroupId,
        markers,
        now,
        selfUserId,
        status: trackingStatus,
      }),
      hidden: listHiddenMapPeople({ groups: groupsWithNicknames, hiddenGroupIds, selfUserId }),
    };
  }, [
    groupsWithNicknames,
    hiddenGroupIds,
    keyAccessByGroupId,
    markers,
    now,
    selfUserId,
    shownGroups,
    trackingStatus,
  ]);

  useEffect(() => {
    for (const [groupId, access] of keyAccessByGroupId) {
      if (access === "available") storage.remove(keyBannerDismissedKey(selfUserId, groupId));
    }
  }, [keyAccessByGroupId, selfUserId]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      setAppActive(state === "active");
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!isFocused || !appActive || !peopleTrayOpen) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, [appActive, isFocused, peopleTrayOpen]);

  useEffect(() => {
    if (selectedDeviceId && !markers.some((marker) => marker.deviceId === selectedDeviceId)) {
      setSelectedDeviceId(null);
    }
  }, [markers, selectedDeviceId]);

  return (
    <View
      className="flex-1 bg-background"
      style={{ paddingBottom: insets.bottom + TAB_BAR_CONTENT_HEIGHT }}
    >
      <NativeMap
        devices={memberDevices.map((device) => ({
          ...device,
          paused:
            trackingStatus.sharing?.find((state) => state.deviceId === device.deviceId)?.paused ??
            false,
          unreadable: trackingStatus.undecryptable.some(
            (item) => item.deviceId === device.deviceId && item.userId === device.userId,
          ),
        }))}
        groupOptions={groupOptions}
        onSetGroupHidden={(groupId, hidden) => {
          if (!selfUserId) return;
          setMapGroupHidden({ groupId, hidden, userId: selfUserId });
        }}
        markers={markers}
        now={now}
        people={people}
        peopleTrayOpen={peopleTrayOpen}
        onPeopleTrayOpenChange={(open) => {
          storage.set(peopleTrayKey, open);
          setPeopleTrayOverride({ open, userId: selfUserId });
        }}
        selectedDeviceId={selectedDeviceId}
        onSelectDeviceId={(deviceId) => {
          setSelectedDeviceId((current) => nextMapMarkerSelection(current, deviceId));
        }}
      />
      <ScrollView
        pointerEvents="box-none"
        className="absolute left-4 right-16"
        style={{ top: insets.top + 8, maxHeight: "65%" }}
      >
        <NewSignInBanner subscribed={isFocused} />
        <LocationSharingPausedBanner
          polled={trackingStatus.sharing?.find((state) => state.deviceId === selfDeviceId) ?? null}
          subscribed={isFocused}
          userId={selfUserId}
        />
        {queueEviction && (
          <View className="mb-2 gap-2 rounded-xl border border-amber-600 dark:border-amber-400 bg-card p-4">
            <Text className="font-semibold text-amber-700 dark:text-amber-400">
              Some location history was removed
            </Text>
            <Text>
              This phone was offline long enough to fill its 10 MB upload queue. To keep sharing
              your latest location, history queued between{" "}
              {new Date(queueEviction.oldestQueuedAt).toLocaleString(undefined, {
                dateStyle: "medium",
                timeStyle: "short",
              })}{" "}
              and{" "}
              {new Date(queueEviction.newestQueuedAt).toLocaleString(undefined, {
                dateStyle: "medium",
                timeStyle: "short",
              })}{" "}
              was deleted before it could be uploaded.
            </Text>
            <Button
              size="sm"
              variant="outline"
              className="self-start"
              loading={dismissQueueEviction.isPending}
              onPress={() => dismissQueueEviction.mutate(queueEviction)}
            >
              <Text>Dismiss</Text>
            </Button>
          </View>
        )}
        {groupsMissingKeys.length <= 2 &&
          groupsMissingKeys.map((group) => (
            <View
              key={group.id}
              className="mb-2 gap-2 rounded-xl border border-red-700 dark:border-red-400 bg-card p-4"
            >
              <Text className="font-semibold text-red-700 dark:text-red-400">
                Can’t show locations for {group.name}
              </Text>
              <Text>
                This phone can’t access the group’s encryption key. Group locations may be
                unavailable.
              </Text>
              <View className="flex-row flex-wrap items-center gap-3">
                <Link
                  href={{ pathname: "/(tabs)/groups/[groupId]", params: { groupId: group.id } }}
                  asChild
                >
                  <Button size="sm">
                    <Text>Open group</Text>
                  </Button>
                </Link>
                <Button size="sm" variant="outline" onPress={() => dismissKeyBanners([group.id])}>
                  <Text>Dismiss</Text>
                </Button>
              </View>
            </View>
          ))}
        {groupsMissingKeys.length > 2 && (
          <View className="mb-2 gap-2 rounded-xl border border-red-700 dark:border-red-400 bg-card p-4">
            <Text className="font-semibold text-red-700 dark:text-red-400">
              Multiple groups require attention
            </Text>
            <View className="flex-row flex-wrap items-center gap-3">
              <Link href="/(tabs)/groups" asChild>
                <Button size="sm">
                  <Text>Open groups</Text>
                </Button>
              </Link>
              <Button
                size="sm"
                variant="outline"
                onPress={() => dismissKeyBanners(groupsMissingKeys.map((group) => group.id))}
              >
                <Text>Dismiss</Text>
              </Button>
            </View>
          </View>
        )}
      </ScrollView>
    </View>
  );
};

const listMemberDeviceResults = (
  results: readonly { data?: readonly MapMemberDevice[] | undefined }[],
) => results.map((result) => result.data);

export default MapScreen;
