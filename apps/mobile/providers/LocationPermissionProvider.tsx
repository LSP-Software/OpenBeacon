import { tryCatch } from "@openbeacon/shared";
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
import {
  getLocationPermissionState,
  type LocationPermissionState,
  openLocationSettings,
  requestBackgroundLocationPermissions,
  requestLocationPermissionsForLaunch,
} from "../lib/locationPermissions.ts";
import { requestNotificationPermissionsForLaunch } from "../lib/notificationPermissions.ts";

const LocationPermissionContext = createContext<{
  permissionState: LocationPermissionState | null;
  refreshLocationPermissionState: () => Promise<LocationPermissionState | null>;
  openLocationPermissionSettings: () => Promise<void>;
} | null>(null);

export const LocationPermissionProvider = ({ children }: { children: React.ReactNode }) => {
  const { data: session, isPending } = authClient.useSession();
  const [permissionState, setPermissionState] = useState<LocationPermissionState | null>(null);
  const [isBackgroundPermissionDialogOpen, setIsBackgroundPermissionDialogOpen] = useState(false);
  const [isRequestingBackgroundPermission, setIsRequestingBackgroundPermission] = useState(false);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const isCheckingPermissionsRef = useRef(false);
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
      if (!session || isCheckingPermissionsRef.current) {
        return null;
      }

      isCheckingPermissionsRef.current = true;

      const permissionResult = await tryCatch(
        flow === "launchRequest"
          ? requestLocationPermissionsForLaunch()
          : getLocationPermissionState(),
      );

      isCheckingPermissionsRef.current = false;

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
    [session, shouldOpenBackgroundPermissionDialog],
  );

  useEffect(() => {
    if (isPending) {
      return;
    }

    if (!session) {
      setPermissionState(null);
      return;
    }

    void (async () => {
      await syncLocationPermissions("launchRequest");
      await tryCatch(requestNotificationPermissionsForLaunch());
    })();
  }, [isPending, session, syncLocationPermissions]);

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

  const refreshLocationPermissionState = async (): Promise<LocationPermissionState | null> =>
    syncLocationPermissions("refresh");

  const openLocationPermissionSettings = async (): Promise<void> => {
    await openLocationSettings();
  };

  const continueToBackgroundPermission = async () => {
    if (isRequestingBackgroundPermission) {
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

  return (
    <>
      <LocationPermissionContext.Provider
        value={{
          permissionState,
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
            <DialogTitle>Allow background location</DialogTitle>
            <DialogDescription>
              OpenBeacon needs background location so your family can see where you are even when
              you are not actively using the app. The app will ask for that access next.
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
              <Text>Continue</Text>
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
