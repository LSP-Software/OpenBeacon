import { afterEach, expect, mock, test } from "bun:test";
import React, { act } from "react";
import { createRoot, type Root } from "test-renderer";
import type { LiveMapMarker } from "../lib/buildLiveMapMarkers.ts";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const Passthrough = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
mock.module("react-native", () => ({
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
  View: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("view", null, children),
}));
mock.module("@maplibre/maplibre-react-native", () => ({
  Marker: Passthrough,
  ViewAnnotation: Passthrough,
}));
mock.module("expo-router", () => ({ Link: Passthrough }));
mock.module("../hooks/useSelfDeviceHeading.ts", () => ({ useSelfDeviceHeading: () => null }));
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
  timestamp: "2026-11-11T12:00:00.000Z",
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

test("someone with several devices still gets a way to open the group whose key is missing", async () => {
  const device = {
    battery: null,
    icon: "phone" as const,
    isThisDevice: false,
    paused: false,
    platform: null,
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
        timestamp={null}
        unreadableGroup={{ id: "group-1", name: "Family" }}
      />,
    )
  ).filter((item) => item.accessibilityRole === "link");
  expect(links).toHaveLength(1);
  expect(JSON.stringify(root?.container.toJSON())).toContain(`["Open ","Family"]`);
});
