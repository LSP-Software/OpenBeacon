import { ViewAnnotation, type ViewAnnotationRef } from "@maplibre/maplibre-react-native";
import { useEffect, useRef } from "react";
import { Platform, View } from "react-native";
import { useLocationStale } from "../../hooks/useLocationStale.ts";
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
  const isStale = useLocationStale(marker.timestamp);

  // biome-ignore lint/correctness/useExhaustiveDependencies: Android draws ViewAnnotation children into a bitmap that needs an explicit refresh when the pin's look changes
  useEffect(() => {
    annotationRef.current?.refresh();
  }, [
    headingDegrees,
    marker.deviceIcon,
    marker.devicePlatform,
    marker.mergedDeviceIds?.length,
    marker.image,
    marker.initials,
    marker.ringColor,
    marker.ringColors,
    marker.unreadableGroup,
  ]);

  return (
    <ViewAnnotation
      ref={annotationRef}
      id={marker.deviceId}
      lngLat={[marker.longitude, marker.latitude]}
      anchor="center"
      {...(Platform.OS === "android"
        ? { onPress: () => onSelected() }
        : { onDeselect: onDeselected, onSelect: () => onSelected() })}
    >
      <View
        accessible
        accessibilityRole="button"
        accessibilityLabel={[
          marker.name,
          ...(marker.mergedDeviceIds && marker.mergedDeviceIds.length > 1
            ? [`${marker.mergedDeviceIds.length} devices here`]
            : marker.deviceName
              ? [marker.deviceName]
              : []),
          ...(marker.unreadableGroup !== undefined
            ? ["Newer location can’t be read"]
            : isStale
              ? ["Location is over 10 minutes old"]
              : []),
        ].join(", ")}
        collapsable={false}
      >
        <LiveMapPinMotion arrival={arrival} gatherTo={gatherTo}>
          <LiveMapMarkerPin
            deviceCount={marker.mergedDeviceIds?.length}
            deviceIcon={marker.deviceIcon}
            devicePlatform={marker.devicePlatform}
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
      </View>
    </ViewAnnotation>
  );
};
