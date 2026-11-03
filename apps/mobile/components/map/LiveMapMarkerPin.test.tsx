import { afterEach, describe, expect, mock, test } from "bun:test";
import React, { act } from "react";
import { createRoot, type Root } from "test-renderer";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
let now = Date.parse("2026-07-19T12:00:00.000Z");
let appStateListener: ((state: string) => void) | null = null;
let timers: Array<{ callback: () => void; delay: number }> = [];
const originalNow = Date.now;
const originalSetTimeout = globalThis.setTimeout;
const originalClearTimeout = globalThis.clearTimeout;

mock.module("react-native", () => ({
  AppState: {
    addEventListener: (_event: string, listener: (state: string) => void) => {
      appStateListener = listener;
      return {
        remove: () => {
          appStateListener = null;
        },
      };
    },
  },
  View: ({
    children,
    accessibilityLabel,
  }: {
    children?: React.ReactNode;
    accessibilityLabel?: string;
  }) => React.createElement("view", { accessibilityLabel }, children),
}));
mock.module("react-native-svg", () => ({
  default: () => null,
  Defs: () => null,
  Path: () => null,
  RadialGradient: () => null,
  Stop: () => null,
}));
mock.module("lucide-react-native", () => ({ ClockIcon: () => null }));
mock.module("../ui/Avatar.tsx", () => ({
  Avatar: ({ children }: { children: React.ReactNode }) => children,
  AvatarFallback: () => null,
  AvatarImage: () => null,
}));
mock.module("../ui/Text.tsx", () => ({ Text: () => null }));
mock.module("../ui/Icon.tsx", () => ({ Icon: () => React.createElement("clock") }));
const { LiveMapMarkerPin } = await import("./LiveMapMarkerPin.tsx");

const renderPin = async (timestamp: string | null) => {
  await act(async () => {
    root?.render(
      <LiveMapMarkerPin
        image={null}
        initials="AB"
        name="Alice"
        ringColor="#fff"
        timestamp={timestamp}
      />,
    );
  });
};

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  root = null;
  Date.now = originalNow;
  globalThis.setTimeout = originalSetTimeout;
  globalThis.clearTimeout = originalClearTimeout;
  timers = [];
});

describe("LiveMapMarkerPin", () => {
  test("shows a clock after the threshold and clears it when a new point arrives", async () => {
    now = Date.parse("2026-07-19T12:00:00.000Z");
    Date.now = () => now;
    globalThis.setTimeout = ((callback: TimerHandler, delay?: number) => {
      const timer = { callback: callback as () => void, delay: delay ?? 0 };
      timers.push(timer);
      return timer as unknown as ReturnType<typeof setTimeout>;
    }) as unknown as typeof setTimeout;
    globalThis.clearTimeout = ((timer: ReturnType<typeof setTimeout>) => {
      timers = timers.filter((item) => item !== (timer as never));
    }) as typeof clearTimeout;
    root = createRoot();
    await renderPin(new Date(now - 600_000).toISOString());
    expect(JSON.stringify(root.container.toJSON())).not.toContain("Location is over");
    expect(timers[0]?.delay).toBe(1);
    now += 1;
    await act(async () => {
      timers[0]?.callback();
    });
    expect(JSON.stringify(root.container.toJSON())).toContain("Location is over 10 minutes old");
    await renderPin(new Date(now).toISOString());
    expect(JSON.stringify(root.container.toJSON())).not.toContain("Location is over");
    now += 600_001;
    await act(async () => {
      appStateListener?.("active");
    });
    expect(JSON.stringify(root.container.toJSON())).toContain("Location is over 10 minutes old");
    await renderPin(null);
    expect(JSON.stringify(root.container.toJSON())).not.toContain("Location is over");
  });
});
