import type { CameraRef } from "@maplibre/maplibre-react-native";
import { type RefObject, useEffect, useRef } from "react";

export const useLiveMapCameraCommands = (
  cameraRef: RefObject<CameraRef | null>,
  animationEndsAtMsRef: RefObject<number>,
  reduceMotion: boolean,
) => {
  const releaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearReleaseTimer = () => {
    if (releaseTimerRef.current === null) return;
    clearTimeout(releaseTimerRef.current);
    releaseTimerRef.current = null;
  };

  const scheduleRelease = (animationDurationMs: number) => {
    animationEndsAtMsRef.current = Date.now() + animationDurationMs;
    clearReleaseTimer();
    releaseTimerRef.current = setTimeout(() => {
      releaseTimerRef.current = null;
      // MapLibre keeps the last camera target and replays it when markers update, so an empty stop releases it once the animation ends.
      cameraRef.current?.setStop({ duration: 0 });
    }, animationDurationMs + 50);
  };

  const setCamera = (stop: {
    animationDuration: number;
    animationMode?: "flyTo" | "easeTo" | "linear";
    centerCoordinate: [number, number];
    zoomLevel?: number;
    padding?: {
      paddingTop: number;
      paddingRight: number;
      paddingBottom: number;
      paddingLeft: number;
    };
  }) => {
    if (!cameraRef.current) return;
    const duration = reduceMotion ? 0 : stop.animationDuration;
    const options = {
      center: stop.centerCoordinate,
      ...(stop.zoomLevel !== undefined ? { zoom: stop.zoomLevel } : {}),
      duration,
      ...(stop.padding
        ? {
            padding: {
              top: stop.padding.paddingTop,
              right: stop.padding.paddingRight,
              bottom: stop.padding.paddingBottom,
              left: stop.padding.paddingLeft,
            },
          }
        : {}),
    };
    if (duration === 0) cameraRef.current.jumpTo(options);
    else if (stop.animationMode === "flyTo") cameraRef.current.flyTo(options);
    else if (stop.animationMode === "linear")
      cameraRef.current.easeTo({ ...options, easing: "linear" });
    else cameraRef.current.easeTo(options);
    scheduleRelease(duration);
  };

  useEffect(
    () => () => {
      if (releaseTimerRef.current !== null) clearTimeout(releaseTimerRef.current);
    },
    [],
  );

  return { scheduleRelease, setCamera };
};
