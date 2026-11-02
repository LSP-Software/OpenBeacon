import {
  MarkerView,
  PointAnnotation,
  type PointAnnotationRef,
} from "@maplibre/maplibre-react-native";
import { useEffect, useRef } from "react";
import { Platform, Pressable } from "react-native";
import { useSelfDeviceHeading } from "../../hooks/useSelfDeviceHeading.ts";
import type { LiveMapMarker } from "../../lib/buildLiveMapMarkers.ts";
import { LiveMapMarkerPin } from "./LiveMapMarkerPin.tsx";

export const SelfLiveMapPointAnnotation = ({
  marker,
  onDeselected,
  onSelected,
}: {
  marker: LiveMapMarker;
  onDeselected: () => void;
  onSelected: () => void;
}) => {
  const headingDegrees = useSelfDeviceHeading(true);

  return (
    <LiveMapPointAnnotation
      headingDegrees={headingDegrees}
      marker={marker}
      onDeselected={onDeselected}
      onSelected={onSelected}
    />
  );
};

export const LiveMapPointAnnotation = ({
  headingDegrees,
  marker,
  onDeselected,
  onSelected,
}: {
  headingDegrees: number | null;
  marker: LiveMapMarker;
  onDeselected: () => void;
  onSelected: () => void;
}) => {
  const annotationRef = useRef<PointAnnotationRef>(null);

  useEffect(() => {
    // Android PointAnnotation bitmaps need an explicit refresh when chrome or heading changes
    annotationRef.current?.refresh();
  }, [headingDegrees, marker.image, marker.initials, marker.ringColor]);

  if (Platform.OS === "android") {
    return (
      <MarkerView coordinate={[marker.longitude, marker.latitude]} allowOverlap>
        <Pressable
          onPress={onSelected}
          accessibilityRole="button"
          accessibilityLabel={marker.name}
          style={{ alignSelf: "flex-start" }}
        >
          <LiveMapMarkerPin
            headingDegrees={headingDegrees}
            image={marker.image}
            initials={marker.initials}
            name={marker.name}
            ringColor={marker.ringColor}
          />
        </Pressable>
      </MarkerView>
    );
  }

  return (
    <PointAnnotation
      ref={annotationRef}
      id={marker.userId}
      coordinate={[marker.longitude, marker.latitude]}
      anchor={{ x: 0.5, y: 0.5 }}
      onDeselected={onDeselected}
      onSelected={onSelected}
    >
      <LiveMapMarkerPin
        headingDegrees={headingDegrees}
        image={marker.image}
        initials={marker.initials}
        name={marker.name}
        ringColor={marker.ringColor}
        onBitmapContentChange={() => {
          annotationRef.current?.refresh();
        }}
      />
    </PointAnnotation>
  );
};
