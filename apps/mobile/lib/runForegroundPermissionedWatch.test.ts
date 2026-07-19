import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { runForegroundPermissionedWatchCore } from "./runForegroundPermissionedWatchCore.ts";

let appState: string;
let appStateListener: ((nextAppState: string) => void) | null;
let permissionGranted: boolean;
let permissionError: Error | null;
let resolvePermission: ((value: { granted: boolean }) => void) | null;
let deferPermission: boolean;

const flushAsync = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

const runWatch = (
  options: Omit<
    Parameters<typeof runForegroundPermissionedWatchCore>[0],
    "getAppState" | "getForegroundPermissions" | "subscribeAppState"
  >,
) =>
  runForegroundPermissionedWatchCore({
    ...options,
    getAppState: () => appState,
    getForegroundPermissions: () => {
      if (permissionError) {
        return Promise.reject(permissionError);
      }

      if (deferPermission) {
        return new Promise<{ granted: boolean }>((resolve) => {
          resolvePermission = resolve;
        });
      }

      return Promise.resolve({ granted: permissionGranted });
    },
    subscribeAppState: (listener) => {
      appStateListener = listener;
      return {
        remove: () => {
          if (appStateListener === listener) {
            appStateListener = null;
          }
        },
      };
    },
  });

describe("runForegroundPermissionedWatchCore", () => {
  beforeEach(() => {
    appState = "active";
    appStateListener = null;
    permissionGranted = true;
    permissionError = null;
    resolvePermission = null;
    deferPermission = false;
  });

  afterEach(() => {
    appStateListener = null;
    resolvePermission = null;
  });

  test("starts a subscription when foreground permission is granted", async () => {
    let removeCalls = 0;
    const created = {
      resolve: null as null | (() => void),
    };
    const createdPromise = new Promise<void>((resolve) => {
      created.resolve = resolve;
    });

    const stop = runWatch({
      createSubscription: () => {
        created.resolve?.();
        return Promise.resolve({
          remove: () => {
            removeCalls += 1;
          },
        });
      },
    });

    await createdPromise;
    await flushAsync();

    expect(removeCalls).toBe(0);

    stop();
    expect(removeCalls).toBe(1);
  });

  test("does not create a subscription when permission is denied", async () => {
    permissionGranted = false;
    let createCalls = 0;

    const stop = runWatch({
      createSubscription: () => {
        createCalls += 1;
        return Promise.resolve({ remove: () => {} });
      },
    });

    await flushAsync();

    expect(createCalls).toBe(0);
    stop();
  });

  test("cancels an in-flight start when cleaned up before permission resolves", async () => {
    deferPermission = true;
    let createCalls = 0;

    const stop = runWatch({
      createSubscription: () => {
        createCalls += 1;
        return Promise.resolve({ remove: () => {} });
      },
    });

    stop();
    resolvePermission?.({ granted: true });
    await flushAsync();

    expect(createCalls).toBe(0);
  });

  test("drops a subscription created while inactive", async () => {
    let removeCalls = 0;
    const started = {
      resolve: null as null | (() => void),
    };
    const createGate = {
      release: null as null | (() => void),
    };
    const startedPromise = new Promise<void>((resolve) => {
      started.resolve = resolve;
    });

    const stop = runWatch({
      createSubscription: async () => {
        started.resolve?.();
        await new Promise<void>((resolve) => {
          createGate.release = resolve;
        });
        return {
          remove: () => {
            removeCalls += 1;
          },
        };
      },
    });

    await startedPromise;
    appState = "background";
    appStateListener?.("background");
    createGate.release?.();
    await flushAsync();

    expect(removeCalls).toBe(1);
    stop();
  });

  test("stops an active subscription and calls onInactive when backgrounded", async () => {
    let removeCalls = 0;
    let inactiveCalls = 0;
    const created = {
      resolve: null as null | (() => void),
    };
    const createdPromise = new Promise<void>((resolve) => {
      created.resolve = resolve;
    });

    const stop = runWatch({
      createSubscription: () => {
        created.resolve?.();
        return Promise.resolve({
          remove: () => {
            removeCalls += 1;
          },
        });
      },
      onInactive: () => {
        inactiveCalls += 1;
      },
    });

    await createdPromise;
    await flushAsync();
    expect(removeCalls).toBe(0);

    appState = "background";
    appStateListener?.("background");

    expect(removeCalls).toBe(1);
    expect(inactiveCalls).toBe(1);

    stop();
  });
});
