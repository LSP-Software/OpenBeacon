import { ViewAnnotation, type ViewAnnotationRef } from "@maplibre/maplibre-react-native";
import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import type { MapPlace } from "../../lib/places.ts";
import { PlacePin } from "./PlacePin.tsx";

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

  // biome-ignore lint/correctness/useExhaustiveDependencies: Android draws ViewAnnotation children into a bitmap that needs an explicit refresh when the pin changes
  useEffect(() => {
    annotationRef.current?.refresh();
  }, [place.emoji, selected]);

  return (
    <ViewAnnotation
      ref={annotationRef}
      id={`place:${place.groupId}:${place.id}`}
      lngLat={[place.longitude, place.latitude]}
      anchor="bottom"
      draggable={false}
      {...(Platform.OS === "android"
        ? { onPress: () => onSelected() }
        : { onSelect: () => onSelected() })}
    >
      <PlacePin emoji={place.emoji} selected={selected} />
    </ViewAnnotation>
  );
};
