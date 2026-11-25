import { ViewAnnotation, type ViewAnnotationRef } from "@maplibre/maplibre-react-native";
import { TriangleAlertIcon } from "lucide-react-native";
import { useEffect, useRef } from "react";
import { Platform, View } from "react-native";
import { refreshViewAnnotation } from "./refreshViewAnnotation.ts";

export const CrashSpotAnnotation = ({
  latitude,
  longitude,
  name,
}: {
  latitude: number;
  longitude: number;
  name: string;
}) => {
  const annotationRef = useRef<ViewAnnotationRef>(null);
  const accessibilityLabel = `Where ${name}’s possible crash happened`;

  useEffect(() => {
    refreshViewAnnotation(annotationRef);
  }, []);

  return (
    <ViewAnnotation
      ref={annotationRef}
      id="crash-spot"
      lngLat={[longitude, latitude]}
      anchor="center"
      draggable={false}
      {...(Platform.OS === "ios" ? { title: accessibilityLabel } : {})}
    >
      <View
        {...(Platform.OS === "ios"
          ? { accessible: true, accessibilityLabel }
          : { importantForAccessibility: "no-hide-descendants" as const })}
        collapsable={false}
        className="size-12 items-center justify-center"
        pointerEvents="none"
      >
        <View
          className="size-9 items-center justify-center rounded-lg border-[3px] border-white"
          style={{ backgroundColor: "#B3261E", transform: [{ rotate: "45deg" }] }}
        >
          <View style={{ transform: [{ rotate: "-45deg" }] }}>
            <TriangleAlertIcon size={18} color="#FFFFFF" />
          </View>
        </View>
      </View>
    </ViewAnnotation>
  );
};
