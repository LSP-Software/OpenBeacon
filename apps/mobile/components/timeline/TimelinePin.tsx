import { ViewAnnotation, type ViewAnnotationRef } from "@maplibre/maplibre-react-native";
import { useEffect, useRef } from "react";
import { Platform, View } from "react-native";
import { useTheme } from "../../providers/ThemeProvider.tsx";
import { LiveMapMarkerPin } from "../map/LiveMapMarkerPin.tsx";
import { refreshViewAnnotation } from "../map/refreshViewAnnotation.ts";

export const TimelinePin = ({
  color,
  id,
  image,
  initials,
  latitude,
  longitude,
  name,
  paused,
}: {
  color: string;
  id: string;
  image: string | null;
  initials: string;
  latitude: number;
  longitude: number;
  name: string;
  paused: boolean;
}) => {
  const annotationRef = useRef<ViewAnnotationRef>(null);
  const { appTheme } = useTheme();
  const accessibilityLabel = paused ? `${name}, sharing paused` : name;

  // biome-ignore lint/correctness/useExhaustiveDependencies: Android draws ViewAnnotation children into a bitmap that needs an explicit refresh when the pin's look changes
  useEffect(() => {
    refreshViewAnnotation(annotationRef);
  }, [appTheme, paused, image, initials, color]);

  return (
    <ViewAnnotation
      ref={annotationRef}
      id={`timeline-pin:${id}`}
      lngLat={[longitude, latitude]}
      anchor="center"
      {...(Platform.OS === "ios" ? { title: accessibilityLabel } : {})}
    >
      <View
        {...(Platform.OS === "ios"
          ? { accessible: true, accessibilityLabel }
          : { importantForAccessibility: "no-hide-descendants" as const })}
        collapsable={false}
        style={{ padding: 4 }}
      >
        <LiveMapMarkerPin
          fillColor={color}
          image={image}
          initials={initials}
          name={name}
          ringColor={color}
          status={paused ? "paused" : null}
          timestamp={null}
          onBitmapContentChange={() => refreshViewAnnotation(annotationRef)}
        />
      </View>
    </ViewAnnotation>
  );
};
