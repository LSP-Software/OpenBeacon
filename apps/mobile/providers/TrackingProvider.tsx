import { tryCatch } from "@openbeacon/shared";
import { useQueryClient } from "@tanstack/react-query";
import type React from "react";
import { useCallback, useEffect, useRef } from "react";
import { Alert, AppState } from "react-native";
import { authClient } from "../lib/auth-client.ts";
import { subscribeToTrackingSync } from "../lib/trackingEvents.ts";
import { useLocationPermissions } from "./LocationPermissionProvider.tsx";

const trackingService = {
  flushPendingTrackingPoints: async (force = false) =>
    (await import("../lib/tracking.ts")).flushPendingTrackingPoints(force),
  resumeTracking: async () => (await import("../lib/tracking.ts")).resumeTracking(),
  getUnassignedTrackingPoints: async () =>
    (await import("../lib/tracking.ts")).getUnassignedTrackingPoints(),
  recoverUnassignedTrackingPoints: async (input: { deviceIds: string[]; userId: string }) =>
    (await import("../lib/tracking.ts")).recoverUnassignedTrackingPoints(input),
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
  const recoveryCheckedUserRef = useRef<string | null>(null);
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
          const userId = previousUserIdRef.current;
          if (userId && recoveryCheckedUserRef.current !== userId) {
            const result = await tryCatch(service.getUnassignedTrackingPoints());
            if (
              !result.error &&
              previousUserIdRef.current === userId &&
              (!result.data || result.data.userId === userId)
            ) {
              recoveryCheckedUserRef.current = userId;
            }
            if (
              result.data &&
              result.data.userId === userId &&
              previousUserIdRef.current === userId
            ) {
              const { count, deviceIds, server, userId: ownerId } = result.data;
              Alert.alert(
                "Recover saved locations?",
                `${count} saved location ${count === 1 ? "point was" : "points were"} created by an older version of OpenBeacon. Their server was not recorded. Upload them only if they belong to your current account on ${server}.`,
                [
                  { text: "Keep on device", style: "cancel" },
                  {
                    text: "Upload",
                    onPress: () => {
                      void (async () => {
                        const recovery = await tryCatch(
                          service.recoverUnassignedTrackingPoints({ deviceIds, userId: ownerId }),
                        );
                        if (recovery.error) {
                          Alert.alert(
                            "Upload incomplete",
                            "Some saved locations may still be on this device. Try again after signing in.",
                          );
                        }
                      })();
                    },
                  },
                ],
              );
            }
          }
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

      if (previousUserId !== userId) recoveryCheckedUserRef.current = null;
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
