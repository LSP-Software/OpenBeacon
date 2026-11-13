import { Alert } from "../lib/alert.ts";
import { tryCatch } from "@openbeacon/shared";
import { useQueryClient } from "@tanstack/react-query";
import type React from "react";
import { useCallback, useEffect, useRef } from "react";
import { AppState } from "react-native";
import { authClient } from "../lib/auth-client.ts";
import { useThisDeviceState } from "../lib/deviceActivation.ts";
import { subscribeToTrackingSync } from "../lib/trackingEvents.ts";
import { useLocationPermissions } from "./LocationPermissionProvider.tsx";

const trackingService = {
  flushPendingTrackingPoints: async (force = false) =>
    (await import("../lib/tracking.ts")).flushForegroundTrackingPoints(force),
  resumeTracking: async () => (await import("../lib/tracking.ts")).resumeTracking(),
  getUnassignedTrackingPoints: async () =>
    (await import("../lib/tracking.ts")).getUnassignedTrackingPoints(),
  recoverUnassignedTrackingPoints: async (input: { deviceIds: string[]; userId: string }) =>
    (await import("../lib/tracking.ts")).recoverUnassignedTrackingPoints(input),
  reconcileTrackingKeys: async (input: { startCapture: boolean; force: boolean }) =>
    (await import("../lib/tracking.ts")).reconcileTrackingKeys(input),
  revokeTrackingAccess: async (input: { keepDeviceRegistration: boolean }) =>
    (await import("../lib/tracking.ts")).revokeTrackingAccess(input),
  endLostSession: async () => {
    await (await import("../lib/endSession.ts")).endSession({ reason: "sessionLost" });
  },
  takeKeyAccessChange: async () => (await import("../lib/tracking.ts")).takeKeyAccessChange(),
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
  const thisDeviceActive = useThisDeviceState() === "active";
  const activeCycleRef = useRef<Promise<void> | null>(null);
  const cycleVersionRef = useRef(0);
  const sessionReadyRef = useRef(false);
  const startingVersionRef = useRef<number | null>(null);
  const appStateRef = useRef(AppState.currentState);
  const completedCycleRef = useRef(0);
  const previousUserIdRef = useRef<string | null | undefined>(undefined);
  const requestedCycleRef = useRef(0);
  const forceFlushRef = useRef(false);
  const forceKeyCheckRef = useRef(false);
  const recoveryCheckedUserRef = useRef<string | null>(null);
  const startCaptureRef = useRef(permissionState?.isReadyForSharing ?? false);
  const userId = session?.user.id ?? null;
  const startCapture = permissionState?.isReadyForSharing ?? false;
  startCaptureRef.current = startCapture;

  const runTrackingCycle = useCallback(
    ({
      forceFlush = false,
      forceKeyCheck = false,
    }: { forceFlush?: boolean; forceKeyCheck?: boolean } = {}) => {
      if (!sessionReadyRef.current) return Promise.resolve();
      forceFlushRef.current ||= forceFlush;
      forceKeyCheckRef.current ||= forceKeyCheck;
      requestedCycleRef.current += 1;

      if (activeCycleRef.current) {
        return activeCycleRef.current;
      }

      const version = cycleVersionRef.current;
      const current = (async () => {
        while (
          version === cycleVersionRef.current &&
          completedCycleRef.current < requestedCycleRef.current
        ) {
          const cycle = requestedCycleRef.current;
          const forceFlush = forceFlushRef.current;
          const forceKeyCheck = forceKeyCheckRef.current;
          forceFlushRef.current = false;
          forceKeyCheckRef.current = false;
          await tryCatch(
            service.reconcileTrackingKeys({
              startCapture: startCaptureRef.current,
              force: forceKeyCheck,
            }),
          );
          if (version !== cycleVersionRef.current) return;
          if (appStateRef.current === "active" && (await service.takeKeyAccessChange())) {
            void queryClient.invalidateQueries({ queryKey: ["groupKeyAccess"] });
          }
          await tryCatch(service.flushPendingTrackingPoints(forceFlush));
          if (version !== cycleVersionRef.current) return;
          const userId = previousUserIdRef.current;
          if (userId && recoveryCheckedUserRef.current !== userId) {
            const result = await tryCatch(service.getUnassignedTrackingPoints());
            if (version !== cycleVersionRef.current) return;
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
          completedCycleRef.current = cycle;
        }
      })().finally(() => {
        if (activeCycleRef.current === current) activeCycleRef.current = null;
      });

      activeCycleRef.current = current;
      return current;
    },
    [queryClient, service],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: startCapture reruns the cycle once sharing is allowed; the cycle reads it through startCaptureRef
  useEffect(() => {
    if (isPending) {
      return;
    }

    const previousUserId = previousUserIdRef.current;
    const changed = previousUserId !== userId;
    if (changed) {
      cycleVersionRef.current += 1;
      sessionReadyRef.current = false;
      activeCycleRef.current = null;
      requestedCycleRef.current = 0;
      completedCycleRef.current = 0;
      forceFlushRef.current = false;
      forceKeyCheckRef.current = false;
      recoveryCheckedUserRef.current = null;
      previousUserIdRef.current = userId;
    } else if (!thisDeviceActive && sessionReadyRef.current) {
      cycleVersionRef.current += 1;
      sessionReadyRef.current = false;
      activeCycleRef.current = null;
    }
    const version = cycleVersionRef.current;
    void (async () => {
      if (changed && (typeof previousUserId === "string" || !userId)) {
        await tryCatch(service.revokeTrackingAccess({ keepDeviceRegistration: !userId }));
        if (!userId && version === cycleVersionRef.current)
          await tryCatch(service.endLostSession());
      }
      if (version !== cycleVersionRef.current || !userId || !thisDeviceActive) return;
      const starting = !sessionReadyRef.current;
      if (starting) {
        if (startingVersionRef.current === version) return;
        startingVersionRef.current = version;
        await service.resumeTracking();
        if (version !== cycleVersionRef.current) return;
        sessionReadyRef.current = true;
      }
      await runTrackingCycle({ forceFlush: starting, forceKeyCheck: starting });
    })();
  }, [isPending, runTrackingCycle, service, startCapture, thisDeviceActive, userId]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextAppState) => {
      const appBecameActive =
        (appStateRef.current === "background" || appStateRef.current === "inactive") &&
        nextAppState === "active";

      appStateRef.current = nextAppState;

      if (appBecameActive && userId) {
        void runTrackingCycle({ forceKeyCheck: true });
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
    }, 60_000);

    return () => {
      clearInterval(interval);
    };
  }, [runTrackingCycle, userId]);

  useEffect(() => {
    if (!userId) {
      return;
    }

    return subscribeToTrackingSync(() => {
      void runTrackingCycle({ forceKeyCheck: true });
    });
  }, [runTrackingCycle, userId]);

  return children;
};
