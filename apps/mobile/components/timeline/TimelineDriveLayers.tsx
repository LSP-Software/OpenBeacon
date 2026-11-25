import type { DrivingEvent } from "@openbeacon/encryption";
import { GeoJSONSource, Layer, ViewAnnotation } from "@maplibre/maplibre-react-native";
import { Platform, View } from "react-native";
import { useColors } from "../../lib/theme.ts";
import type { Coordinate } from "../../lib/timelineTypes.ts";
import { useTheme } from "../../providers/ThemeProvider.tsx";
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
            layout={{ "line-cap": "round", "line-join": "round" }}
            paint={{ "line-color": colors.background, "line-width": 10 }}
          />
          <Layer
            id="timeline-drive-line"
            type="line"
            layout={{ "line-cap": "round", "line-join": "round" }}
            paint={{
              "line-color": colors.text,
              "line-width": 6,
              ...(dotted ? { "line-dasharray": [0.5, 1.5] } : {}),
            }}
          />
        </GeoJSONSource>
      ) : null}
      {events.map((event) => (
        <ViewAnnotation
          key={`${appTheme}:${driveId}:${event.type}:${event.timeOffset}`}
          id={`timeline-drive-event:${driveId}:${event.type}:${event.timeOffset}`}
          lngLat={[event.longitude, event.latitude]}
          anchor="center"
          {...(Platform.OS === "ios" ? { title: DRIVING_EVENT_LOOK[event.type].label } : {})}
        >
          <View
            collapsable={false}
            {...(Platform.OS === "ios"
              ? {
                  accessible: true,
                  accessibilityLabel: DRIVING_EVENT_LOOK[event.type].label,
                }
              : { importantForAccessibility: "no-hide-descendants" as const })}
          >
            <DrivingEventIcon size={30} type={event.type} />
          </View>
        </ViewAnnotation>
      ))}
    </>
  );
};
