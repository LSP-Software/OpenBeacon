import { afterEach, expect, mock, test } from "bun:test";
import { TRPCClientError } from "@trpc/client";
import React, { act } from "react";
import { createRoot, type Root } from "test-renderer";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const Passthrough = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
mock.module("react-native", () => ({
  Platform: { OS: "android" },
  Pressable: Passthrough,
  View: Passthrough,
}));
mock.module("expo-router", () => ({ Link: Passthrough }));
mock.module("lucide-react-native", () => ({
  GaugeIcon: () => null,
  EyeIcon: () => null,
  HistoryIcon: () => null,
  RadioIcon: () => null,
  RefreshCwIcon: () => null,
}));
mock.module("../components/ui/Button.tsx", () => ({
  Button: ({
    children,
    disabled,
    loading,
    onPress,
  }: {
    children?: React.ReactNode;
    disabled?: boolean;
    loading?: boolean;
    onPress?: () => void;
  }) => React.createElement("mock-button", { disabled, loading, onPress }, children),
}));
mock.module("../hooks/useUnits.ts", () => ({ useUnits: () => ({ speed: "mph", distance: "mi" }) }));
mock.module("../hooks/useTimeSince.ts", () => ({
  useTimeSince: (timestamp: string | null) => (timestamp ? "1 min ago" : null),
}));
mock.module("../lib/batteryVisual.ts", () => ({ getBatteryVisual: () => null }));
mock.module("../lib/deviceIcons.ts", () => ({
  deviceIconFor: () => ({ icon: () => null, label: "Phone" }),
}));
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
}));
mock.module("../components/ui/Icon.tsx", () => ({ Icon: () => null }));
mock.module("../components/ui/Text.tsx", () => ({ Text: Passthrough }));

const { LiveMapPersonSheet } = await import("../components/map/LiveMapPersonSheet.tsx");
const { LiveMapMissingPersonSheet } =
  await import("../components/map/LiveMapMissingPersonSheet.tsx");

let root: Root | null = null;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
});

const firstTimestamp = new Date().toISOString();

const renderSheet = async ({
  isSelf = false,
  liveUntilMs,
  onRequestUpdate,
  timestamp = firstTimestamp,
}: {
  isSelf?: boolean;
  liveUntilMs?: number;
  onRequestUpdate: (() => Promise<void>) | undefined;
  timestamp?: string;
}) => {
  root ??= createRoot();
  await act(async () =>
    root?.render(
      <LiveMapPersonSheet
        battery={null}
        image={null}
        initials="Al"
        isSelf={isSelf}
        liveUntilMs={liveUntilMs}
        name="Alice"
        onDismiss={() => {}}
        onRequestUpdate={onRequestUpdate}
        otherSharedGroupNames={[]}
        speed={null}
        timestamp={timestamp}
      />,
    ),
  );
};

const updateButton = () => root?.container.queryAll((item) => item.type === "mock-button")[0];

const pressUpdate = async () => {
  const onPress = updateButton()?.props["onPress"];
  if (typeof onPress !== "function") throw new Error("Missing Update now button");
  await act(async () => {
    onPress();
  });
};

const rendered = () => JSON.stringify(root?.container.toJSON());

const refusal = (code: string) =>
  TRPCClientError.from({ error: { code: -32600, data: { code, httpStatus: 429 }, message: code } });

test("you can't ask yourself for an update", async () => {
  await renderSheet({ isSelf: true, onRequestUpdate: async () => {} });
  expect(updateButton()).toBeUndefined();
  await renderSheet({ onRequestUpdate: async () => {} });
  expect(updateButton()).toBeDefined();
});

test("says it's updating live while the pin glides, then shows the age once it stops", async () => {
  await renderSheet({ liveUntilMs: Date.now() + 60, onRequestUpdate: undefined });
  expect(rendered()).toContain("Updating live");
  expect(rendered()).not.toContain("Updated 1 min ago");

  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 80));
  });
  expect(rendered()).not.toContain("Updating live");
  expect(rendered()).toContain("Updated 1 min ago");
});

test("asking waits for a newer location, then lets you ask again", async () => {
  let finishRequest = () => {};
  await renderSheet({
    onRequestUpdate: () =>
      new Promise((resolve) => {
        finishRequest = resolve;
      }),
  });

  await pressUpdate();
  expect(updateButton()?.props["loading"]).toBe(true);
  await act(async () => finishRequest());
  expect(updateButton()?.props["disabled"]).toBe(true);
  expect(rendered()).toContain("Update requested");
  expect(rendered()).toContain("should update in a minute or so");

  await renderSheet({
    onRequestUpdate: async () => {},
    timestamp: new Date(Date.now() + 1_000).toISOString(),
  });
  expect(updateButton()?.props["disabled"]).toBe(false);
  expect(rendered()).not.toContain("should update");
  expect(rendered()).toContain("Update now");
});

test("says so when no newer location arrives", async () => {
  const originalSetTimeout = globalThis.setTimeout;
  let giveUp: (() => void) | null = null;
  globalThis.setTimeout = ((callback: () => void, delay?: number) => {
    if (delay === 90_000) giveUp = callback;
    return originalSetTimeout(callback, delay);
  }) as typeof setTimeout;
  try {
    await renderSheet({ onRequestUpdate: async () => {} });
    await pressUpdate();
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }
  if (!giveUp) throw new Error("No 90 second wait started");
  await act(async () => giveUp?.());
  expect(updateButton()?.props["disabled"]).toBe(false);
  expect(rendered()).toContain("No update yet. ");
  expect(rendered()).toContain("’s phone might be offline.");
});

test.each([
  [
    "too many requests",
    "TOO_MANY_REQUESTS",
    "You’ve asked for a lot of updates. Try again in a few minutes.",
  ],
  [
    "a server that can’t wake phones",
    "PRECONDITION_FAILED",
    "Couldn’t ask for an update. Check your connection and try again.",
  ],
  ["no connection", null, "Couldn’t ask for an update. Check your connection and try again."],
] as const)("a request refused for %s explains what to do", async (_, code, message) => {
  await renderSheet({
    onRequestUpdate: () =>
      Promise.reject(code ? refusal(code) : new TypeError("Network request failed")),
  });
  await pressUpdate();
  expect(rendered()).toContain(message);
  expect(updateButton()?.props["disabled"]).toBe(false);
});

test("asking for someone with no location yet doesn't promise one", async () => {
  root ??= createRoot();
  await act(async () =>
    root?.render(
      <LiveMapMissingPersonSheet
        devices={[
          {
            deviceId: "a1",
            icon: "phone",
            name: "Phone",
            paused: false,
            platform: "android",
            userId: "alice",
          },
        ]}
        onDismiss={() => {}}
        onHeightChange={() => {}}
        onRequestUpdate={async () => {}}
        onShowGroup={() => {}}
        person={{
          groupNames: ["Family"],
          image: null,
          initials: "Al",
          isSelf: false,
          name: "Alice",
          userId: "alice",
        }}
      />,
    ),
  );
  await pressUpdate();
  expect(rendered()).toContain(
    "If Alice’s phone is online and sharing, their location should show in a minute or so.",
  );
});
