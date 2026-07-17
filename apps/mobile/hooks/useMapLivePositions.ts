import { useIsFocused } from "@react-navigation/native";
import { useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { createDefaultMapTrackingDeps } from "../lib/createDefaultMapTrackingDeps.ts";
import { createMapTrackingSession } from "../lib/mapTracking.ts";
import type { LiveMapPosition } from "../lib/mapTrackingTypes.ts";

export const useMapLivePositions = () => {
  const isFocused = useIsFocused();
  const [livePositions, setLivePositions] = useState<LiveMapPosition[]>([]);
  const sessionRef = useRef<ReturnType<typeof createMapTrackingSession> | null>(null);

  useEffect(() => {
    const session = createMapTrackingSession(createDefaultMapTrackingDeps());
    sessionRef.current = session;
    const unsubscribe = session.subscribe(() => {
      setLivePositions(session.getLivePositions());
    });

    return () => {
      unsubscribe();
      session.destroy();
      sessionRef.current = null;
    };
  }, []);

  useEffect(() => {
    const session = sessionRef.current;
    if (!session) {
      return;
    }

    const syncActive = () => {
      session.setActive(isFocused && AppState.currentState === "active");
    };

    syncActive();
    const appStateSubscription = AppState.addEventListener("change", syncActive);

    return () => {
      appStateSubscription.remove();
    };
  }, [isFocused]);

  return livePositions;
};
