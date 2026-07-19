import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { NativeMap } from "../../../components/map/NativeMap.tsx";
import { useMapLivePositions } from "../../../hooks/useMapLivePositions.ts";
import { useSelfDeviceLocation } from "../../../hooks/useSelfDeviceLocation.ts";
import { trpc } from "../../../lib/api.ts";
import { applySelfDeviceLocation } from "../../../lib/applySelfDeviceLocation.ts";
import { authClient } from "../../../lib/auth-client.ts";
import { buildLiveMapMarkers } from "../../../lib/buildLiveMapMarkers.ts";
import { getGroupColor } from "../../../lib/groupColor.ts";
import { nextMapMarkerSelection } from "../../../lib/mapMarkerSelection.ts";
import { resolveSelfDeviceLocationFallback } from "../../../lib/resolveSelfDeviceLocationFallback.ts";
import { TAB_BAR_CONTENT_HEIGHT } from "../../../lib/tabBarLayout.ts";

const MapScreen = () => {
  const insets = useSafeAreaInsets();
  const livePositions = useMapLivePositions();
  const { data: session } = authClient.useSession();
  const { data: groups } = useQuery(trpc.groupMembership.list.queryOptions());
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const selfUserId = session?.user.id ?? "";
  const selfDeviceLocation = useSelfDeviceLocation(selfUserId.length > 0);

  const selfFallback = useMemo(
    () =>
      resolveSelfDeviceLocationFallback({
        getGroupColor,
        groups: groups ?? [],
        selfUserId,
      }),
    [groups, selfUserId],
  );

  const markers = useMemo(() => {
    if (!selfUserId) {
      return [];
    }

    return applySelfDeviceLocation({
      markers: buildLiveMapMarkers({
        getGroupColor,
        groups: groups ?? [],
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
