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

mock.module("expo-location", () => ({
  getForegroundPermissionsAsync: async () => foregroundPermission,
  getBackgroundPermissionsAsync: async () => backgroundPermission,
  requestForegroundPermissionsAsync: async () => foregroundPermission,
  requestBackgroundPermissionsAsync: async () => backgroundPermission,
}));

const { getLocationPermissionState }: typeof import("./locationPermissions.ts") = await import(
  "./locationPermissions.ts"
);

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
});
