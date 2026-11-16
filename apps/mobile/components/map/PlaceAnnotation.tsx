import { Marker, ViewAnnotation, type ViewAnnotationRef } from "@maplibre/maplibre-react-native";
import { useEffect, useRef } from "react";
import { type GestureResponderEvent, Platform, Pressable } from "react-native";
import type { MapPlace } from "../../lib/places.ts";
import { PlacePin } from "./PlacePin.tsx";

export const PlaceAnnotation = ({
  onSelected,
  place,
  selected,
}: {
  onSelected: (event?: GestureResponderEvent) => void;
  place: MapPlace;
  selected: boolean;
}) => {
  const annotationRef = useRef<ViewAnnotationRef>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: iOS ViewAnnotation bitmaps need an explicit refresh when the pin changes
  useEffect(() => {
    annotationRef.current?.refresh();
  }, [place.emoji, selected]);

  if (Platform.OS === "android") {
    return (
      <Marker lngLat={[place.longitude, place.latitude]} anchor="bottom">
        <Pressable
          onPress={onSelected}
          accessibilityRole="button"
          accessibilityLabel={`${place.name}, ${place.groupName}`}
          style={{ alignSelf: "flex-start" }}
        >
          <PlacePin emoji={place.emoji} selected={selected} />
        </Pressable>
      </Marker>
    );
  }

  return (
    <ViewAnnotation
      ref={annotationRef}
      id={`place:${place.groupId}:${place.id}`}
      lngLat={[place.longitude, place.latitude]}
      anchor="bottom"
      draggable={false}
      onSelect={() => onSelected()}
    >
      <PlacePin emoji={place.emoji} selected={selected} />
    </ViewAnnotation>
  );
};
