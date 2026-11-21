import { ViewAnnotation, type ViewAnnotationRef } from "@maplibre/maplibre-react-native";
import { useEffect, useRef } from "react";
import { Platform, View } from "react-native";
import { useLocationStale } from "../../hooks/useLocationStale.ts";
import { useSelfDeviceHeading } from "../../hooks/useSelfDeviceHeading.ts";
import type { LiveMapMarker } from "../../lib/buildLiveMapMarkers.ts";
import type { LiveMapPinOffset } from "../../lib/liveMapPinGroups.ts";
import { useTheme } from "../../providers/ThemeProvider.tsx";
import { LiveMapMarkerPin } from "./LiveMapMarkerPin.tsx";
import { LiveMapPinMotion } from "./LiveMapPinMotion.tsx";

export const SelfLiveMapPointAnnotation = ({
  arrival,
  gatherTo,
  marker,
  onSelected,
}: {
  arrival?: LiveMapPinOffset | undefined;
  gatherTo?: LiveMapPinOffset | undefined;
  marker: LiveMapMarker;
  onSelected: () => void;
}) => {
  const headingDegrees = useSelfDeviceHeading(true);

  return (
    <LiveMapPointAnnotation
      arrival={arrival}
      gatherTo={gatherTo}
      headingDegrees={headingDegrees}
      marker={marker}
      onSelected={onSelected}
    />
  );
};

export const LiveMapPointAnnotation = ({
  arrival,
  gatherTo,
  headingDegrees,
  marker,
  onSelected,
}: {
  arrival?: LiveMapPinOffset | undefined;
  gatherTo?: LiveMapPinOffset | undefined;
  headingDegrees: number | null;
  marker: LiveMapMarker;
  onSelected: () => void;
}) => {
  const annotationRef = useRef<ViewAnnotationRef>(null);
  const isStale = useLocationStale(marker.timestamp);
  const { appTheme } = useTheme();
  const shownHeadingDegrees =
    Platform.OS === "android" && headingDegrees !== null
      ? Math.round(headingDegrees / 5) * 5
      : headingDegrees;
  const accessibilityLabel = [
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
  ].join(", ");

  // biome-ignore lint/correctness/useExhaustiveDependencies: Android draws ViewAnnotation children into a bitmap that needs an explicit refresh when the pin's look changes
  useEffect(() => {
    annotationRef.current?.refresh();
  }, [
    appTheme,
    shownHeadingDegrees,
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
      onPress={onSelected}
      {...(Platform.OS === "ios" ? { title: accessibilityLabel } : {})}
    >
      <View
        {...(Platform.OS === "ios"
          ? { accessible: true, accessibilityRole: "button" as const, accessibilityLabel }
          : { importantForAccessibility: "no-hide-descendants" as const })}
        collapsable={false}
        style={{ padding: 4 }}
      >
        <LiveMapPinMotion arrival={arrival} gatherTo={gatherTo}>
          <LiveMapMarkerPin
            deviceCount={marker.mergedDeviceIds?.length}
            deviceIcon={marker.deviceIcon}
            devicePlatform={marker.devicePlatform}
            hasUnreadableUpdate={marker.unreadableGroup !== undefined}
            headingDegrees={shownHeadingDegrees}
            image={marker.image}
            initials={marker.initials}
            name={marker.name}
            ringColor={marker.ringColor}
            ringColors={marker.ringColors}
            timestamp={marker.timestamp}
            onBitmapContentChange={() => annotationRef.current?.refresh()}
          />
        </LiveMapPinMotion>
      </View>
    </ViewAnnotation>
  );
};
