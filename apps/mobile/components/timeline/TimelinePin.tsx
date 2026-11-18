import { Marker, ViewAnnotation, type ViewAnnotationRef } from "@maplibre/maplibre-react-native";
import { useEffect, useRef } from "react";
import { Platform, View } from "react-native";
import { LiveMapMarkerPin } from "../map/LiveMapMarkerPin.tsx";

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

  // biome-ignore lint/correctness/useExhaustiveDependencies: iOS ViewAnnotation bitmaps need an explicit refresh when the pin's look changes
  useEffect(() => {
    annotationRef.current?.refresh();
  }, [paused, image, color]);

  const pin = (
    <LiveMapMarkerPin
      fillColor={color}
      image={image}
      initials={initials}
      name={name}
      ringColor={color}
      status={paused ? "paused" : null}
      timestamp={null}
      onBitmapContentChange={() => annotationRef.current?.refresh()}
    />
  );

  if (Platform.OS === "android") {
    return (
      <Marker lngLat={[longitude, latitude]}>
        <View
          accessible
          accessibilityLabel={paused ? `${name}, sharing paused` : name}
          style={{ alignSelf: "flex-start" }}
        >
          {pin}
        </View>
      </Marker>
    );
  }

  return (
    <ViewAnnotation
      ref={annotationRef}
      id={`timeline-pin:${id}`}
      lngLat={[longitude, latitude]}
      anchor="center"
    >
      {pin}
    </ViewAnnotation>
  );
};
