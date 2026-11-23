import { ViewAnnotation, type ViewAnnotationRef } from "@maplibre/maplibre-react-native";
import { useEffect, useRef, useState } from "react";
import { Platform, View } from "react-native";
import { scheduleOnRN } from "react-native-worklets";
import Animated, {
  type SharedValue,
  useAnimatedProps,
  useAnimatedReaction,
  useSharedValue,
} from "react-native-reanimated";
import {
  type TimelineTrack,
  timelineTrackCoordinateAt,
  timelineTrackSegmentAt,
} from "../../lib/timelineTrack.ts";
import { useTheme } from "../../providers/ThemeProvider.tsx";
import { LiveMapMarkerPin } from "../map/LiveMapMarkerPin.tsx";
import { refreshViewAnnotation } from "../map/refreshViewAnnotation.ts";

const AnimatedViewAnnotation = Animated.createAnimatedComponent(ViewAnnotation);

export const TimelinePin = ({
  color,
  id,
  image,
  initials,
  latitude,
  longitude,
  name,
  onFollow,
  paused,
  time,
  track,
}: {
  color: string;
  id: string;
  image: string | null;
  initials: string;
  latitude: number;
  longitude: number;
  name: string;
  onFollow: ((longitude: number, latitude: number) => void) | undefined;
  paused: boolean;
  time: SharedValue<number>;
  track: TimelineTrack;
}) => {
  const annotationRef = useRef<ViewAnnotationRef>(null);
  const { appTheme } = useTheme();
  const accessibilityLabel = paused ? `${name}, sharing paused` : name;
  const [mountedAt] = useState<[number, number]>(() => [longitude, latitude]);
  const position = useSharedValue<[number, number]>(mountedAt);
  const onFollowRef = useRef(onFollow);
  onFollowRef.current = onFollow;
  const followed = onFollow !== undefined;
  const moveWithCamera = (longitude: number, latitude: number) => {
    onFollowRef.current?.(longitude, latitude);
    position.value = [longitude, latitude];
  };

  useAnimatedReaction(
    () => {
      const index = timelineTrackSegmentAt(track, time.value);
      return index === -1 ? null : timelineTrackCoordinateAt(track, index, time.value);
    },
    (next) => {
      if (!next || Number.isNaN(next[0]) || Number.isNaN(next[1])) return;
      const [currentLongitude, currentLatitude] = position.value;
      if (next[0] === currentLongitude && next[1] === currentLatitude) return;
      if (followed) scheduleOnRN(moveWithCamera, next[0], next[1]);
      else position.value = next;
    },
    [followed, track],
  );
  const animatedProps = useAnimatedProps(() => ({ lngLat: position.value }));

  // biome-ignore lint/correctness/useExhaustiveDependencies: Android draws ViewAnnotation children into a bitmap that needs an explicit refresh when the pin's look changes
  useEffect(() => {
    refreshViewAnnotation(annotationRef);
  }, [appTheme, paused, image, initials, color]);

  return (
    <AnimatedViewAnnotation
      ref={annotationRef}
      animatedProps={animatedProps}
      id={`timeline-pin:${id}`}
      lngLat={mountedAt}
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
    </AnimatedViewAnnotation>
  );
};
