import { useIsFocused } from "@react-navigation/native";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { createDefaultMapTrackingDeps } from "../lib/createDefaultMapTrackingDeps.ts";
import { createMapTrackingSession } from "../lib/mapTracking.ts";
import type { LiveMapPosition, MapTrackingStatus } from "../lib/mapTrackingTypes.ts";

const INITIAL_STATUS: MapTrackingStatus = {
  connection: "ok",
  groups: {},
  membership: "loading",
  undecryptable: [],
};

export const useLiveTrackingPositions = ({ groupId }: { groupId?: string } = {}) => {
  const isFocused = useIsFocused();
  const [tracking, setTracking] = useState<{
    positions: LiveMapPosition[];
    status: MapTrackingStatus;
  }>(() => ({ positions: [], status: INITIAL_STATUS }));
  const sessionRef = useRef<ReturnType<typeof createMapTrackingSession> | null>(null);
  const isFocusedRef = useRef(isFocused);
  isFocusedRef.current = isFocused;

  useEffect(() => {
    setTracking({ positions: [], status: INITIAL_STATUS });
    const deps = createDefaultMapTrackingDeps();
    const session = createMapTrackingSession(
      groupId
        ? {
            ...deps,
            listGroups: async (signal) =>
              (await deps.listGroups(signal)).filter(({ id }) => id === groupId),
          }
        : deps,
    );
    sessionRef.current = session;
    const unsubscribe = session.subscribe(() => {
      setTracking({ positions: session.getLivePositions(), status: session.getStatus() });
    });
    session.setActive(isFocusedRef.current && AppState.currentState === "active");

    return () => {
      unsubscribe();
      session.destroy();
      sessionRef.current = null;
    };
  }, [groupId]);

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

  const dropRemovedDevices = useCallback(
    (input: { activeDeviceIds: ReadonlySet<string>; groupId: string }) => {
      sessionRef.current?.dropRemovedDevices(input);
    },
    [],
  );

  return { ...tracking, dropRemovedDevices };
};
