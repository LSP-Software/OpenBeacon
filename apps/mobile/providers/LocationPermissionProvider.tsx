import { tryCatch } from "@openbeacon/shared";
import { useGlobalSearchParams, usePathname } from "expo-router";
import type React from "react";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
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
import { useAppForeground } from "../hooks/useAppForeground.ts";
import { authClient } from "../lib/auth-client.ts";
import { useThisDeviceState } from "../lib/deviceActivation.ts";
import {
  getLocationPermissionState,
  type LocationPermissionState,
  openLocationSettings,
  requestBackgroundLocationPermissions,
  requestForegroundLocationPermissions,
} from "../lib/locationPermissions.ts";
import { dismissNotice } from "../lib/notifications.ts";
import { thisDeviceNoun } from "../lib/thisDeviceNoun.ts";

const LocationPermissionContext = createContext<{
  permissionState: LocationPermissionState | null;
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
  const readyToCheck = Boolean(session) && thisDeviceActive && !inSetup;
  const [permissionState, setPermissionState] = useState<LocationPermissionState | null>(null);
  const [isPermissionDialogOpen, setIsPermissionDialogOpen] = useState(false);
  const [isRequestingPermission, setIsRequestingPermission] = useState(false);
  const permissionCheckRef = useRef<Promise<LocationPermissionState | null> | null>(null);

  const syncLocationPermissions = useCallback(async (): Promise<LocationPermissionState | null> => {
    if (!readyToCheck) return null;
    if (permissionCheckRef.current) return permissionCheckRef.current;
    const check = (async () => {
      const result = await tryCatch(getLocationPermissionState());
      if (result.error) return null;
      setPermissionState(result.data);
      return result.data;
    })();
    permissionCheckRef.current = check;
    const checked = await check;
    permissionCheckRef.current = null;
    return checked;
  }, [readyToCheck]);

  useEffect(() => {
    if (isPending) {
      return;
    }

    if (!readyToCheck) {
      setPermissionState(null);
      return;
    }

    void syncLocationPermissions();
  }, [isPending, readyToCheck, syncLocationPermissions]);

  useAppForeground(() => void syncLocationPermissions());

  useEffect(() => {
    if (permissionState?.isReadyForSharing) void dismissNotice("locationPermission");
  }, [permissionState?.isReadyForSharing]);

  const refreshLocationPermissionState = async (): Promise<LocationPermissionState | null> =>
    syncLocationPermissions();

  const canAskInApp =
    permissionState?.foregroundStatus === "undetermined" ||
    (permissionState?.canRequestBackgroundInApp === true &&
      permissionState.missing.length === 1 &&
      permissionState.missing[0] === "background");

  const continueToPermission = async () => {
    if (isRequestingPermission) {
      return;
    }

    if (!canAskInApp) {
      setIsPermissionDialogOpen(false);
      await openLocationSettings();
      return;
    }

    setIsRequestingPermission(true);

    const permissionResult = await tryCatch(
      permissionState?.foregroundStatus === "undetermined"
        ? requestForegroundLocationPermissions()
        : requestBackgroundLocationPermissions(),
    );

    setIsRequestingPermission(false);

    if (permissionResult.error) {
      return;
    }

    setPermissionState(permissionResult.data);
    setIsPermissionDialogOpen(false);
  };

  const openLocationPermissionSettings = async (): Promise<void> => {
    setIsPermissionDialogOpen(true);
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

      <Dialog open={isPermissionDialogOpen} onOpenChange={setIsPermissionDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {permissionState?.missing.includes("foreground") ||
              permissionState?.missing.includes("precise")
                ? "Allow location access"
                : "Allow background location"}
            </DialogTitle>
            <DialogDescription>
              OpenBeacon only shares your location once it has precise location all the time. Until
              then, nothing is shared.{" "}
              {canAskInApp
                ? "The app will ask for that access next."
                : `You can update location access in your ${thisDeviceNoun()} settings.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="secondary"
              onPress={() => {
                setIsPermissionDialogOpen(false);
              }}
            >
              <Text>Not now</Text>
            </Button>
            <Button onPress={continueToPermission} loading={isRequestingPermission}>
              <Text>{canAskInApp ? "Continue" : "Open Settings"}</Text>
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
