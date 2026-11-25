import type { DrivingEvent } from "@openbeacon/encryption";
import {
  GeoJSONSource,
  Layer,
  ViewAnnotation,
  type ViewAnnotationRef,
} from "@maplibre/maplibre-react-native";
import { useEffect, useRef } from "react";
import { Platform, View } from "react-native";
import { useColors } from "../../lib/theme.ts";
import type { Coordinate } from "../../lib/timelineTypes.ts";
import { useTheme } from "../../providers/ThemeProvider.tsx";
import { refreshViewAnnotation } from "../map/refreshViewAnnotation.ts";
import { DRIVING_EVENT_LOOK, DrivingEventIcon } from "./DriveBadges.tsx";

export const TimelineDriveLayers = ({
  dotted,
  driveId,
  events,
  path,
}: {
  dotted: boolean;
  driveId: string;
  events: readonly DrivingEvent[];
  path: readonly Coordinate[];
}) => {
  const colors = useColors();
  const { appTheme } = useTheme();
  return (
    <>
      {path.length >= 2 ? (
        <GeoJSONSource
          id="timeline-drive"
          data={JSON.stringify({
            type: "Feature",
            properties: {},
            geometry: { type: "LineString", coordinates: path },
          })}
        >
          <Layer
            id="timeline-drive-casing"
            type="line"
            beforeId="timeline-arrow-lines"
            layout={{ "line-cap": "round", "line-join": "round" }}
            paint={{ "line-color": colors.background, "line-width": 10 }}
          />
          <Layer
            id="timeline-drive-line"
            type="line"
            beforeId="timeline-arrow-lines"
            layout={{ "line-cap": "round", "line-join": "round" }}
            paint={{
              "line-color": colors.text,
              "line-width": 6,
              "line-dasharray": dotted ? [0.5, 1.5] : [1, 0],
            }}
          />
        </GeoJSONSource>
      ) : null}
      {events.map((event) => (
        <DrivingEventMarker
          key={`${appTheme}:${driveId}:${event.type}:${event.timeOffset}`}
          driveId={driveId}
          event={event}
        />
      ))}
    </>
  );
};

const DrivingEventMarker = ({ driveId, event }: { driveId: string; event: DrivingEvent }) => {
  const annotationRef = useRef<ViewAnnotationRef>(null);
  const label = DRIVING_EVENT_LOOK[event.type].label;

  useEffect(() => {
    refreshViewAnnotation(annotationRef);
  }, []);

  return (
    <ViewAnnotation
      ref={annotationRef}
      id={`timeline-drive-event:${driveId}:${event.type}:${event.timeOffset}`}
      lngLat={[event.longitude, event.latitude]}
      anchor="center"
      {...(Platform.OS === "ios" ? { title: label } : {})}
    >
      <View
        collapsable={false}
        {...(Platform.OS === "ios"
          ? { accessible: true, accessibilityLabel: label }
          : { importantForAccessibility: "no-hide-descendants" as const })}
      >
        <DrivingEventIcon size={30} type={event.type} />
      </View>
    </ViewAnnotation>
  );
};
