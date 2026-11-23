import { GeoJSONSource, Layer } from "@maplibre/maplibre-react-native";
import { memo, useEffect, useMemo, useState } from "react";
import { useColors } from "../../lib/theme.ts";
import { timelineArrows, timelineRouteGradient } from "../../lib/timelineMap.ts";
import type { Coordinate } from "../../lib/timelineTypes.ts";

export const TimelineMapLayers = memo(
  ({
    dayKey,
    reduceMotion,
    routes,
    viewport,
  }: {
    dayKey: string | undefined;
    reduceMotion: boolean;
    routes: ReadonlyArray<{
      color: string;
      deviceId: string;
      gaps: ReadonlyArray<{ from: number; to: number }>;
      line: readonly Coordinate[];
      pauses: ReadonlyArray<readonly [Coordinate, Coordinate]>;
      runs: ReadonlyArray<readonly Coordinate[]>;
      stops: ReadonlyArray<{ latitude: number; longitude: number }>;
    }>;
    viewport: { bounds: [number, number, number, number]; zoom: number } | null;
  }) => {
    const drawn = useDrawIn({
      dayKey,
      reduceMotion,
      routeIds: routes.map((route) => route.deviceId),
    });
    const colors = useColors();
    const casing = colors.isDark ? colors.background : colors.text;
    const zoom = viewport ? Math.round(viewport.zoom * 4) / 4 : null;
    const bounds = viewport?.bounds;
    const arrows = useMemo(
      () =>
        JSON.stringify({
          type: "FeatureCollection",
          features:
            bounds && zoom !== null
              ? routes.map((route) => ({
                  type: "Feature" as const,
                  properties: { deviceId: route.deviceId },
                  geometry: {
                    type: "MultiLineString" as const,
                    coordinates: timelineArrows({
                      runs: route.runs,
                      sizePx: 6,
                      spacingPx: 44,
                      viewport: { bounds, zoom },
                    }),
                  },
                }))
              : [],
        }),
      [bounds, routes, zoom],
    );
    const drawnOpacity = (
      scale: number,
    ): number | ["match", ["get", string], string, number, ...Array<string | number>, number] => {
      const [first, ...rest] = routes;
      if (!first) return 0;
      return [
        "match",
        ["get", "deviceId"],
        first.deviceId,
        (drawn[first.deviceId] ?? 0) * scale,
        ...rest.flatMap((route) => [route.deviceId, (drawn[route.deviceId] ?? 0) * scale]),
        0,
      ];
    };
    const data = useMemo(
      () => ({
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
              properties: { deviceId: route.deviceId },
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
              properties: { color: route.color, deviceId: route.deviceId },
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
              "line-color": colors.textSecondary,
              "line-opacity": drawnOpacity(0.6),
              "line-width": 7,
            }}
          />
          <Layer
            id="timeline-pause-dots"
            type="line"
            layout={{ "line-cap": "round" }}
            paint={{
              "line-color": "#FFFFFF",
              "line-dasharray": [0, 2],
              "line-opacity": drawnOpacity(1),
              "line-width": 4,
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
                id={`timeline-route-casing-${route.deviceId}`}
                type="line"
                beforeId="timeline-arrow-lines"
                layout={{ "line-cap": "round", "line-join": "round" }}
                paint={{
                  "line-width": 9,
                  "line-gradient": [
                    "interpolate",
                    ["linear"],
                    ["line-progress"],
                    ...timelineRouteGradient({
                      alpha: { from: 0.2, to: 0.45 },
                      color: casing,
                      drawn: drawn[route.deviceId] ?? 0,
                      gaps: route.gaps,
                    }),
                  ],
                }}
              />
              <Layer
                id={`timeline-route-line-${route.deviceId}`}
                type="line"
                beforeId="timeline-arrow-lines"
                layout={{ "line-cap": "round", "line-join": "round" }}
                paint={{
                  "line-width": 6,
                  "line-gradient": [
                    "interpolate",
                    ["linear"],
                    ["line-progress"],
                    ...timelineRouteGradient({
                      color: route.color,
                      drawn: drawn[route.deviceId] ?? 0,
                      gaps: route.gaps,
                    }),
                  ],
                }}
              />
            </GeoJSONSource>
          ) : null,
        )}
        <GeoJSONSource id="timeline-arrows" tolerance={0} data={arrows}>
          <Layer
            id="timeline-arrow-lines"
            type="line"
            layout={{ "line-cap": "round", "line-join": "round" }}
            paint={{
              "line-color": "#FFFFFF",
              "line-opacity": drawnOpacity(1),
              "line-width": 3,
            }}
          />
        </GeoJSONSource>
        <GeoJSONSource id="timeline-stops" data={data.stops}>
          <Layer
            id="timeline-stop-circles"
            type="circle"
            paint={{
              "circle-color": colors.surface,
              "circle-opacity": drawnOpacity(1),
              "circle-radius": 6,
              "circle-stroke-color": ["get", "color"],
              "circle-stroke-opacity": drawnOpacity(1),
              "circle-stroke-width": 3,
            }}
          />
        </GeoJSONSource>
      </>
    );
  },
);

const DRAW_IN_MS = 1200;

const useDrawIn = ({
  dayKey,
  reduceMotion,
  routeIds,
}: {
  dayKey: string | undefined;
  reduceMotion: boolean;
  routeIds: readonly string[];
}) => {
  const [drawIn, setDrawIn] = useState<{ clock: number; starts: Record<string, number> }>({
    clock: 0,
    starts: {},
  });
  const routeKey = routeIds.join(",");

  useEffect(() => {
    if (dayKey === undefined || routeKey === "") return;
    const start = performance.now();
    setDrawIn((current) => {
      const starts = Object.fromEntries(
        Object.entries(current.starts).filter(([key]) => key.startsWith(`${dayKey}:`)),
      );
      for (const deviceId of routeKey.split(",")) {
        starts[`${dayKey}:${deviceId}`] ??= reduceMotion ? -Infinity : start;
      }
      return { clock: start, starts };
    });
    if (reduceMotion) return;
    let frame = 0;
    const step = (now: number) => {
      setDrawIn((current) => ({ ...current, clock: now }));
      if (now - start < DRAW_IN_MS) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [reduceMotion, routeKey, dayKey]);

  return Object.fromEntries(
    routeIds.map((deviceId) => [
      deviceId,
      Math.min(
        Math.max(
          (drawIn.clock - (drawIn.starts[`${dayKey}:${deviceId}`] ?? Infinity)) / DRAW_IN_MS,
          0,
        ),
        1,
      ),
    ]),
  );
};
