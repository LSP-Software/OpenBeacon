import { ViewAnnotation, type ViewAnnotationRef } from "@maplibre/maplibre-react-native";
import { useEffect, useRef } from "react";
import { Platform, View } from "react-native";
import type { MapPlace } from "../../lib/places.ts";
import { useTheme } from "../../providers/ThemeProvider.tsx";
import { PlacePin } from "./PlacePin.tsx";
import { refreshViewAnnotation } from "./refreshViewAnnotation.ts";

export const PlaceAnnotation = ({
  onSelected,
  place,
  selected,
}: {
  onSelected: () => void;
  place: MapPlace;
  selected: boolean;
}) => {
  const annotationRef = useRef<ViewAnnotationRef>(null);
  const { appTheme } = useTheme();
  const accessibilityLabel = `${place.name}, ${place.groupName}`;

  // biome-ignore lint/correctness/useExhaustiveDependencies: Android draws ViewAnnotation children into a bitmap that needs an explicit refresh when the pin changes
  useEffect(() => {
    refreshViewAnnotation(annotationRef);
  }, [appTheme, place.emoji, selected]);

  return (
    <ViewAnnotation
      ref={annotationRef}
      id={`place:${place.groupId}:${place.id}`}
      lngLat={[place.longitude, place.latitude]}
      anchor="bottom"
      draggable={false}
      onPress={onSelected}
      {...(Platform.OS === "ios" ? { title: accessibilityLabel } : {})}
    >
      <View
        {...(Platform.OS === "ios"
          ? { accessible: true, accessibilityRole: "button" as const, accessibilityLabel }
          : { importantForAccessibility: "no-hide-descendants" as const })}
        collapsable={false}
      >
        <PlacePin
          drawnAsBitmap={Platform.OS === "android"}
          emoji={place.emoji}
          selected={selected}
        />
      </View>
    </ViewAnnotation>
  );
};
