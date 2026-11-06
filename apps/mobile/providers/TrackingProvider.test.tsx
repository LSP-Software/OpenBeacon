import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "test-renderer";
import { requestTrackingSync } from "../lib/trackingEvents.ts";
import { createReactNativeTestModule } from "../test/reactNativeTestModule.ts";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let sessionState: {
  data: null | {
    user: {
      id: string;
    };
  };
  isPending: boolean;
};
let appStateListener: ((nextAppState: string) => void) | null = null;
let reconcileGate: Promise<void> | null = null;
let reconcileCalls: Array<{ startCapture: boolean }> = [];
let flushCalls = 0;
let flushModes: boolean[] = [];
let revokeCalls = 0;
let isReadyForSharing = true;
let failFlush = false;
let failReconcile = false;
let alerts = 0;
let recoveryPrompt: { count: number; deviceIds: string[]; server: string; userId: string } | null =
  null;
let alertButtons: Array<{ text: string; onPress?: () => void }> = [];
let recovered: Array<{ deviceIds: string[]; userId: string }> = [];
let root: Root | null = null;
const invalidateQueries = mock(async (_input: { queryKey: string[] }) => {});
const queryClient = { invalidateQueries };
const trackingService = {
  reconcileTrackingKeys: async (input: { startCapture: boolean }) => {
    reconcileCalls.push(input);
    await reconcileGate;
    if (failReconcile) throw new Error("group key error");
  },
  flushPendingTrackingPoints: async (force = false) => {
    flushCalls += 1;
    flushModes.push(force);
    if (failFlush) throw new Error("offline");
  },
  revokeTrackingAccess: async () => {
    revokeCalls += 1;
  },
  resumeTracking: async () => {},
  getUnassignedTrackingPoints: async () => recoveryPrompt,
  recoverUnassignedTrackingPoints: async (input: { deviceIds: string[]; userId: string }) => {
    recovered.push(input);
  },
};

mock.module("react-native", () => ({
  ...createReactNativeTestModule({
    appState: {
      currentState: "active",
      addEventListener: (_event: string, listener: (nextAppState: string) => void) => {
        appStateListener = listener;
        return {
          remove: () => {
            if (appStateListener === listener) {
              appStateListener = null;
            }
          },
        };
      },
    },
    platformOS: "android",
  }),
  Alert: {
    alert: (_title: string, _message: string, buttons: typeof alertButtons = []) => {
      alerts += 1;
      alertButtons = buttons;
    },
  },
}));

mock.module("../lib/auth-client.ts", () => ({
  authClient: {
    useSession: () => sessionState,
  },
}));

mock.module("@tanstack/react-query", () => ({
  useQueryClient: () => queryClient,
}));

mock.module("./LocationPermissionProvider.tsx", () => ({
  useLocationPermissions: () => ({
    permissionState: {
      isReadyForSharing,
    },
  }),
}));

const { TrackingProvider }: typeof import("./TrackingProvider.tsx") =
  await import("./TrackingProvider.tsx");

const flushEffects = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

const renderProvider = async () => {
  root = createRoot();
  await act(async () => {
    root?.render(<TrackingProvider service={trackingService}>{null}</TrackingProvider>);
    await Promise.resolve();
    await Promise.resolve();
  });
};

describe("TrackingProvider", () => {
  beforeEach(() => {
    sessionState = {
      data: {
        user: {
          id: "user-1",
        },
      },
      isPending: false,
    };
    appStateListener = null;
    reconcileCalls = [];
    reconcileGate = null;
    flushCalls = 0;
    flushModes = [];
    revokeCalls = 0;
    isReadyForSharing = true;
    failFlush = false;
    failReconcile = false;
    alerts = 0;
    recoveryPrompt = null;
    alertButtons = [];
    recovered = [];
    root = null;
    invalidateQueries.mockClear();
  });

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount();
        await Promise.resolve();
      });
    }
  });

  test("reconciles keys and flushes on authenticated launch", async () => {
    await renderProvider();

    expect(reconcileCalls).toEqual([{ startCapture: true }]);
    expect(flushCalls).toBe(1);
    expect(flushModes).toEqual([true]);
    expect(revokeCalls).toBe(0);
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["groupKeyAccess"] });
  });

  test("asks before assigning legacy locations to the current server", async () => {
    recoveryPrompt = {
      count: 2,
      deviceIds: ["device-1"],
      server: "https://example.test",
      userId: "user-1",
    };
    await renderProvider();
    await flushEffects();
    expect(alerts).toBe(1);
    expect(recovered).toEqual([]);
    expect(alertButtons.map((button) => button.text)).toEqual(["Keep on device", "Upload"]);
    alertButtons[1]?.onPress?.();
    await flushEffects();
    expect(recovered).toEqual([{ deviceIds: ["device-1"], userId: "user-1" }]);
  });

  test("reconciles again when the app resumes", async () => {
    await renderProvider();

    appStateListener?.("background");
    await flushEffects();
    appStateListener?.("active");
    await flushEffects();

    expect(reconcileCalls).toEqual([{ startCapture: true }, { startCapture: true }]);
    expect(flushCalls).toBe(2);
  });

  test("reconciles immediately after group or epoch changes", async () => {
    await renderProvider();

    requestTrackingSync();
    await flushEffects();

    expect(reconcileCalls).toEqual([{ startCapture: true }, { startCapture: true }]);
    expect(flushCalls).toBe(2);
  });

  test("does not show a permission alert for tracking sync failures", async () => {
    failReconcile = true;
    failFlush = true;
    await renderProvider();

    expect(alerts).toBe(0);
    expect(flushCalls).toBe(1);
  });

  test("reruns when a group change arrives during an active cycle", async () => {
    await renderProvider();
    let releaseReconcile = () => {};
    reconcileGate = new Promise((resolve) => {
      releaseReconcile = resolve;
    });

    requestTrackingSync();
    await flushEffects();
    requestTrackingSync();
    reconcileGate = null;
    releaseReconcile();
    await flushEffects();

    expect(reconcileCalls).toEqual([
      { startCapture: true },
      { startCapture: true },
      { startCapture: true },
    ]);
    expect(flushCalls).toBe(3);
  });

  test("provisions keys without starting capture before location sharing is ready", async () => {
    isReadyForSharing = false;

    await renderProvider();

    expect(reconcileCalls).toEqual([{ startCapture: false }]);
  });

  test("reconciles when location sharing permission changes", async () => {
    isReadyForSharing = false;
    await renderProvider();

    for (const ready of [true, false]) {
      isReadyForSharing = ready;
      await act(async () => {
        root?.render(<TrackingProvider service={trackingService}>{null}</TrackingProvider>);
        await Promise.resolve();
        await Promise.resolve();
      });
    }

    expect(reconcileCalls).toEqual([
      { startCapture: false },
      { startCapture: true },
      { startCapture: false },
    ]);
  });

  test("revokes native tracking access on logout", async () => {
    await renderProvider();
    sessionState = {
      data: null,
      isPending: false,
    };

    await act(async () => {
      root?.render(<TrackingProvider service={trackingService}>{null}</TrackingProvider>);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(revokeCalls).toBe(1);
  });

  test("revokes the previous account before reconciling an account switch", async () => {
    await renderProvider();
    sessionState = {
      data: {
        user: {
          id: "user-2",
        },
      },
      isPending: false,
    };

    await act(async () => {
      root?.render(<TrackingProvider service={trackingService}>{null}</TrackingProvider>);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(revokeCalls).toBe(1);
    expect(reconcileCalls).toEqual([{ startCapture: true }, { startCapture: true }]);
  });
});
