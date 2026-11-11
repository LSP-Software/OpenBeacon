import { Marker, ViewAnnotation, type ViewAnnotationRef } from "@maplibre/maplibre-react-native";
import { useEffect, useRef } from "react";
import { type GestureResponderEvent, Platform, Pressable } from "react-native";
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
  onSelected: (event?: GestureResponderEvent) => void;
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
  onSelected: (event?: GestureResponderEvent) => void;
}) => {
  const annotationRef = useRef<ViewAnnotationRef>(null);

  useEffect(() => {
    // Android PointAnnotation bitmaps need an explicit refresh when chrome or heading changes
    annotationRef.current?.refresh();
  }, [
    headingDegrees,
    marker.deviceIcon,
    marker.mergedDeviceIds?.length,
    marker.image,
    marker.initials,
    marker.ringColor,
    marker.ringColors,
    marker.unreadableGroup,
  ]);

  if (Platform.OS === "android") {
    return (
      <Marker lngLat={[marker.longitude, marker.latitude]}>
        <Pressable
          onPress={onSelected}
          accessibilityRole="button"
          accessibilityLabel={
            marker.mergedDeviceIds && marker.mergedDeviceIds.length > 1
              ? `${marker.name}, ${marker.mergedDeviceIds.length} devices here`
              : marker.deviceName
                ? `${marker.name}, ${marker.deviceName}`
                : marker.name
          }
          style={{ alignSelf: "flex-start" }}
        >
          <LiveMapPinMotion arrival={arrival} gatherTo={gatherTo}>
            <LiveMapMarkerPin
              deviceCount={marker.mergedDeviceIds?.length}
              deviceIcon={marker.deviceIcon}
              hasUnreadableUpdate={marker.unreadableGroup !== undefined}
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
      id={marker.deviceId}
      lngLat={[marker.longitude, marker.latitude]}
      anchor="center"
      onDeselect={onDeselected}
      onSelect={() => onSelected()}
    >
      <LiveMapPinMotion arrival={arrival} gatherTo={gatherTo}>
        <LiveMapMarkerPin
          deviceCount={marker.mergedDeviceIds?.length}
          deviceIcon={marker.deviceIcon}
          hasUnreadableUpdate={marker.unreadableGroup !== undefined}
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
