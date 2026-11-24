import { expect, mock, test } from "bun:test";
import React, { act, type ReactNode } from "react";
import { createRoot } from "test-renderer";
import type { LiveMapMarker } from "../../lib/buildLiveMapMarkers.ts";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const passthrough = ({ children }: { children?: ReactNode }) =>
  React.createElement(React.Fragment, null, children);

mock.module("react-native", () => ({
  ScrollView: passthrough,
  View: ({ children }: { children?: ReactNode }) => React.createElement("view", null, children),
}));
mock.module("expo-router", () => ({ Link: passthrough }));
mock.module("lucide-react-native", () => ({ PencilIcon: () => null, Trash2Icon: () => null }));
mock.module("../../hooks/usePlaceAlertMutes.ts", () => ({
  usePlaceAlertMutes: () => ({ mutes: { data: undefined }, setMute: () => {} }),
}));
mock.module("../../hooks/useUnits.ts", () => ({
  useUnits: () => ({ speed: "kmh", distance: "km" }),
}));
mock.module("../ui/Button.tsx", () => ({ Button: passthrough }));
mock.module("../ui/Icon.tsx", () => ({ Icon: () => null }));
mock.module("../ui/Switch.tsx", () => ({ Switch: () => null }));
mock.module("../ui/Text.tsx", () => ({ Text: passthrough }));
mock.module("./LiveMapBottomSheet.tsx", () => ({ LiveMapBottomSheet: passthrough }));
mock.module("./LiveMapMarkerPin.tsx", () => ({
  LiveMapMarkerPin: ({ image, ringColor }: { image: string | null; ringColor: string }) =>
    React.createElement("pin", { image, ringColor }),
}));

const { LiveMapPlaceSheet } = await import("./LiveMapPlaceSheet.tsx");

test("people here now are drawn with their own picture and group ring", async () => {
  const alice: LiveMapMarker = {
    battery: null,
    deviceId: "device-1",
    image: "https://images.example/alice",
    initials: "Al",
    isSelf: false,
    latitude: 51.5,
    longitude: -0.1,
    name: "Alice",
    otherSharedGroupNames: [],
    ringColor: "#2A9D8F",
    sourceGroupId: "family",
    speed: null,
    timestamp: new Date().toISOString(),
    userId: "alice",
  };
  const root = createRoot();
  await act(async () =>
    root.render(
      <LiveMapPlaceSheet
        here={[alice]}
        onDelete={() => {}}
        onDismiss={() => {}}
        onHeightChange={() => {}}
        place={{
          canManage: false,
          emoji: "🏠",
          groupId: "family",
          groupName: "Family",
          id: "home",
          latitude: 51.5,
          longitude: -0.1,
          memberUserIds: ["alice"],
          name: "Home",
          radiusMeters: 100,
        }}
      />,
    ),
  );
  const [pin] = root.container.queryAll((item) => item.type === "pin");
  expect(pin?.props).toEqual({ image: "https://images.example/alice", ringColor: "#2A9D8F" });
  await act(async () => root.unmount());
});
