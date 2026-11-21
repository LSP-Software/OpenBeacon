import { afterEach, expect, mock, test } from "bun:test";
import React, { act } from "react";
import { createRoot, type Root } from "test-renderer";
import type { LiveMapMarker } from "../lib/buildLiveMapMarkers.ts";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const Passthrough = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
mock.module("react-native", () => ({
  AppState: { currentState: "active", addEventListener: () => ({ remove: () => {} }) },
  Platform: { OS: "android" },
  Pressable: ({
    accessibilityLabel,
    accessibilityRole,
    children,
  }: {
    accessibilityLabel?: string;
    accessibilityRole?: string;
    children?: React.ReactNode;
  }) => React.createElement("pressable", { accessibilityLabel, accessibilityRole }, children),
  View: ({
    accessibilityLabel,
    accessibilityRole,
    accessible,
    children,
  }: {
    accessibilityLabel?: string;
    accessibilityRole?: string;
    accessible?: boolean;
    children?: React.ReactNode;
  }) =>
    React.createElement(
      accessible ? "pressable" : "view",
      accessible ? { accessibilityLabel, accessibilityRole } : null,
      children,
    ),
}));
mock.module("@maplibre/maplibre-react-native", () => ({
  Marker: Passthrough,
  ViewAnnotation: Passthrough,
}));
mock.module("expo-router", () => ({ Link: Passthrough }));
mock.module("lucide-react-native", () => ({
  GaugeIcon: () => null,
  HistoryIcon: () => null,
  RefreshCwIcon: () => null,
}));
mock.module("../components/ui/Button.tsx", () => ({ Button: Passthrough }));
mock.module("../hooks/useSelfDeviceHeading.ts", () => ({ useSelfDeviceHeading: () => null }));
mock.module("../hooks/useSpeedUnit.ts", () => ({ useSpeedUnit: () => ({ unit: "mph" }) }));
mock.module("../hooks/useTimeSince.ts", () => ({
  useTimeSince: (timestamp: string | null) => (timestamp ? "1 min ago" : null),
}));
mock.module("../lib/batteryVisual.ts", () => ({
  getBatteryVisual: ({ batteryLevel }: { batteryLevel: number | null }) => ({
    colorClass: "",
    icon: () => null,
    label: batteryLevel === null ? null : `${batteryLevel}%`,
  }),
}));
mock.module("../lib/deviceIcons.ts", () => ({
  deviceIconFor: () => ({ icon: () => null, label: "Phone" }),
}));
mock.module("../components/map/LiveMapMarkerPin.tsx", () => ({ LiveMapMarkerPin: () => null }));
mock.module("../components/map/LiveMapPinMotion.tsx", () => ({ LiveMapPinMotion: Passthrough }));
mock.module("../components/map/LiveMapBottomSheet.tsx", () => ({
  LiveMapBottomSheet: ({
    children,
    header,
  }: {
    children?: React.ReactNode;
    header: React.ReactNode;
  }) => (
    <>
      {header}
      {children}
    </>
  ),
}));
mock.module("../components/image/DecryptedAvatarImage.tsx", () => ({
  DecryptedAvatarImage: () => null,
}));
mock.module("../components/ui/Avatar.tsx", () => ({
  Avatar: Passthrough,
  AvatarFallback: Passthrough,
  AvatarImage: () => null,
}));
mock.module("../components/ui/Icon.tsx", () => ({ Icon: () => null }));
mock.module("../components/ui/Text.tsx", () => ({ Text: Passthrough }));

const { LiveMapPointAnnotation } = await import("../components/map/LiveMapPointAnnotation.tsx");
const { LiveMapPersonSheet } = await import("../components/map/LiveMapPersonSheet.tsx");

let root: Root | null = null;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
});

const pressables = async (element: React.ReactElement) => {
  root = createRoot();
  await act(async () => root?.render(element));
  return (root?.container.queryAll((item) => item.type === "pressable") ?? []).map((item) => {
    const { accessibilityLabel, accessibilityRole } = item.props as {
      accessibilityLabel?: string;
      accessibilityRole?: string;
    };
    return { accessibilityLabel, accessibilityRole };
  });
};

const marker = (overrides: Partial<LiveMapMarker>): LiveMapMarker => ({
  battery: null,
  deviceId: "device-1",
  image: null,
  initials: "Al",
  isSelf: false,
  latitude: 51.5,
  longitude: -0.1,
  name: "Alice",
  otherSharedGroupNames: [],
  ringColor: "red",
  sourceGroupId: "group-1",
  speed: null,
  timestamp: new Date().toISOString(),
  userId: "alice",
  ...overrides,
});

test.each([
  [{}, "Alice"],
  [{ deviceName: "Work phone" }, "Alice, Work phone"],
  [
    { deviceName: "Work phone", mergedDeviceIds: ["device-1", "device-2"] },
    "Alice, 2 devices here",
  ],
  [{ timestamp: "2026-11-11T12:00:00.000Z" }, "Alice, Location is over 10 minutes old"],
  [
    { deviceName: "Work phone", unreadableGroup: { id: "group-1", name: "Family" } },
    "Alice, Work phone, Newer location can’t be read",
  ],
] satisfies [Partial<LiveMapMarker>, string][])(
  "map pin %p is announced as %p",
  async (overrides, label) => {
    const [pin] = await pressables(
      <LiveMapPointAnnotation
        headingDegrees={null}
        marker={marker(overrides)}
        onDeselected={() => {}}
        onSelected={() => {}}
      />,
    );
    expect(pin?.accessibilityLabel).toBe(label);
  },
);

test("a device row without a location on the map isn't a button", async () => {
  const device = {
    battery: null,
    icon: "phone" as const,
    isThisDevice: false,
    paused: false,
    platform: null,
    speed: null,
    unreadable: false,
  };
  const rows = await pressables(
    <LiveMapPersonSheet
      battery={null}
      devices={[
        { ...device, deviceId: "device-1", name: "Phone", timestamp: "2026-11-11T12:00:00.000Z" },
        { ...device, deviceId: "device-2", name: "Tablet", timestamp: null },
        {
          ...device,
          battery: { charging: false, level: 40 },
          deviceId: "device-3",
          isThisDevice: true,
          name: "Pixel",
          timestamp: "2026-11-11T12:00:00.000Z",
          unreadable: true,
        },
      ]}
      image={null}
      initials="Al"
      name="Alice"
      onDismiss={() => {}}
      otherSharedGroupNames={[]}
      speed={null}
      timestamp={null}
    />,
  );
  expect(rows).toEqual([
    { accessibilityLabel: "Show Phone, Updated 1 min ago", accessibilityRole: "button" },
    {
      accessibilityLabel: "Show Pixel (this phone), Newer location can’t be read, battery 40%",
      accessibilityRole: "button",
    },
  ]);
});

test("a device that went quiet on a low battery may be out of battery, except on your own sheet", async () => {
  const device = {
    icon: "phone" as const,
    isThisDevice: false,
    paused: false,
    platform: null,
    speed: null,
    timestamp: new Date(Date.now() - 2 * 3_600_000).toISOString(),
    unreadable: false,
  };
  const sheet = (isSelf: boolean) => (
    <LiveMapPersonSheet
      battery={null}
      devices={[
        { ...device, battery: { charging: false, level: 4 }, deviceId: "device-1", name: "Phone" },
        { ...device, battery: { charging: true, level: 4 }, deviceId: "device-2", name: "Tablet" },
      ]}
      image={null}
      initials="Al"
      isSelf={isSelf}
      name="Alice"
      onDismiss={() => {}}
      otherSharedGroupNames={[]}
      speed={null}
      timestamp={null}
    />
  );
  expect((await pressables(sheet(false))).map((row) => row.accessibilityLabel)).toEqual([
    "Show Phone, May be out of battery, 2h ago, battery 4%",
    "Show Tablet, Updated 1 min ago, battery 4%",
  ]);
  expect((await pressables(sheet(true))).map((row) => row.accessibilityLabel)).toEqual([
    "Show Phone, Updated 1 min ago, battery 4%",
    "Show Tablet, Updated 1 min ago, battery 4%",
  ]);
});

test.each([
  [10, "Battery was at 10%. Alice’s phone may have run out."],
  [11, "Alice’s phone hasn’t sent a location since then."],
])("a quiet phone last seen at %p%% says %p", async (level, text) => {
  root = createRoot();
  await act(async () =>
    root?.render(
      <LiveMapPersonSheet
        battery={{ charging: false, level }}
        image={null}
        initials="Al"
        name="Alice"
        onDismiss={() => {}}
        otherSharedGroupNames={[]}
        speed={null}
        timestamp={new Date(Date.now() - 2 * 3_600_000).toISOString()}
      />,
    ),
  );
  expect(JSON.stringify(root?.container.toJSON())).toContain(text);
});

test("someone with several devices still gets a way to open the group whose key is missing", async () => {
  const device = {
    battery: null,
    icon: "phone" as const,
    isThisDevice: false,
    paused: false,
    platform: null,
    speed: null,
    timestamp: null,
  };
  const links = (
    await pressables(
      <LiveMapPersonSheet
        battery={null}
        devices={[
          { ...device, deviceId: "device-1", name: "Phone", unreadable: true },
          { ...device, deviceId: "device-2", name: "Tablet", unreadable: false },
        ]}
        image={null}
        initials="Al"
        name="Alice"
        onDismiss={() => {}}
        otherSharedGroupNames={[]}
        speed={null}
        timestamp={null}
        unreadableGroup={{ id: "group-1", name: "Family" }}
      />,
    )
  ).filter((item) => item.accessibilityRole === "link");
  expect(links).toHaveLength(1);
  expect(JSON.stringify(root?.container.toJSON())).toContain(`["Open ","Family"]`);
});

test.each([
  [15.2, 30_000, "34 mph"],
  [0.5, 30_000, null],
  [15.2, 4 * 60_000, null],
])("a fix at %p m/s from %p ms ago shows speed %p", async (speed, age, text) => {
  root = createRoot();
  await act(async () =>
    root?.render(
      <LiveMapPersonSheet
        battery={null}
        image={null}
        initials="Al"
        name="Alice"
        onDismiss={() => {}}
        otherSharedGroupNames={[]}
        speed={speed}
        timestamp={new Date(Date.now() - age).toISOString()}
      />,
    ),
  );
  const rendered = JSON.stringify(root?.container.toJSON());
  if (text) {
    expect(rendered).toContain(`"${text}"`);
  } else {
    expect(rendered).not.toContain("mph");
  }
});

test("the speed chip goes the moment the fix passes three minutes old", async () => {
  root = createRoot();
  await act(async () =>
    root?.render(
      <LiveMapPersonSheet
        battery={null}
        image={null}
        initials="Al"
        name="Alice"
        onDismiss={() => {}}
        otherSharedGroupNames={[]}
        speed={15.2}
        timestamp={new Date(Date.now() - 3 * 60_000 + 50).toISOString()}
      />,
    ),
  );
  expect(JSON.stringify(root?.container.toJSON())).toContain(`"34 mph"`);
  await act(async () => new Promise((resolve) => setTimeout(resolve, 100)));
  expect(JSON.stringify(root?.container.toJSON())).not.toContain("mph");
});

test("a moving device shows its speed on its own row", async () => {
  const device = {
    battery: null,
    icon: "phone" as const,
    isThisDevice: false,
    platform: null,
    timestamp: new Date(Date.now() - 30_000).toISOString(),
    unreadable: false,
  };
  const rows = await pressables(
    <LiveMapPersonSheet
      battery={null}
      devices={[
        { ...device, deviceId: "device-1", name: "Phone", paused: false, speed: 15.2 },
        { ...device, deviceId: "device-2", name: "Tablet", paused: false, speed: 0.3 },
        { ...device, deviceId: "device-3", name: "Watch", paused: false, speed: 120 },
        { ...device, deviceId: "device-4", name: "Car", paused: true, speed: 15.2 },
        {
          ...device,
          deviceId: "device-5",
          name: "Old phone",
          paused: false,
          speed: 15.2,
          timestamp: new Date(Date.now() - 4 * 60_000).toISOString(),
        },
      ]}
      image={null}
      initials="Al"
      name="Alice"
      onDismiss={() => {}}
      otherSharedGroupNames={[]}
      speed={null}
      timestamp={null}
    />,
  );
  expect(rows.map((row) => row.accessibilityLabel)).toEqual([
    "Show Phone, Updated 1 min ago, moving at 34 mph",
    "Show Tablet, Updated 1 min ago",
    "Show Watch, Updated 1 min ago",
    "Show Car, Location sharing paused",
    "Show Old phone, Updated 1 min ago",
  ]);
});
