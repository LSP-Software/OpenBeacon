import type { CameraRef } from "@maplibre/maplibre-react-native";
import { type RefObject, useEffect, useRef } from "react";

export const useLiveMapCameraCommands = (cameraRef: RefObject<CameraRef | null>) => {
  const releaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearReleaseTimer = () => {
    if (releaseTimerRef.current === null) return;
    clearTimeout(releaseTimerRef.current);
    releaseTimerRef.current = null;
  };

  const scheduleRelease = (animationDurationMs: number) => {
    clearReleaseTimer();
    releaseTimerRef.current = setTimeout(() => {
      releaseTimerRef.current = null;
      cameraRef.current?.setStop({ duration: 0 });
    }, animationDurationMs + 50);
  };

  const setCamera = (stop: {
    animationDuration: number;
    animationMode?: "flyTo" | "easeTo";
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
    const options = {
      center: stop.centerCoordinate,
      ...(stop.zoomLevel !== undefined ? { zoom: stop.zoomLevel } : {}),
      duration: stop.animationDuration,
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
    if (stop.animationDuration === 0) cameraRef.current.jumpTo(options);
    else if (stop.animationMode === "flyTo") cameraRef.current.flyTo(options);
    else cameraRef.current.easeTo(options);
    scheduleRelease(stop.animationDuration ?? 0);
  };

  useEffect(
    () => () => {
      if (releaseTimerRef.current !== null) clearTimeout(releaseTimerRef.current);
    },
    [],
  );

  return { scheduleRelease, setCamera };
};
