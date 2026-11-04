import { useQueries, useQuery } from "@tanstack/react-query";
import { Link } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { NativeMap } from "../../../components/map/NativeMap.tsx";
import { Text } from "../../../components/ui/Text.tsx";
import { useGroupColorRevision } from "../../../hooks/useGroupColorRevision.ts";
import { useGroupKeyAccess } from "../../../hooks/useGroupKeyAccess.ts";
import { useMapLivePositions } from "../../../hooks/useMapLivePositions.ts";
import { useMembershipSnapshot } from "../../../hooks/useMembershipSnapshot.ts";
import { useTrackingUploadTime } from "../../../hooks/useTrackingUploadTime.ts";
import { useSelfDeviceLocation } from "../../../hooks/useSelfDeviceLocation.ts";
import { trpc } from "../../../lib/api.ts";
import { applySelfDeviceLocation } from "../../../lib/applySelfDeviceLocation.ts";
import { authClient } from "../../../lib/auth-client.ts";
import { buildLiveMapMarkers } from "../../../lib/buildLiveMapMarkers.ts";
import { loadPersonalNicknames } from "../../../lib/personalNicknames.ts";
import { getGroupColor } from "../../../lib/groupColor.ts";
import { nextMapMarkerSelection } from "../../../lib/mapMarkerSelection.ts";
import { resolveSelfDeviceLocationFallback } from "../../../lib/resolveSelfDeviceLocationFallback.ts";
import { TAB_BAR_CONTENT_HEIGHT } from "../../../lib/tabBarLayout.ts";

const MapScreen = () => {
  const insets = useSafeAreaInsets();
  const livePositions = useMapLivePositions();
  const { data: session } = authClient.useSession();
  const { data: groupsQueryData } = useQuery(trpc.groupMembership.list.queryOptions());
  const groups = useMembershipSnapshot(groupsQueryData);
  const nicknameQueries = useQueries({
    queries: (groups ?? []).map((group) => ({
      queryKey: ["personalNicknames", group.id, session?.user.id],
      enabled: !!session?.user.id,
      queryFn: () => loadPersonalNicknames(group.id, session!.user.id),
    })),
  });
  const groupsWithNicknames = groups?.map((group, index) => ({
    ...group,
    members: group.members.map((member) => ({
      ...member,
      name: nicknameQueries[index]?.data?.[member.id]?.name ?? member.name,
    })),
  }));
  const keyAccess = useGroupKeyAccess(groups?.map((group) => group.id) ?? [], session?.user.id);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const selfUserId = session?.user.id ?? "";
  const selfDeviceLocation = useSelfDeviceLocation(selfUserId.length > 0);
  const lastSentAt = useTrackingUploadTime(selfUserId, groups?.map((group) => group.id) ?? []);
  const groupColorRevision = useGroupColorRevision();
  const groupsMissingKeys =
    groups?.filter((_, index) => keyAccess[index]?.data === "missing") ?? [];

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

    return applySelfDeviceLocation({
      markers: buildLiveMapMarkers({
        getGroupColor,
        groups: groupsWithNicknames ?? [],
        positions: livePositions,
        selfUserId,
      }),
      selfDeviceLocation,
      selfFallback,
      selfUserId,
      lastSentAt,
    });
  }, [
    groupColorRevision,
    groupsWithNicknames,
    livePositions,
    selfDeviceLocation,
    selfFallback,
    selfUserId,
    lastSentAt,
  ]);

  useEffect(() => {
    if (selectedUserId && !markers.some((marker) => marker.userId === selectedUserId)) {
      setSelectedUserId(null);
    }
  }, [markers, selectedUserId]);

  return (
    <View
      className="flex-1 bg-background"
      style={{ paddingBottom: insets.bottom + TAB_BAR_CONTENT_HEIGHT }}
    >
      <NativeMap
        markers={markers}
        selectedUserId={selectedUserId}
        onSelectUserId={(userId) => {
          setSelectedUserId((current) => nextMapMarkerSelection(current, userId));
        }}
      />
      <ScrollView
        pointerEvents="box-none"
        className="absolute left-4 right-4"
        style={{ top: insets.top + 8, maxHeight: "65%" }}
      >
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
                This device can’t access the group’s encryption key. Open the group for recovery
                options.
              </Text>
              <Link href={{ pathname: "/(tabs)/groups/[groupId]", params: { groupId: group.id } }}>
                <Text className="font-semibold text-red-500 dark:text-red-300">Open group</Text>
              </Link>
            </View>
          ))}
        {groupsMissingKeys.length > 2 && (
          <View className="mb-2 gap-2 rounded-xl border border-red-700 dark:border-red-400 bg-card p-4">
            <Text className="font-semibold text-red-700 dark:text-red-400">
              Multiple groups require attention
            </Text>
            <Link href="/(tabs)/groups">
              <Text className="font-semibold text-red-500 dark:text-red-300">Open groups</Text>
            </Link>
          </View>
        )}
      </ScrollView>
    </View>
  );
};

export default MapScreen;
