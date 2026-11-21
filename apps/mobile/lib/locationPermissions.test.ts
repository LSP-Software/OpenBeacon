import { beforeEach, describe, expect, mock, test } from "bun:test";

let foregroundPermission: {
  status: "granted" | "denied" | "undetermined";
  granted: boolean;
  canAskAgain: boolean;
  ios?: {
    scope: "whenInUse" | "always" | "none";
    accuracy: "full" | "reduced";
  };
  android?: {
    accuracy: "fine" | "coarse" | "none";
  };
};
let backgroundPermission: {
  status: "granted" | "denied" | "undetermined";
  granted: boolean;
  canAskAgain: boolean;
  ios?: {
    scope: "whenInUse" | "always" | "none";
    accuracy: "full" | "reduced";
  };
  android?: {
    accuracy: "fine" | "coarse" | "none";
  };
};

let foregroundRequests = 0;

mock.module("expo-location", () => ({
  enableNetworkProviderAsync: async () => undefined,
  getForegroundPermissionsAsync: async () => foregroundPermission,
  getBackgroundPermissionsAsync: async () => backgroundPermission,
  requestForegroundPermissionsAsync: async () => {
    foregroundRequests += 1;
    return foregroundPermission;
  },
  requestBackgroundPermissionsAsync: async () => backgroundPermission,
}));

const {
  getLocationPermissionState,
  getLocationPermissionWarningDescription,
  getLocationPermissionWarningTitle,
  requestForegroundLocationPermissions,
}: typeof import("./locationPermissions.ts") = await import("./locationPermissions.ts");

const createPermissionResponse = ({
  status,
  granted,
  ios,
  android,
}: {
  status: "granted" | "denied" | "undetermined";
  granted: boolean;
  ios?: {
    scope: "whenInUse" | "always" | "none";
    accuracy: "full" | "reduced";
  };
  android?: {
    accuracy: "fine" | "coarse" | "none";
  };
}) => ({
  status,
  granted,
  canAskAgain: true,
  expires: "never",
  ...(ios === undefined ? {} : { ios }),
  ...(android === undefined ? {} : { android }),
});

describe("locationPermissions", () => {
  beforeEach(() => {
    foregroundRequests = 0;
    foregroundPermission = createPermissionResponse({
      status: "denied",
      granted: false,
    });
    backgroundPermission = createPermissionResponse({
      status: "denied",
      granted: false,
    });
  });

  test("marks foreground as missing when foreground permission is denied", async () => {
    const permissionState = await getLocationPermissionState();

    expect(permissionState.missing).toEqual(["foreground"]);
    expect(permissionState.canRequestBackgroundInApp).toBe(false);
  });

  test("does not allow background escalation when precise location is reduced", async () => {
    foregroundPermission = createPermissionResponse({
      status: "granted",
      granted: true,
      ios: {
        scope: "always",
        accuracy: "reduced",
      },
    });

    const permissionState = await getLocationPermissionState();

    expect(permissionState.missing).toEqual(["precise", "background"]);
    expect(permissionState.canRequestBackgroundInApp).toBe(false);
  });

  test("allows in-app background escalation when android foreground is precise and background is denied", async () => {
    foregroundPermission = createPermissionResponse({
      status: "granted",
      granted: true,
      android: {
        accuracy: "fine",
      },
    });

    const permissionState = await getLocationPermissionState();

    expect(permissionState.missing).toEqual(["background"]);
    expect(permissionState.canRequestBackgroundInApp).toBe(true);
  });

  test("does not request background access again after permission is permanently denied", async () => {
    foregroundPermission = createPermissionResponse({
      status: "granted",
      granted: true,
      android: { accuracy: "fine" },
    });
    backgroundPermission = { ...backgroundPermission, canAskAgain: false };
    expect((await getLocationPermissionState()).canRequestBackgroundInApp).toBe(false);
  });

  test("does not allow in-app background escalation for iOS when scope is whenInUse", async () => {
    foregroundPermission = createPermissionResponse({
      status: "granted",
      granted: true,
      ios: {
        scope: "whenInUse",
        accuracy: "full",
      },
    });

    const permissionState = await getLocationPermissionState();

    expect(permissionState.missing).toEqual(["background"]);
    expect(permissionState.canRequestBackgroundInApp).toBe(false);
  });

  test("does not allow in-app background escalation when background is already granted", async () => {
    foregroundPermission = createPermissionResponse({
      status: "granted",
      granted: true,
      ios: {
        scope: "always",
        accuracy: "full",
      },
    });
    backgroundPermission = createPermissionResponse({
      status: "granted",
      granted: true,
      ios: {
        scope: "always",
        accuracy: "full",
      },
    });

    const permissionState = await getLocationPermissionState();

    expect(permissionState.missing).toEqual([]);
    expect(permissionState.canRequestBackgroundInApp).toBe(false);
  });

  test("asks again when only approximate location is allowed", async () => {
    foregroundPermission = createPermissionResponse({
      status: "granted",
      granted: true,
      android: { accuracy: "coarse" },
    });

    await requestForegroundLocationPermissions();

    expect(foregroundRequests).toBe(1);
  });

  test("does not ask again when precise location is already allowed", async () => {
    foregroundPermission = createPermissionResponse({
      status: "granted",
      granted: true,
      android: { accuracy: "fine" },
    });

    await requestForegroundLocationPermissions();

    expect(foregroundRequests).toBe(0);
  });

  test("asks when location is not allowed yet", async () => {
    await requestForegroundLocationPermissions();

    expect(foregroundRequests).toBe(1);
  });

  test("formats a precise-only warning", () => {
    expect(getLocationPermissionWarningTitle({ missing: ["precise"] })).toBe(
      "Precise location is off",
    );
    expect(getLocationPermissionWarningDescription({ missing: ["precise"] })).toBe(
      "OpenBeacon doesn’t share your location at all while precise location is off. Turn it on to start sharing.",
    );
  });

  test("formats no warning when nothing is missing", () => {
    expect(getLocationPermissionWarningTitle({ missing: [] })).toBe("");
    expect(getLocationPermissionWarningDescription({ missing: [] })).toBe("");
  });

  test("formats a foreground-only warning", () => {
    expect(getLocationPermissionWarningTitle({ missing: ["foreground"] })).toBe("Location is off");
    expect(getLocationPermissionWarningDescription({ missing: ["foreground"] })).toBe(
      "OpenBeacon doesn’t share your location until you allow location all the time, with precise location on.",
    );
  });

  test("formats a background-only warning", () => {
    expect(getLocationPermissionWarningTitle({ missing: ["background"] })).toBe(
      "Background location is off",
    );
    expect(getLocationPermissionWarningDescription({ missing: ["background"] })).toBe(
      "OpenBeacon doesn’t share your location at all, even while the app is open, until you allow location all the time.",
    );
  });

  test("formats a combined precise and background warning", () => {
    expect(getLocationPermissionWarningTitle({ missing: ["precise", "background"] })).toBe(
      "Precise location and Background location are off",
    );
    expect(getLocationPermissionWarningDescription({ missing: ["precise", "background"] })).toBe(
      "OpenBeacon doesn’t share your location until you allow location all the time, with precise location on.",
    );
  });

  test("formats a combined foreground and background warning", () => {
    expect(getLocationPermissionWarningTitle({ missing: ["foreground", "background"] })).toBe(
      "Location access and Background location are off",
    );
    expect(getLocationPermissionWarningDescription({ missing: ["foreground", "background"] })).toBe(
      "OpenBeacon doesn’t share your location until you allow location all the time, with precise location on.",
    );
  });
});
