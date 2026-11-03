import { afterEach, describe, expect, mock, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "test-renderer";
import { createReactNativeTestModule } from "../test/reactNativeTestModule.ts";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let listener: ((state: { isConnected: boolean }) => void) | undefined;
let root: Root | undefined;
const setOnline = mock((_online: boolean) => {});
let timers: Array<{ callback: () => void; delay: number }> = [];
const originalSetTimeout = globalThis.setTimeout;
const originalClearTimeout = globalThis.clearTimeout;

mock.module("@tanstack/react-query", () => ({ onlineManager: { setOnline } }));
mock.module("expo-network", () => ({
  addNetworkStateListener: (callback: typeof listener) => {
    listener = callback;
    return {
      remove: () => {
        listener = undefined;
      },
    };
  },
  getNetworkStateAsync: async () => ({ isConnected: true }),
}));
mock.module("react-native", () => ({
  ...createReactNativeTestModule(),
  Text: ({ children }: { children: React.ReactNode }) => children,
}));
mock.module("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0 }) }));

const { OfflineBanner } = await import("./OfflineBanner.tsx");

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  root = undefined;
  timers = [];
  globalThis.setTimeout = originalSetTimeout;
  globalThis.clearTimeout = originalClearTimeout;
});

describe("OfflineBanner", () => {
  test("waits for stable connectivity changes before showing or hiding the warning", async () => {
    globalThis.setTimeout = ((callback: TimerHandler, delay?: number) => {
      const timer = { callback: callback as () => void, delay: delay ?? 0 };
      timers.push(timer);
      return timer as unknown as ReturnType<typeof setTimeout>;
    }) as unknown as typeof setTimeout;
    globalThis.clearTimeout = ((timer: ReturnType<typeof setTimeout>) => {
      timers = timers.filter((item) => item !== (timer as never));
    }) as typeof clearTimeout;
    root = createRoot();
    await act(async () => {
      root?.render(<OfflineBanner />);
      await Promise.resolve();
    });
    await act(async () => {
      listener?.({ isConnected: false });
    });
    expect(setOnline).toHaveBeenLastCalledWith(false);
    expect(timers).toHaveLength(1);
    expect(timers[0]?.delay).toBe(5_000);
    const offlineTimer = timers[0];
    await act(async () => {
      listener?.({ isConnected: false });
    });
    expect(timers[0]).toBe(offlineTimer);
    expect(JSON.stringify(root.container.toJSON())).not.toContain("No internet connection");
    await act(async () => {
      listener?.({ isConnected: true });
    });
    expect(setOnline).toHaveBeenLastCalledWith(true);
    expect(timers).toHaveLength(1);
    await act(async () => {
      listener?.({ isConnected: false });
    });
    await act(async () => {
      timers[0]?.callback();
    });
    expect(JSON.stringify(root.container.toJSON())).toContain("No internet connection");
    await act(async () => {
      listener?.({ isConnected: true });
    });
    expect(JSON.stringify(root.container.toJSON())).toContain("No internet connection");
    const onlineTimer = timers[0];
    await act(async () => {
      listener?.({ isConnected: true });
    });
    expect(timers[0]).toBe(onlineTimer);
    await act(async () => {
      timers[0]?.callback();
    });
    expect(JSON.stringify(root.container.toJSON())).not.toContain("No internet connection");
  });
});
