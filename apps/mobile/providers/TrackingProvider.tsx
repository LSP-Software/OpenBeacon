import { tryCatch } from "@openbeacon/shared";
import { useQueryClient } from "@tanstack/react-query";
import type React from "react";
import { useCallback, useEffect, useRef } from "react";
import { AppState } from "react-native";
import { authClient } from "../lib/auth-client.ts";
import { subscribeToTrackingSync } from "../lib/trackingEvents.ts";
import { useLocationPermissions } from "./LocationPermissionProvider.tsx";

const trackingService = {
  flushPendingTrackingPoints: async (force = false) =>
    (await import("../lib/tracking.ts")).flushPendingTrackingPoints(force),
  resumeTracking: async () => (await import("../lib/tracking.ts")).resumeTracking(),
  reconcileTrackingKeys: async (input: { startCapture: boolean }) =>
    (await import("../lib/tracking.ts")).reconcileTrackingKeys(input),
  revokeTrackingAccess: async () => (await import("../lib/tracking.ts")).revokeTrackingAccess(),
};

export const TrackingProvider = ({
  children,
  service = trackingService,
}: {
  children: React.ReactNode;
  service?: typeof trackingService;
}) => {
  const { data: session, isPending } = authClient.useSession();
  const queryClient = useQueryClient();
  const { permissionState } = useLocationPermissions();
  const activeCycleRef = useRef<Promise<void> | null>(null);
  const appStateRef = useRef(AppState.currentState);
  const completedCycleRef = useRef(0);
  const previousUserIdRef = useRef<string | null | undefined>(undefined);
  const requestedCycleRef = useRef(0);
  const forceFlushRef = useRef(false);
  const startCaptureRef = useRef(permissionState?.isReadyForSharing ?? false);
  const userId = session?.user.id ?? null;
  const startCapture = permissionState?.isReadyForSharing ?? false;
  startCaptureRef.current = startCapture;

  const runTrackingCycle = useCallback(
    (force = false) => {
      forceFlushRef.current ||= force;
      requestedCycleRef.current += 1;

      if (activeCycleRef.current) {
        return activeCycleRef.current;
      }

      activeCycleRef.current = (async () => {
        while (completedCycleRef.current < requestedCycleRef.current) {
          const cycle = requestedCycleRef.current;
          const forceFlush = forceFlushRef.current;
          forceFlushRef.current = false;
          await tryCatch(
            service.reconcileTrackingKeys({
              startCapture: startCaptureRef.current,
            }),
          );
          await tryCatch(service.flushPendingTrackingPoints(forceFlush));
          if (appStateRef.current === "active") {
            void queryClient.invalidateQueries({ queryKey: ["groupKeyAccess"] });
          }
          completedCycleRef.current = cycle;
        }
      })().finally(() => {
        activeCycleRef.current = null;
      });

      return activeCycleRef.current;
    },
    [queryClient, service],
  );

  useEffect(() => {
    if (isPending) {
      return;
    }

    void (async () => {
      const previousUserId = previousUserIdRef.current;

      if (previousUserId !== undefined && previousUserId !== userId) {
        await activeCycleRef.current;
        await tryCatch(service.revokeTrackingAccess());
      }

      previousUserIdRef.current = userId;

      if (!userId) {
        if (previousUserId === undefined) {
          await tryCatch(service.revokeTrackingAccess());
        }
        return;
      }

      if (previousUserId !== userId) {
        await service.resumeTracking();
      }
      await runTrackingCycle(previousUserId !== userId);
    })();
  }, [isPending, runTrackingCycle, service, startCapture, userId]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextAppState) => {
      const appBecameActive =
        (appStateRef.current === "background" || appStateRef.current === "inactive") &&
        nextAppState === "active";

      appStateRef.current = nextAppState;

      if (appBecameActive && userId) {
        void runTrackingCycle();
      }
    });

    return () => {
      subscription.remove();
    };
  }, [runTrackingCycle, userId]);

  useEffect(() => {
    if (!userId) {
      return;
    }

    const interval = setInterval(() => {
      if (appStateRef.current === "active") {
        void runTrackingCycle();
      }
    }, 30_000);

    return () => {
      clearInterval(interval);
    };
  }, [runTrackingCycle, userId]);

  useEffect(() => {
    if (!userId) {
      return;
    }

    return subscribeToTrackingSync(() => {
      void runTrackingCycle();
    });
  }, [runTrackingCycle, userId]);

  return children;
};
