import { Marker, ViewAnnotation } from "@maplibre/maplibre-react-native";
import { useState } from "react";
import { Platform, Pressable } from "react-native";
import type { LiveMapMarker } from "../../lib/buildLiveMapMarkers.ts";
import type { LiveMapPinGroup, LiveMapPinOffset } from "../../lib/liveMapPinGroups.ts";
import { LiveMapPinMotion } from "./LiveMapPinMotion.tsx";
import { LiveMapStackPin } from "./LiveMapStackPin.tsx";

export const LiveMapStackAnnotation = ({
  arrival,
  group,
  members,
  onPress,
}: {
  arrival: LiveMapPinOffset | undefined;
  group: LiveMapPinGroup;
  members: readonly LiveMapMarker[];
  onPress: () => void;
}) => {
  const [selectionRevision, setSelectionRevision] = useState(0);
  const pin = (
    <LiveMapPinMotion arrival={arrival}>
      <LiveMapStackPin members={members} />
    </LiveMapPinMotion>
  );

  if (Platform.OS === "android") {
    return (
      <Marker lngLat={[group.longitude, group.latitude]}>
        <Pressable
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={`${members.length} people: ${members.map((member) => member.name).join(", ")}`}
          style={{ alignSelf: "flex-start" }}
        >
          {pin}
        </Pressable>
      </Marker>
    );
  }

  return (
    <ViewAnnotation
      key={selectionRevision}
      id={group.id}
      lngLat={[group.longitude, group.latitude]}
      anchor="center"
      onSelect={() => {
        onPress();
        // iOS only reports a tap on an unselected annotation, and a stack never stays selected
        setSelectionRevision((current) => current + 1);
      }}
    >
      {pin}
    </ViewAnnotation>
  );
};
