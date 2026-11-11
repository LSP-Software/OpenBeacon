import { afterEach, expect, mock, test } from "bun:test";
import React, { act } from "react";
import { createRoot, type Root } from "test-renderer";
import type { LiveMapMarker } from "../../lib/buildLiveMapMarkers.ts";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const Passthrough = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
let pins: Array<React.ComponentProps<typeof import("./LiveMapMarkerPin.tsx").LiveMapMarkerPin>> =
  [];
let root: Root | null = null;

mock.module("react-native", () => ({
  View: Passthrough,
  Pressable: Passthrough,
  ScrollView: Passthrough,
}));
mock.module("../ui/Avatar.tsx", () => ({
  Avatar: Passthrough,
  AvatarFallback: Passthrough,
  AvatarImage: () => null,
}));
mock.module("../ui/Text.tsx", () => ({ Text: Passthrough }));
mock.module("../../hooks/useTimeSince.ts", () => ({ useTimeSince: () => "1 min ago" }));
mock.module("./LiveMapBottomSheet.tsx", () => ({ LiveMapBottomSheet: Passthrough }));
mock.module("./LiveMapMarkerPin.tsx", () => ({
  LiveMapMarkerPin: (props: (typeof pins)[number]) => {
    pins.push(props);
    return null;
  },
}));

const { LiveMapStackPin } = await import("./LiveMapStackPin.tsx");
const { LiveMapStackSheet } = await import("./LiveMapStackSheet.tsx");

const marker = (deviceId: string, ringColor: string, ringColors?: string[]): LiveMapMarker => ({
  battery: null,
  deviceId,
  image: null,
  initials: "Al",
  isSelf: false,
  latitude: 51.5,
  longitude: -0.1,
  name: "Alice",
  otherSharedGroupNames: [],
  ringColor,
  ...(ringColors ? { ringColors } : {}),
  sourceGroupId: "family",
  timestamp: null,
  userId: deviceId,
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  pins = [];
});

test("the stack ring includes each distinct color, including members behind the visible avatars", async () => {
  root = createRoot();
  await act(async () => {
    root?.render(
      <LiveMapStackPin
        members={[
          marker("one", "red", ["red", "blue"]),
          marker("two", "blue"),
          marker("three", "green"),
          marker("four", "purple", ["purple", "orange"]),
        ]}
      />,
    );
  });
  expect(pins[0]?.ringColors).toEqual(["red", "blue", "green", "purple", "orange"]);
});

test("a stack sharing one color keeps a solid ring", async () => {
  root = createRoot();
  await act(async () => {
    root?.render(<LiveMapStackPin members={[marker("one", "red"), marker("two", "red")]} />);
  });
  expect(pins[0]?.ringColor).toBe("red");
  expect(pins[0]?.ringColors).toBeUndefined();
});

test("the stack popup renders each person's own group colors with the existing pin", async () => {
  const members = [marker("one", "red", ["red", "blue"]), marker("two", "green")];
  root = createRoot();
  await act(async () => {
    root?.render(
      <LiveMapStackSheet
        members={members}
        onDismiss={() => {}}
        onHeightChange={() => {}}
        onSelectDevice={() => {}}
      />,
    );
  });
  expect(pins.map(({ ringColor, ringColors }) => ({ ringColor, ringColors }))).toEqual([
    { ringColor: "red", ringColors: ["red", "blue"] },
    { ringColor: "green", ringColors: undefined },
  ]);
});
