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

export const LIVE_MAP_PIN_GATHER_MS = 280;

export const useLiveMapPinGroups = (markers: readonly LiveMapMarker[]) => {
  const zoomRef = useRef(INITIAL_MAP_CAMERA.zoomLevel);
  const [revision, setRevision] = useState(0);
  const viewRef = useRef<{
    arrivals: ReadonlyMap<string, LiveMapPinOffset>;
    gathering: Array<{ gatherTo: LiveMapPinOffset; marker: LiveMapMarker; untilMs: number }>;
    groups: LiveMapPinGroup[];
  }>({ arrivals: new Map(), gathering: [], groups: [] });

  const view = useMemo(() => {
    void revision;
    const previous = viewRef.current;
    const zoom = zoomRef.current;
    const groups = groupLiveMapPins({ markers, zoom, previous: previous.groups });
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
      if (zoom === zoomRef.current) return;
      zoomRef.current = zoom;
      const groups = groupLiveMapPins({ markers, zoom, previous: viewRef.current.groups });
      if (!hasSameLiveMapPinGroups(groups, viewRef.current.groups)) {
        setRevision((current) => current + 1);
      }
    },
  };
};
