import type { CameraRef, CameraStop } from "@maplibre/maplibre-react-native";
import { useEffect, useRef } from "react";

export const useLiveMapCameraCommands = () => {
  const cameraRef = useRef<CameraRef>(null);
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
      cameraRef.current?.setCamera({ animationDuration: 0 });
    }, animationDurationMs + 50);
  };

  const setCamera = (stop: CameraStop) => {
    if (!cameraRef.current) return;
    cameraRef.current.setCamera(stop);
    scheduleRelease(stop.animationDuration ?? 0);
  };

  useEffect(() => () => clearReleaseTimer(), []);

  return { cameraRef, scheduleRelease, setCamera };
};
