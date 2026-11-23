import { useMemo, useRef } from "react";
import type { LiveMapMarker } from "../../lib/buildLiveMapMarkers.ts";
import {
  continueLiveMapPinGlide,
  type LiveMapPinGlide,
  restingLiveMapPinGlide,
} from "../../lib/liveMapPinGlide.ts";

export const useLiveMapPinGlides = (markers: readonly LiveMapMarker[], showAtOnce: boolean) => {
  const glidesRef = useRef<ReadonlyMap<string, LiveMapPinGlide>>(new Map());

  return useMemo(() => {
    const nowMs = Date.now();
    glidesRef.current = new Map(
      markers.map((marker) => [
        marker.deviceId,
        marker.isSelf || showAtOnce
          ? restingLiveMapPinGlide(marker, nowMs)
          : continueLiveMapPinGlide(glidesRef.current.get(marker.deviceId), marker, nowMs),
      ]),
    );
    return glidesRef.current;
  }, [markers, showAtOnce]);
};
