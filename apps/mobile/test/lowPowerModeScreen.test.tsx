import { afterEach, expect, mock, test } from "bun:test";
import React, { act } from "react";
import { createRoot, type Root } from "test-renderer";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const platform: { OS: "ios" | "android" } = { OS: "ios" };
let enabled = false;

const View = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
mock.module("react-native", () => ({ Platform: platform, ScrollView: View, View }));
mock.module("lucide-react-native", () => ({ BatteryMediumIcon: View }));
mock.module("../components/headers/ScreenHeader.tsx", () => ({ ScreenHeader: () => null }));
mock.module("../components/ui/List.tsx", () => ({
  ListRow: ({ subtitle }: { subtitle?: string }) => React.createElement("mock-row", { subtitle }),
  ListSection: ({ children, footer }: { children?: React.ReactNode; footer?: string }) =>
    React.createElement("mock-section", { footer }, children),
}));
mock.module("../components/ui/Switch.tsx", () => ({ Switch: () => null }));
mock.module("../components/ui/Text.tsx", () => ({ Text: View }));
mock.module("../lib/lowPowerMode.ts", () => ({
  setLowPowerMode: async () => {},
  useLowPowerMode: () => enabled,
}));
mock.module("../lib/thisDeviceNoun.ts", () => ({ thisDeviceNoun: () => "phone" }));

const { default: LowPowerModeScreen } = await import("../app/account/save-battery.tsx");

let root: Root | null = null;

const renderScreen = async () => {
  const rendered = createRoot();
  root = rendered;
  await act(async () => rendered.render(<LowPowerModeScreen />));
  const prop = (type: string, name: string) => {
    const found = rendered.container.queryAll((item) => item.type === type)[0];
    if (!found) throw new Error(`Missing ${type}`);
    return (found.props as Record<string, string>)[name];
  };
  return { footer: prop("mock-section", "footer"), subtitle: prop("mock-row", "subtitle") };
};

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
});

test("on iPhone the footer names Low Power Mode as what forces 2-minute updates", async () => {
  platform.OS = "ios";
  const { footer } = await renderScreen();

  expect(footer).toEndWith(
    "When Low Power Mode is on, or your battery is at 15% or less and not charging, your location is sent every 2 minutes either way.",
  );
});

test("on Android the footer names Battery Saver as what forces 2-minute updates", async () => {
  platform.OS = "android";
  const { footer } = await renderScreen();

  expect(footer).toEndWith(
    "When Battery Saver is on, or your battery is at 15% or less and not charging, your location is sent every 2 minutes either way.",
  );
});

test("the switch subtitle says whether low power mode is on for this phone", async () => {
  enabled = false;
  expect((await renderScreen()).subtitle).toBe("Off for this phone.");
  await act(async () => root?.unmount());

  enabled = true;
  expect((await renderScreen()).subtitle).toBe("On for this phone.");
});
