import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import TestRenderer, { act } from "react-test-renderer";
import { requestTrackingSync } from "../lib/trackingEvents.ts";

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
let revokeCalls = 0;
let isReadyForSharing = true;
let renderer: TestRenderer.ReactTestRenderer | null = null;
const trackingService = {
  reconcileTrackingKeys: async (input: { startCapture: boolean }) => {
    reconcileCalls.push(input);
    await reconcileGate;
  },
  flushPendingTrackingPoints: async () => {
    flushCalls += 1;
  },
  revokeTrackingAccess: async () => {
    revokeCalls += 1;
  },
};

mock.module("react-native", () => ({
  AppState: {
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
  Platform: {
    OS: "android",
  },
}));

mock.module("../lib/auth-client.ts", () => ({
  authClient: {
    useSession: () => sessionState,
  },
}));

mock.module("./LocationPermissionProvider.tsx", () => ({
  useLocationPermissions: () => ({
    permissionState: {
      isReadyForSharing,
    },
  }),
}));

const { TrackingProvider }: typeof import("./TrackingProvider.tsx") = await import(
  "./TrackingProvider.tsx"
);

const flushEffects = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

const renderProvider = async () => {
  await act(async () => {
    renderer = TestRenderer.create(
      <TrackingProvider service={trackingService}>{null}</TrackingProvider>,
    );
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
    revokeCalls = 0;
    isReadyForSharing = true;
    renderer = null;
  });

  afterEach(async () => {
    if (renderer) {
      await act(async () => {
        renderer?.unmount();
        await Promise.resolve();
      });
    }
  });

  test("reconciles keys and flushes on authenticated launch", async () => {
    await renderProvider();

    expect(reconcileCalls).toEqual([{ startCapture: true }]);
    expect(flushCalls).toBe(1);
    expect(revokeCalls).toBe(0);
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

  test("revokes native tracking access on logout", async () => {
    await renderProvider();
    sessionState = {
      data: null,
      isPending: false,
    };

    await act(async () => {
      renderer?.update(<TrackingProvider service={trackingService}>{null}</TrackingProvider>);
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
      renderer?.update(<TrackingProvider service={trackingService}>{null}</TrackingProvider>);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(revokeCalls).toBe(1);
    expect(reconcileCalls).toEqual([{ startCapture: true }, { startCapture: true }]);
  });
});
