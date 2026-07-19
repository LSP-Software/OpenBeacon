import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { NativeMap } from "../../../components/map/NativeMap.tsx";
import { useMapLivePositions } from "../../../hooks/useMapLivePositions.ts";
import { useMembershipSnapshot } from "../../../hooks/useMembershipSnapshot.ts";
import { useSelfDeviceLocation } from "../../../hooks/useSelfDeviceLocation.ts";
import { trpc } from "../../../lib/api.ts";
import { applySelfDeviceLocation } from "../../../lib/applySelfDeviceLocation.ts";
import { authClient } from "../../../lib/auth-client.ts";
import { buildLiveMapMarkers } from "../../../lib/buildLiveMapMarkers.ts";
import { getGroupColor } from "../../../lib/groupColor.ts";
import { nextMapMarkerSelection } from "../../../lib/mapMarkerSelection.ts";
import { TAB_BAR_CONTENT_HEIGHT } from "../../../lib/tabBarLayout.ts";

const MapScreen = () => {
  const insets = useSafeAreaInsets();
  const livePositions = useMapLivePositions();
  const { data: session } = authClient.useSession();
  const { data: groupsQueryData } = useQuery(trpc.groupMembership.list.queryOptions());
  const groups = useMembershipSnapshot(groupsQueryData);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const selfUserId = session?.user.id ?? "";
  const selfDeviceLocation = useSelfDeviceLocation(selfUserId.length > 0);

  const selfFallback = useMemo(() => {
    if (!selfUserId || !groups || groups.length === 0) {
      return null;
    }

    const memberships = groups.filter((group) =>
      group.members.some((member) => member.userId === selfUserId),
    );
    const primaryGroup = memberships[0];
    if (!primaryGroup) {
      return null;
    }

    const selfMember = primaryGroup.members.find((member) => member.userId === selfUserId);
    if (!selfMember) {
      return null;
    }

    return {
      image: selfMember.image,
      name: selfMember.name,
      otherSharedGroupNames: memberships.slice(1).map((group) => group.name),
      ringColor: getGroupColor(primaryGroup.id),
      sourceGroupId: primaryGroup.id,
    };
  }, [groups, selfUserId]);

  const markers = useMemo(() => {
    if (!selfUserId || !groups) {
      return [];
    }

    return applySelfDeviceLocation({
      markers: buildLiveMapMarkers({
        getGroupColor,
        groups,
        positions: livePositions,
        selfUserId,
      }),
      selfDeviceLocation,
      selfFallback,
      selfUserId,
    });
  }, [groups, livePositions, selfDeviceLocation, selfFallback, selfUserId]);

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
    </View>
  );
};

export default MapScreen;
