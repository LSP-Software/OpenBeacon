import { ViewAnnotation, type ViewAnnotationRef } from "@maplibre/maplibre-react-native";
import { useRef, useState } from "react";
import { Platform, View } from "react-native";
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
  const annotationRef = useRef<ViewAnnotationRef>(null);
  const [selectionRevision, setSelectionRevision] = useState(0);

  return (
    <ViewAnnotation
      ref={annotationRef}
      key={selectionRevision}
      id={group.id}
      lngLat={[group.longitude, group.latitude]}
      anchor="center"
      {...(Platform.OS === "android"
        ? { onPress: () => onPress() }
        : {
            onSelect: () => {
              onPress();
              // iOS only reports a tap on an unselected annotation, and a stack never stays selected
              setSelectionRevision((current) => current + 1);
            },
          })}
    >
      <View
        accessible
        accessibilityRole="button"
        accessibilityLabel={`${members.length} people: ${members.map((member) => member.name).join(", ")}`}
        collapsable={false}
        style={{ paddingHorizontal: 6, paddingVertical: 4 }}
      >
        <LiveMapPinMotion arrival={arrival}>
          <LiveMapStackPin
            members={members}
            onBitmapContentChange={() => annotationRef.current?.refresh()}
          />
        </LiveMapPinMotion>
      </View>
    </ViewAnnotation>
  );
};
