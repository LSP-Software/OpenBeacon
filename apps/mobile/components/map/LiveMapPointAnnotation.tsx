import { Marker, ViewAnnotation, type ViewAnnotationRef } from "@maplibre/maplibre-react-native";
import { useEffect, useRef } from "react";
import { Platform, Pressable } from "react-native";
import { useSelfDeviceHeading } from "../../hooks/useSelfDeviceHeading.ts";
import type { LiveMapMarker } from "../../lib/buildLiveMapMarkers.ts";
import type { LiveMapPinOffset } from "../../lib/liveMapPinGroups.ts";
import { LiveMapMarkerPin } from "./LiveMapMarkerPin.tsx";
import { LiveMapPinMotion } from "./LiveMapPinMotion.tsx";

export const SelfLiveMapPointAnnotation = ({
  arrival,
  gatherTo,
  marker,
  onDeselected,
  onSelected,
}: {
  arrival?: LiveMapPinOffset | undefined;
  gatherTo?: LiveMapPinOffset | undefined;
  marker: LiveMapMarker;
  onDeselected: () => void;
  onSelected: () => void;
}) => {
  const headingDegrees = useSelfDeviceHeading(true);

  return (
    <LiveMapPointAnnotation
      arrival={arrival}
      gatherTo={gatherTo}
      headingDegrees={headingDegrees}
      marker={marker}
      onDeselected={onDeselected}
      onSelected={onSelected}
    />
  );
};

export const LiveMapPointAnnotation = ({
  arrival,
  gatherTo,
  headingDegrees,
  marker,
  onDeselected,
  onSelected,
}: {
  arrival?: LiveMapPinOffset | undefined;
  gatherTo?: LiveMapPinOffset | undefined;
  headingDegrees: number | null;
  marker: LiveMapMarker;
  onDeselected: () => void;
  onSelected: () => void;
}) => {
  const annotationRef = useRef<ViewAnnotationRef>(null);

  useEffect(() => {
    // Android PointAnnotation bitmaps need an explicit refresh when chrome or heading changes
    annotationRef.current?.refresh();
  }, [headingDegrees, marker.image, marker.initials, marker.ringColor, marker.ringColors]);

  if (Platform.OS === "android") {
    return (
      <Marker lngLat={[marker.longitude, marker.latitude]}>
        <Pressable
          onPress={onSelected}
          accessibilityRole="button"
          accessibilityLabel={marker.name}
          style={{ alignSelf: "flex-start" }}
        >
          <LiveMapPinMotion arrival={arrival} gatherTo={gatherTo}>
            <LiveMapMarkerPin
              headingDegrees={headingDegrees}
              image={marker.image}
              initials={marker.initials}
              name={marker.name}
              ringColor={marker.ringColor}
              ringColors={marker.ringColors}
              timestamp={marker.timestamp}
            />
          </LiveMapPinMotion>
        </Pressable>
      </Marker>
    );
  }

  return (
    <ViewAnnotation
      ref={annotationRef}
      id={marker.userId}
      lngLat={[marker.longitude, marker.latitude]}
      anchor="center"
      onDeselect={onDeselected}
      onSelect={onSelected}
    >
      <LiveMapPinMotion arrival={arrival} gatherTo={gatherTo}>
        <LiveMapMarkerPin
          headingDegrees={headingDegrees}
          image={marker.image}
          initials={marker.initials}
          name={marker.name}
          ringColor={marker.ringColor}
          ringColors={marker.ringColors}
          timestamp={marker.timestamp}
          onBitmapContentChange={() => {
            annotationRef.current?.refresh();
          }}
        />
      </LiveMapPinMotion>
    </ViewAnnotation>
  );
};
