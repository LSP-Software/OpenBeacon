import { ViewAnnotation, type ViewAnnotationRef } from "@maplibre/maplibre-react-native";
import { useEffect, useRef } from "react";
import { Platform, View } from "react-native";
import { useTheme } from "../../providers/ThemeProvider.tsx";
import { refreshViewAnnotation } from "../map/refreshViewAnnotation.ts";
import { Text } from "../ui/Text.tsx";

export const TimelinePlaceLabel = ({
  emoji,
  id,
  latitude,
  longitude,
  name,
  stopLabel,
}: {
  emoji: string;
  id: string;
  latitude: number;
  longitude: number;
  name: string;
  stopLabel: string | null;
}) => {
  const annotationRef = useRef<ViewAnnotationRef>(null);
  const { appTheme } = useTheme();
  const accessibilityLabel = `Stopped at ${name}${stopLabel ? `, ${stopLabel}` : ""}`;

  // biome-ignore lint/correctness/useExhaustiveDependencies: Android draws ViewAnnotation children into a bitmap that needs an explicit refresh when the label changes
  useEffect(() => {
    refreshViewAnnotation(annotationRef);
  }, [emoji, name, stopLabel]);

  return (
    <ViewAnnotation
      key={appTheme}
      ref={annotationRef}
      id={`timeline-place:${id}`}
      lngLat={[longitude, latitude]}
      anchor="bottom"
      {...(Platform.OS === "ios" ? { title: accessibilityLabel } : {})}
    >
      <View
        {...(Platform.OS === "ios"
          ? { accessible: true, accessibilityLabel }
          : { importantForAccessibility: "no-hide-descendants" as const })}
        collapsable={false}
        style={{ paddingBottom: 30 }}
      >
        <View
          className={`flex-row items-center gap-1 rounded-full border border-border bg-card px-2.5 py-1 ${Platform.OS === "ios" ? "shadow-sm shadow-black/10" : ""}`}
        >
          <Text className="text-xs">{emoji}</Text>
          <Text className="text-xs font-semibold text-foreground" numberOfLines={1}>
            {name}
            {stopLabel ? (
              <Text className="text-xs font-normal text-secondary"> · {stopLabel}</Text>
            ) : null}
          </Text>
        </View>
      </View>
    </ViewAnnotation>
  );
};
