import { tryCatch } from "@openbeacon/shared";
import { useGlobalSearchParams, usePathname } from "expo-router";
import type React from "react";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { Button } from "../components/ui/Button.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/Dialog.tsx";
import { Text } from "../components/ui/Text.tsx";
import { authClient } from "../lib/auth-client.ts";
import { useThisDeviceState } from "../lib/deviceActivation.ts";
import {
  getLocationPermissionState,
  type LocationPermissionState,
  openLocationSettings,
  requestBackgroundLocationPermissions,
  requestLocationPermissionsForLaunch,
} from "../lib/locationPermissions.ts";
import { dismissNotice, requestNotificationPermissions } from "../lib/notifications.ts";

const LocationPermissionContext = createContext<{
  permissionState: LocationPermissionState | null;
  isConfiguringLocation: boolean;
  refreshLocationPermissionState: () => Promise<LocationPermissionState | null>;
  openLocationPermissionSettings: () => Promise<void>;
} | null>(null);

export const LocationPermissionProvider = ({ children }: { children: React.ReactNode }) => {
  const { data: session, isPending } = authClient.useSession();
  const thisDeviceActive = useThisDeviceState() === "active";
  const pathname = usePathname();
  const { setup } = useGlobalSearchParams<{ setup?: string }>();
  const inSetup =
    pathname.startsWith("/setup") || (pathname.startsWith("/account/recovery-") && Boolean(setup));
  const readyToAsk = Boolean(session) && thisDeviceActive && !inSetup;
  const [permissionState, setPermissionState] = useState<LocationPermissionState | null>(null);
  const [isLaunchingLocationSetup, setIsLaunchingLocationSetup] = useState(true);
  const [isBackgroundPermissionDialogOpen, setIsBackgroundPermissionDialogOpen] = useState(false);
  const [isRequestingBackgroundPermission, setIsRequestingBackgroundPermission] = useState(false);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const permissionCheckRef = useRef<Promise<void> | null>(null);
  const shouldOpenBackgroundPermissionDialog = useCallback(
    ({
      flow,
      nextPermissionState,
    }: {
      flow: "refresh" | "launchRequest";
      nextPermissionState: LocationPermissionState;
    }): boolean =>
      flow === "launchRequest" &&
      nextPermissionState.foregroundStatus === "granted" &&
      nextPermissionState.preciseEnabled &&
      nextPermissionState.backgroundStatus !== "granted" &&
      nextPermissionState.canRequestBackgroundInApp,
    [],
  );
  const syncLocationPermissions = useCallback(
    async (flow: "refresh" | "launchRequest"): Promise<LocationPermissionState | null> => {
      if (!readyToAsk) return null;
      while (permissionCheckRef.current) {
        if (flow === "refresh") return null;
        await permissionCheckRef.current;
      }
      let finishCheck = () => {};
      permissionCheckRef.current = new Promise<void>((resolve) => {
        finishCheck = resolve;
      });

      const launchResult =
        flow === "launchRequest" ? await tryCatch(requestLocationPermissionsForLaunch()) : null;
      const permissionResult =
        launchResult && !launchResult.error
          ? launchResult
          : await tryCatch(getLocationPermissionState());

      permissionCheckRef.current = null;
      finishCheck();

      if (permissionResult.error) {
        return null;
      }

      setPermissionState(permissionResult.data);
      setIsBackgroundPermissionDialogOpen(
        shouldOpenBackgroundPermissionDialog({
          flow,
          nextPermissionState: permissionResult.data,
        }),
      );

      return permissionResult.data;
    },
    [readyToAsk, shouldOpenBackgroundPermissionDialog],
  );

  useEffect(() => {
    if (isPending) {
      return;
    }

    if (!readyToAsk) {
      setPermissionState(null);
      setIsLaunchingLocationSetup(true);
      return;
    }

    setIsLaunchingLocationSetup(true);
    let cancelled = false;
    void (async () => {
      await tryCatch(requestNotificationPermissions());
      if (cancelled) return;
      await syncLocationPermissions("launchRequest");
      if (cancelled) return;
      setIsLaunchingLocationSetup(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [isPending, readyToAsk, syncLocationPermissions]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextAppState) => {
      const appBecameActive =
        (appStateRef.current === "background" || appStateRef.current === "inactive") &&
        nextAppState === "active";

      appStateRef.current = nextAppState;

      if (!appBecameActive) {
        return;
      }

      void syncLocationPermissions("refresh");
    });

    return () => {
      subscription.remove();
    };
  }, [syncLocationPermissions]);

  useEffect(() => {
    if (permissionState?.isReadyForSharing) void dismissNotice("locationPermission");
  }, [permissionState?.isReadyForSharing]);

  const refreshLocationPermissionState = async (): Promise<LocationPermissionState | null> =>
    syncLocationPermissions("refresh");

  const continueToBackgroundPermission = async () => {
    if (isRequestingBackgroundPermission) {
      return;
    }

    if (
      !permissionState?.canRequestBackgroundInApp ||
      permissionState.missing.length !== 1 ||
      permissionState.missing[0] !== "background"
    ) {
      setIsBackgroundPermissionDialogOpen(false);
      await openLocationSettings();
      return;
    }

    setIsRequestingBackgroundPermission(true);

    const permissionResult = await tryCatch(requestBackgroundLocationPermissions());

    setIsRequestingBackgroundPermission(false);

    if (permissionResult.error) {
      return;
    }

    setPermissionState(permissionResult.data);
    setIsBackgroundPermissionDialogOpen(false);
  };

  const openLocationPermissionSettings = async (): Promise<void> => {
    setIsBackgroundPermissionDialogOpen(true);
  };

  return (
    <>
      <LocationPermissionContext.Provider
        value={{
          permissionState,
          isConfiguringLocation:
            isLaunchingLocationSetup ||
            isBackgroundPermissionDialogOpen ||
            isRequestingBackgroundPermission,
          refreshLocationPermissionState,
          openLocationPermissionSettings,
        }}
      >
        {children}
      </LocationPermissionContext.Provider>

      <Dialog
        open={isBackgroundPermissionDialogOpen}
        onOpenChange={(open) => {
          setIsBackgroundPermissionDialogOpen(open);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {permissionState?.missing.includes("foreground") ||
              permissionState?.missing.includes("precise")
                ? "Allow location access"
                : "Allow background location"}
            </DialogTitle>
            <DialogDescription>
              OpenBeacon needs precise and background location so your family and friends can see
              where you are even when you are not actively using the app.{" "}
              {permissionState?.canRequestBackgroundInApp &&
              permissionState.missing.length === 1 &&
              permissionState.missing[0] === "background"
                ? "The app will ask for that access next."
                : "You can update location access in your device settings."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onPress={() => {
                setIsBackgroundPermissionDialogOpen(false);
              }}
            >
              <Text>Not now</Text>
            </Button>
            <Button
              onPress={continueToBackgroundPermission}
              loading={isRequestingBackgroundPermission}
            >
              <Text>Open Settings</Text>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export const useLocationPermissions = () => {
  const context = useContext(LocationPermissionContext);

  if (!context) {
    throw new Error("useLocationPermissions must be used within a LocationPermissionProvider");
  }

  return context;
};
