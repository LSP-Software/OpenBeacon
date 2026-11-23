import { ViewAnnotation, type ViewAnnotationRef } from "@maplibre/maplibre-react-native";
import { useEffect, useRef } from "react";
import { View } from "react-native";
import type { LiveMapMarker } from "../../lib/buildLiveMapMarkers.ts";
import type { LiveMapPinGlide } from "../../lib/liveMapPinGlide.ts";
import { useTheme } from "../../providers/ThemeProvider.tsx";
import { Text } from "../ui/Text.tsx";
import { refreshViewAnnotation } from "./refreshViewAnnotation.ts";
import { useLiveMapPinPosition } from "./useLiveMapPinPosition.ts";

export const LiveMapSpeedChipAnnotation = ({
  getZoom,
  glides,
  label,
  marker,
}: {
  getZoom: () => number;
  glides: ReadonlyMap<string, LiveMapPinGlide>;
  label: string;
  marker: LiveMapMarker;
}) => {
  const annotationRef = useRef<ViewAnnotationRef>(null);
  const shown = useLiveMapPinPosition({
    base: marker,
    deviceIds: [marker.deviceId],
    getZoom,
    glides,
  });
  const { appTheme } = useTheme();

  // biome-ignore lint/correctness/useExhaustiveDependencies: Android draws ViewAnnotation children into a bitmap that needs an explicit refresh when the label changes
  useEffect(() => {
    refreshViewAnnotation(annotationRef);
  }, [label]);

  return (
    <ViewAnnotation
      key={appTheme}
      ref={annotationRef}
      id={`speed:${marker.deviceId}`}
      lngLat={[shown.longitude, shown.latitude]}
      anchor="top"
      offset={[0, 24]}
    >
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        collapsable={false}
        pointerEvents="none"
        style={{ padding: 2 }}
      >
        <View
          collapsable={false}
          className="min-h-[22px] items-center justify-center rounded-full border border-border bg-card px-2 py-[3px]"
        >
          <Text
            className="text-[12px] font-semibold leading-[14px] text-foreground"
            maxFontSizeMultiplier={1.2}
            numberOfLines={1}
          >
            {label}
          </Text>
        </View>
      </View>
    </ViewAnnotation>
  );
};
