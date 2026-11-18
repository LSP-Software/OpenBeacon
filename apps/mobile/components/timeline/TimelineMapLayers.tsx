import { GeoJSONSource, Layer } from "@maplibre/maplibre-react-native";
import { memo, useMemo } from "react";
import { timelineRouteGradient } from "../../lib/timelineMap.ts";

type Coordinate = [longitude: number, latitude: number];

export const TimelineMapLayers = memo(
  ({
    drawn,
    routes,
  }: {
    drawn: number;
    routes: ReadonlyArray<{
      color: string;
      deviceId: string;
      gaps: ReadonlyArray<{ from: number; to: number }>;
      line: readonly Coordinate[];
      pauses: ReadonlyArray<readonly [Coordinate, Coordinate]>;
      runs: ReadonlyArray<readonly Coordinate[]>;
      stops: ReadonlyArray<{ latitude: number; longitude: number }>;
    }>;
  }) => {
    const data = useMemo(
      () => ({
        arrows: JSON.stringify({
          type: "FeatureCollection",
          features: routes.map((route) => ({
            type: "Feature" as const,
            id: route.deviceId,
            properties: {},
            geometry: {
              type: "MultiLineString" as const,
              coordinates: route.runs.map((run) => run.map((point) => [...point])),
            },
          })),
        }),
        lines: new Map(
          routes.map((route) => [
            route.deviceId,
            JSON.stringify({
              type: "Feature",
              properties: {},
              geometry: { type: "LineString", coordinates: route.line },
            }),
          ]),
        ),
        pauses: JSON.stringify({
          type: "FeatureCollection",
          features: routes.flatMap((route) =>
            route.pauses.map((pause, index) => ({
              type: "Feature" as const,
              id: `${route.deviceId}:${index}`,
              properties: {},
              geometry: {
                type: "LineString" as const,
                coordinates: pause.map((point) => [...point]),
              },
            })),
          ),
        }),
        stops: JSON.stringify({
          type: "FeatureCollection",
          features: routes.flatMap((route) =>
            route.stops.map((stop, index) => ({
              type: "Feature" as const,
              id: `${route.deviceId}:${index}`,
              properties: { color: route.color },
              geometry: {
                type: "Point" as const,
                coordinates: [stop.longitude, stop.latitude],
              },
            })),
          ),
        }),
      }),
      [routes],
    );
    return (
      <>
        <GeoJSONSource id="timeline-pauses" data={data.pauses}>
          <Layer
            id="timeline-pause-casing"
            type="line"
            layout={{ "line-cap": "round" }}
            paint={{
              "line-color": "#6B5F80",
              "line-opacity": 0.6 * drawn,
              "line-width": 6,
            }}
          />
          <Layer
            id="timeline-pause-dots"
            type="line"
            paint={{
              "line-color": "#FFFFFF",
              "line-dasharray": [1, 1.5],
              "line-opacity": drawn,
              "line-width": 3,
            }}
          />
        </GeoJSONSource>
        {routes.map((route) =>
          route.line.length >= 2 ? (
            <GeoJSONSource
              key={route.deviceId}
              id={`timeline-route-${route.deviceId}`}
              lineMetrics
              tolerance={0.6}
              data={data.lines.get(route.deviceId) ?? ""}
            >
              <Layer
                id={`timeline-route-line-${route.deviceId}`}
                type="line"
                beforeId="timeline-arrows-text"
                layout={{ "line-cap": "round", "line-join": "round" }}
                paint={{
                  "line-width": 5,
                  "line-gradient": [
                    "interpolate",
                    ["linear"],
                    ["line-progress"],
                    ...timelineRouteGradient({
                      color: route.color,
                      drawn,
                      gaps: route.gaps,
                    }),
                  ],
                }}
              />
            </GeoJSONSource>
          ) : null,
        )}
        <GeoJSONSource id="timeline-arrows" tolerance={0.6} data={data.arrows}>
          <Layer
            id="timeline-arrows-text"
            type="symbol"
            layout={{
              "symbol-placement": "line",
              "symbol-spacing": 70,
              "text-allow-overlap": true,
              "text-field": "›",
              "text-font": ["Noto Sans Medium"],
              "text-ignore-placement": true,
              "text-keep-upright": false,
              "text-rotation-alignment": "map",
              "text-size": 18,
            }}
            paint={{
              "text-color": "#FFFFFF",
              "text-opacity": drawn >= 1 ? 1 : 0,
            }}
          />
        </GeoJSONSource>
        <GeoJSONSource id="timeline-stops" data={data.stops}>
          <Layer
            id="timeline-stop-circles"
            type="circle"
            paint={{
              "circle-color": "#FFFFFF",
              "circle-opacity": drawn,
              "circle-radius": 6,
              "circle-stroke-color": ["get", "color"],
              "circle-stroke-opacity": drawn,
              "circle-stroke-width": 3,
            }}
          />
        </GeoJSONSource>
      </>
    );
  },
);
