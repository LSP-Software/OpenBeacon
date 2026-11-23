import { ViewAnnotation, type ViewAnnotationRef } from "@maplibre/maplibre-react-native";
import { useEffect, useRef } from "react";
import { Platform, View } from "react-native";
import type { LiveMapMarker } from "../../lib/buildLiveMapMarkers.ts";
import type { LiveMapPinGroup, LiveMapPinOffset } from "../../lib/liveMapPinGroups.ts";
import type { LiveMapPinGlide } from "../../lib/liveMapPinGlide.ts";
import { useTheme } from "../../providers/ThemeProvider.tsx";
import { LiveMapPinMotion } from "./LiveMapPinMotion.tsx";
import { LiveMapStackPin } from "./LiveMapStackPin.tsx";
import { refreshViewAnnotation } from "./refreshViewAnnotation.ts";
import { useLiveMapPinPosition } from "./useLiveMapPinPosition.ts";

export const LiveMapStackAnnotation = ({
  arrival,
  getZoom,
  glides,
  group,
  members,
  onPress,
}: {
  arrival: LiveMapPinOffset | undefined;
  getZoom: () => number;
  glides: ReadonlyMap<string, LiveMapPinGlide>;
  group: LiveMapPinGroup;
  members: readonly LiveMapMarker[];
  onPress: () => void;
}) => {
  const annotationRef = useRef<ViewAnnotationRef>(null);
  const shown = useLiveMapPinPosition({
    base: group,
    deviceIds: group.members.map((member) => member.deviceId),
    getZoom,
    glides,
  });
  const { appTheme } = useTheme();
  const accessibilityLabel = `${members.length} people: ${members.map((member) => member.name).join(", ")}`;
  const drawnMembers = members
    .map((member) =>
      [
        member.deviceId,
        member.image,
        member.initials,
        member.ringColor,
        member.ringColors?.join(" "),
        member.unreadableGroup !== undefined,
      ].join(","),
    )
    .join("|");

  // biome-ignore lint/correctness/useExhaustiveDependencies: Android draws ViewAnnotation children into a bitmap that needs an explicit refresh when the stack's look changes
  useEffect(() => {
    refreshViewAnnotation(annotationRef);
  }, [appTheme, drawnMembers]);

  return (
    <ViewAnnotation
      ref={annotationRef}
      id={group.id}
      lngLat={[shown.longitude, shown.latitude]}
      anchor="center"
      onPress={onPress}
      {...(Platform.OS === "ios" ? { title: accessibilityLabel } : {})}
    >
      <View
        {...(Platform.OS === "ios"
          ? { accessible: true, accessibilityRole: "button" as const, accessibilityLabel }
          : { importantForAccessibility: "no-hide-descendants" as const })}
        collapsable={false}
        style={{ paddingHorizontal: 6, paddingVertical: 4 }}
      >
        <LiveMapPinMotion arrival={arrival}>
          <LiveMapStackPin
            members={members}
            onBitmapContentChange={() => refreshViewAnnotation(annotationRef)}
          />
        </LiveMapPinMotion>
      </View>
    </ViewAnnotation>
  );
};
