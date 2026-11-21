import { ViewAnnotation, type ViewAnnotationRef } from "@maplibre/maplibre-react-native";
import { useEffect, useRef, useState } from "react";
import { Platform, View } from "react-native";
import type { LiveMapMarker } from "../../lib/buildLiveMapMarkers.ts";
import type { LiveMapPinGroup, LiveMapPinOffset } from "../../lib/liveMapPinGroups.ts";
import { useTheme } from "../../providers/ThemeProvider.tsx";
import { LiveMapPinMotion } from "./LiveMapPinMotion.tsx";
import { LiveMapStackPin } from "./LiveMapStackPin.tsx";

export const LiveMapStackAnnotation = ({
  arrival,
  group,
  members,
  onPress,
}: {
  arrival: LiveMapPinOffset | undefined;
  group: LiveMapPinGroup;
  members: readonly LiveMapMarker[];
  onPress: () => void;
}) => {
  const annotationRef = useRef<ViewAnnotationRef>(null);
  const [selectionRevision, setSelectionRevision] = useState(0);
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
    annotationRef.current?.refresh();
  }, [appTheme, drawnMembers]);

  return (
    <ViewAnnotation
      ref={annotationRef}
      key={selectionRevision}
      id={group.id}
      lngLat={[group.longitude, group.latitude]}
      anchor="center"
      {...(Platform.OS === "android"
        ? { onPress }
        : {
            title: accessibilityLabel,
            onSelect: () => {
              onPress();
              // iOS only reports a tap on an unselected annotation, and a stack never stays selected
              setSelectionRevision((current) => current + 1);
            },
          })}
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
            onBitmapContentChange={() => annotationRef.current?.refresh()}
          />
        </LiveMapPinMotion>
      </View>
    </ViewAnnotation>
  );
};
