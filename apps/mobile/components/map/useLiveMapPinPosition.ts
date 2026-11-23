import { useEffect, useRef, useState } from "react";
import {
  type LiveMapPinGlide,
  liveMapPinGlideOffsetPosition,
  liveMapPinPixelsBetween,
} from "../../lib/liveMapPinGlide.ts";
import { subscribeToLiveMapFrames } from "./liveMapFrameTicker.ts";

export const useLiveMapPinPosition = ({
  base,
  deviceIds,
  getZoom,
  glides,
}: {
  base: { latitude: number; longitude: number };
  deviceIds: readonly string[];
  getZoom: () => number;
  glides: ReadonlyMap<string, LiveMapPinGlide>;
}) => {
  const [, setFrame] = useState(0);
  const shownAt = (nowMs: number) =>
    liveMapPinGlideOffsetPosition({
      base,
      glides: deviceIds.flatMap((deviceId) => glides.get(deviceId) ?? []),
      nowMs,
    });
  const shown = shownAt(Date.now());
  const drawnRef = useRef({ getZoom, shown, shownAt });
  drawnRef.current = { getZoom, shown, shownAt };
  const pinKey = `${deviceIds.join(",")}:${base.latitude}:${base.longitude}`;

  useEffect(() => {
    void glides;
    void pinKey;
    if (drawnRef.current.shown.settled) return;
    const unsubscribe = subscribeToLiveMapFrames((nowMs) => {
      const drawn = drawnRef.current;
      const next = drawn.shownAt(nowMs);
      if (next.settled || liveMapPinPixelsBetween(drawn.shown, next, drawn.getZoom()) >= 1) {
        setFrame((current) => current + 1);
      }
      if (next.settled) unsubscribe();
    });
    return unsubscribe;
  }, [glides, pinKey]);

  return shown;
};
