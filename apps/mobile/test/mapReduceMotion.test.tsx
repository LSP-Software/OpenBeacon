import { expect, mock, test } from "bun:test";
import React, { act } from "react";
import { createRoot } from "test-renderer";
import type { LiveMapMarker } from "../lib/buildLiveMapMarkers.ts";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

class FakeAnimatedValue {
  value: number;
  constructor(value: number) {
    this.value = value;
  }
  setValue(value: number) {
    this.value = value;
  }
  stopAnimation(callback?: (value: number) => void) {
    callback?.(this.value);
  }
}

const element =
  (type: string) =>
  ({ children, ...props }: { children?: React.ReactNode }) =>
    React.createElement(type, props, children);

mock.module("react-native", () => ({
  Platform: { OS: "ios" },
  AccessibilityInfo: {
    addEventListener: () => ({ remove: () => {} }),
    isReduceMotionEnabled: async () => true,
  },
  ActivityIndicator: element("activity-indicator"),
  Animated: {
    Value: FakeAnimatedValue,
    View: element("animated-view"),
    parallel: () => ({ start: () => {} }),
    spring: () => ({ start: () => {} }),
    timing: () => ({ start: () => {} }),
  },
  PanResponder: { create: () => ({ panHandlers: {} }) },
  Pressable: element("pressable"),
  View: element("view"),
}));
mock.module("@tanstack/react-query", () => ({
  useMutation: () => ({ isPending: false, mutate: () => {} }),
  useQuery: () => ({ isError: false, isFetching: false, isSuccess: true }),
  useQueryClient: () => ({ invalidateQueries: async () => {} }),
}));
mock.module("../hooks/useGroupColorRevision.ts", () => ({ useGroupColorRevision: () => 0 }));
mock.module("../lib/auth-client.ts", () => ({
  authClient: { useSession: () => ({ data: { user: { id: "me" } } }) },
}));
mock.module("../lib/groupColorSync.ts", () => ({
  groupColorSyncQueryOptions: () => ({}),
  saveGroupColor: async () => {},
}));
mock.module("../lib/storage.ts", () => ({
  storage: { getString: () => undefined, set: () => {}, remove: () => {} },
}));
mock.module("../lib/alert.ts", () => ({ Alert: { alert: () => {} } }));
mock.module("../components/ui/Text.tsx", () => ({ Text: element("text") }));
mock.module("../components/ui/Button.tsx", () => ({ Button: element("button") }));
mock.module("../components/map/LiveMapMarkerPin.tsx", () => ({ LiveMapMarkerPin: () => null }));
mock.module("../components/map/LiveMapStackPin.tsx", () => ({ LiveMapStackPin: () => null }));

mock.module("../components/map/MapSurface.tsx", () => ({
  MapBottomInset: React.createContext(0),
  MapSurface: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("map-surface", null, children),
  useMapBottomInset: () => 0,
}));
const { LiveMapPinMotion } = await import("../components/map/LiveMapPinMotion.tsx");
const { LiveMapBottomSheet } = await import("../components/map/LiveMapBottomSheet.tsx");
const { LiveMapEdgeChip } = await import("../components/map/LiveMapEdgeChip.tsx");
const { GroupMapColorPicker } = await import("../components/map/GroupMapColorPicker.tsx");

const render = async (node: React.ReactElement) => {
  const root = createRoot();
  await act(async () => {
    root.render(node);
    await Promise.resolve();
  });
  await act(async () => root.render(node));
  return root;
};

const transformOf = (root: ReturnType<typeof createRoot>) => {
  const view = root.container.queryAll((node) => node.type === "animated-view")[0];
  const style = view?.props["style"] as
    { transform: Record<string, FakeAnimatedValue>[] } | undefined;
  return Object.fromEntries(
    (style?.transform ?? []).flatMap((entry) =>
      Object.entries(entry).map(([key, value]) => [key, value.value]),
    ),
  );
};

test("pins land in place without gathering or popping when Reduce motion is on", async () => {
  const root = await render(
    <LiveMapPinMotion arrival={{ pop: true, x: 30, y: -20 }}>{null}</LiveMapPinMotion>,
  );
  expect(transformOf(root)).toEqual({ scale: 1, translateX: 0, translateY: 0 });
  await act(async () => root.unmount());
});

test("map sheets open and close at once when Reduce motion is on", async () => {
  let dismissed = 0;
  const root = await render(
    <LiveMapBottomSheet
      accessibilityLabel="Alice"
      header={null}
      onDismiss={() => {
        dismissed += 1;
      }}
    />,
  );
  expect(transformOf(root)).toEqual({ translateY: 0 });

  const sheet = root.container.queryAll((node) => node.type === "animated-view")[0];
  const onAction = sheet?.props["onAccessibilityAction"] as
    ((event: { nativeEvent: { actionName: string } }) => void) | undefined;
  await act(async () => onAction?.({ nativeEvent: { actionName: "dismiss" } }));
  expect(dismissed).toBe(1);
  await act(async () => root.unmount());
});

test("edge chips appear at full size without a spring when Reduce motion is on", async () => {
  const lead: LiveMapMarker = {
    battery: null,
    deviceId: "alice-phone",
    image: null,
    initials: "AL",
    isSelf: false,
    latitude: 51.5,
    longitude: -0.12,
    name: "Alice",
    otherSharedGroupNames: [],
    ringColor: "#FF1464",
    sourceGroupId: "family",
    speed: null,
    timestamp: null,
    userId: "alice",
  };
  const root = await render(
    <LiveMapEdgeChip angle={0} members={[lead]} onPress={() => {}} x={40} y={40} />,
  );
  expect(transformOf(root)).toEqual({ scale: 0.84, translateX: 0, translateY: 0 });
  await act(async () => root.unmount());
});

test("colour swatches have a touch target of at least 48 dp", async () => {
  const root = await render(<GroupMapColorPicker groupId="family" />);
  const swatches = root.container.queryAll(
    (node) => node.type === "pressable" && node.props["accessibilityLabel"] !== undefined,
  );
  expect(swatches.length).toBe(9);
  for (const swatch of swatches) {
    const { width, height } = swatch.props["style"] as { width: number; height: number };
    const slop = swatch.props["hitSlop"];
    const extra = typeof slop === "number" ? slop * 2 : 0;
    expect(Math.min(width, height) + extra).toBeGreaterThanOrEqual(48);
  }
  await act(async () => root.unmount());
});
