import { afterEach, describe, expect, mock, test } from "bun:test";
import React, { act } from "react";
import { createRoot, type Root } from "test-renderer";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
let now = Date.parse("2026-07-19T12:00:00.000Z");
let appStateListener: ((state: string) => void) | null = null;
let circles: Array<{
  stroke: string;
  strokeDasharray: string;
  strokeDashoffset: number;
  rotation: number;
}> = [];
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
  default: ({ children }: { children: React.ReactNode }) => children,
  Circle: (props: {
    stroke: string;
    strokeDasharray: string;
    strokeDashoffset: number;
    rotation: number;
  }) => {
    circles.push(props);
    return null;
  },
  Defs: () => null,
  Path: () => null,
  RadialGradient: () => null,
  Stop: () => null,
}));
mock.module("lucide-react-native", () => ({
  ClockIcon: () => null,
  EyeOffIcon: () => null,
  BackpackIcon: () => null,
  Flower2Icon: () => null,
  HeartIcon: () => null,
  StarIcon: () => null,
  SunIcon: () => null,
  TabletIcon: () => null,
  CarIcon: () => null,
  createLucideIcon: () => () => null,
  HouseIcon: () => null,
  LaptopIcon: () => null,
  SmartphoneIcon: () => null,
  TagIcon: () => null,
  WatchIcon: () => null,
}));
mock.module("../ui/Avatar.tsx", () => ({
  Avatar: ({ children }: { children: React.ReactNode }) => children,
  AvatarFallback: () => null,
  AvatarImage: () => null,
}));
mock.module("../ui/Text.tsx", () => ({ Text: () => null }));
mock.module("../ui/Icon.tsx", () => ({ Icon: () => React.createElement("clock") }));
const { LiveMapMarkerPin } = await import("./LiveMapMarkerPin.tsx");

const renderPin = async (
  timestamp: string | null,
  status?: "cantLocate" | "cantRead",
  hasUnreadableUpdate = false,
) => {
  await act(async () => {
    root?.render(
      <LiveMapMarkerPin
        hasUnreadableUpdate={hasUnreadableUpdate}
        image={null}
        initials="AB"
        name="Alice"
        ringColor="#fff"
        status={status}
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
  circles = [];
});

describe("LiveMapMarkerPin", () => {
  test("renders equal segments for two through nine distinct colors", async () => {
    root = createRoot();
    for (let count = 2; count <= 9; count++) {
      circles = [];
      const colors = Array.from({ length: count }, (_, index) => `color-${index}`);
      await act(async () => {
        root?.render(
          <LiveMapMarkerPin
            image={null}
            initials="AB"
            name="Alice"
            ringColor={colors[0]!}
            ringColors={colors}
            timestamp={null}
          />,
        );
      });
      expect(circles).toHaveLength(count);
      for (let index = 0; index < count; index++) {
        const circle = circles[index]!;
        const [segment, gap] = circle.strokeDasharray.split(" ").map(Number);
        expect(circle.stroke).toBe(colors[index]!);
        expect(segment).toBeCloseTo((2 * Math.PI * 20.5) / count);
        expect(gap).toBeCloseTo(2 * Math.PI * 20.5);
        expect(circle.strokeDashoffset).toBeCloseTo((-index * 2 * Math.PI * 20.5) / count);
        expect(circle.rotation).toBe(-90);
      }
    }
    circles = [];
    await renderPin(null);
    expect(circles).toHaveLength(0);
  });

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

  test("shows the status badge and dashed ring instead of the clock when a status is set", async () => {
    root = createRoot();
    const staleTimestamp = new Date(Date.now() - 3_600_000).toISOString();
    await renderPin(staleTimestamp);
    expect(JSON.stringify(root.container.toJSON())).toContain("Location is over 10 minutes old");

    circles = [];
    await renderPin(staleTimestamp, "cantLocate");
    const cantLocate = JSON.stringify(root.container.toJSON());
    expect(cantLocate).toContain("Location unknown");
    expect(cantLocate).not.toContain("Location is over");
    expect(cantLocate).not.toContain("Can’t read location");
    expect(circles.map((circle) => circle.strokeDasharray)).toEqual(["5 4"]);

    circles = [];
    await renderPin(staleTimestamp, "cantRead");
    const cantRead = JSON.stringify(root.container.toJSON());
    expect(cantRead).toContain("Can’t read location");
    expect(cantRead).not.toContain("Location is over");
    expect(cantRead).not.toContain("Location unknown");
    expect(circles.map((circle) => circle.strokeDasharray)).toEqual(["5 4"]);
  });

  test("swaps the clock for a ! when a newer location can't be read, keeping the solid ring", async () => {
    root = createRoot();
    const staleTimestamp = new Date(Date.now() - 3_600_000).toISOString();
    circles = [];
    await renderPin(staleTimestamp, undefined, true);
    const pin = JSON.stringify(root.container.toJSON());
    expect(pin).toContain("Newer location can’t be read");
    expect(pin).not.toContain("Location is over");
    expect(circles).toEqual([]);
  });

  test("names the device badge after the phone's platform", async () => {
    root = createRoot();
    const badge = async (
      deviceIcon: "phone" | "tablet",
      devicePlatform: "android" | "ios" | null,
    ) => {
      await act(async () => {
        root?.render(
          <LiveMapMarkerPin
            deviceIcon={deviceIcon}
            devicePlatform={devicePlatform}
            image={null}
            initials="AB"
            name="Alice"
            ringColor="#fff"
            timestamp={null}
          />,
        );
      });
      return JSON.stringify(root?.container.toJSON());
    };

    expect(await badge("phone", "ios")).toContain('"iPhone"');
    expect(await badge("phone", "android")).toContain('"Android phone"');
    expect(await badge("phone", null)).toContain('"Phone"');
    expect(await badge("tablet", "ios")).toContain('"Landscape tablet"');
  });
});
