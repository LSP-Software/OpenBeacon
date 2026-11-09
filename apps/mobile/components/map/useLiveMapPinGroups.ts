import { useEffect, useMemo, useRef, useState } from "react";
import type { LiveMapMarker } from "../../lib/buildLiveMapMarkers.ts";
import {
  groupLiveMapPins,
  hasSameLiveMapPinGroups,
  type LiveMapPinGroup,
  type LiveMapPinOffset,
  liveMapPinTransition,
} from "../../lib/liveMapPinGroups.ts";
import { INITIAL_MAP_CAMERA } from "../../lib/mapPmtilesCameraState.ts";

const LIVE_MAP_PIN_GATHER_MS = 280;

export const useLiveMapPinGroups = (markers: readonly LiveMapMarker[]) => {
  const zoomRef = useRef(INITIAL_MAP_CAMERA.zoomLevel);
  const evaluatedZoomRef = useRef(INITIAL_MAP_CAMERA.zoomLevel);
  const computedRef = useRef<{
    groups: LiveMapPinGroup[];
    markers: readonly LiveMapMarker[];
    zoom: number;
  } | null>(null);
  const [revision, setRevision] = useState(0);
  const viewRef = useRef<{
    arrivals: Map<string, LiveMapPinOffset>;
    gathering: Array<{ gatherTo: LiveMapPinOffset; marker: LiveMapMarker; untilMs: number }>;
    groups: LiveMapPinGroup[];
  }>({ arrivals: new Map(), gathering: [], groups: [] });

  const view = useMemo(() => {
    void revision;
    const previous = viewRef.current;
    const zoom = zoomRef.current;
    const computed = computedRef.current;
    const groups =
      computed?.markers === markers && computed.zoom === zoom
        ? computed.groups
        : groupLiveMapPins({ markers, zoom, previous: previous.groups });
    const transition = liveMapPinTransition({ next: groups, previous: previous.groups, zoom });
    const stackedUserIds = new Set(
      groups.flatMap((group) =>
        group.members.length > 1 ? group.members.map((member) => member.userId) : [],
      ),
    );
    const untilMs = Date.now() + LIVE_MAP_PIN_GATHER_MS;
    const newlyGathering = new Set(transition.gathering.map(({ marker }) => marker.userId));
    viewRef.current = {
      arrivals: transition.arrivals,
      gathering: [
        ...previous.gathering.filter(
          (pin) =>
            pin.untilMs > Date.now() &&
            stackedUserIds.has(pin.marker.userId) &&
            !newlyGathering.has(pin.marker.userId),
        ),
        ...transition.gathering.map((pin) => ({ ...pin, untilMs })),
      ],
      groups,
    };
    return viewRef.current;
  }, [markers, revision]);

  useEffect(() => {
    view.arrivals.clear();
  }, [view]);

  useEffect(() => {
    if (view.gathering.length === 0) return;
    const timer = setTimeout(
      () => setRevision((current) => current + 1),
      LIVE_MAP_PIN_GATHER_MS + 20,
    );
    return () => clearTimeout(timer);
  }, [view.gathering]);

  return {
    ...view,
    getZoom: () => zoomRef.current,
    onZoomChange: (zoom: number) => {
      zoomRef.current = zoom;
      if (Math.abs(zoom - evaluatedZoomRef.current) < 0.05) return;
      evaluatedZoomRef.current = zoom;
      const groups = groupLiveMapPins({ markers, zoom, previous: viewRef.current.groups });
      if (!hasSameLiveMapPinGroups(groups, viewRef.current.groups)) {
        computedRef.current = { groups, markers, zoom };
        setRevision((current) => current + 1);
      }
    },
  };
};
