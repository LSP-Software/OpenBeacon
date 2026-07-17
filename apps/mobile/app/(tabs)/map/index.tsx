import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { NativeMap } from "../../../components/map/NativeMap.tsx";
import { useMapLivePositions } from "../../../hooks/useMapLivePositions.ts";
import { trpc } from "../../../lib/api.ts";
import { authClient } from "../../../lib/auth-client.ts";
import { buildLiveMapMarkers } from "../../../lib/buildLiveMapMarkers.ts";
import { getGroupColor } from "../../../lib/groupColor.ts";
import { nextMapMarkerSelection } from "../../../lib/mapMarkerSelection.ts";

export default function MapScreen() {
  const livePositions = useMapLivePositions();
  const { data: session } = authClient.useSession();
  const { data: groups } = useQuery(trpc.groupMembership.list.queryOptions());
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const selfUserId = session?.user.id ?? "";

  const markers =
    selfUserId.length === 0
      ? []
      : buildLiveMapMarkers({
          getGroupColor,
          groups: groups ?? [],
          positions: livePositions,
          selfUserId,
        });

  useEffect(() => {
    if (selectedUserId && !markers.some((marker) => marker.userId === selectedUserId)) {
      setSelectedUserId(null);
    }
  }, [markers, selectedUserId]);

  return (
    <View className="flex-1 bg-background">
      <NativeMap
        markers={markers}
        selectedUserId={selectedUserId}
        onSelectUserId={(userId) => {
          setSelectedUserId((current) => nextMapMarkerSelection(current, userId));
        }}
      />
    </View>
  );
}
