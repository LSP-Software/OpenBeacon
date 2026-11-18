import { expect, mock, test } from "bun:test";
import React, { act } from "react";
import { createRoot } from "test-renderer";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const host =
  (type: string) =>
  ({ children, ...props }: { children?: React.ReactNode }) =>
    React.createElement(type, props, children);
mock.module("react-native", () => ({
  Platform: { OS: "android" },
  Text: host("text"),
  View: host("view"),
}));
mock.module("react-native-reanimated", () => ({
  FadeIn: { duration: () => ({}) },
  FadeOut: { duration: () => ({}) },
}));
mock.module("react-native-screens", () => ({ FullWindowOverlay: host("overlay") }));
mock.module("@rn-primitives/dialog", () => ({
  Close: host("dialog-close"),
  Content: host("dialog-content"),
  Description: host("text"),
  Overlay: host("dialog-overlay"),
  Portal: host("portal"),
  Root: host("dialog"),
  Title: host("text"),
}));
mock.module("../components/ui/AnimatedView.tsx", () => ({ AnimatedView: host("view") }));
mock.module("../components/ui/Icon.tsx", () => ({ Icon: () => null }));
mock.module("lucide-react-native", () => ({ X: () => null }));

const { DialogContent } = await import("../components/ui/Dialog.tsx");

test("the dialog's close button is announced as a Close button", async () => {
  const root = createRoot();
  await act(async () => root.render(<DialogContent />));
  const [close] = root.container.queryAll((item) => item.type === "dialog-close");
  await act(async () => root.unmount());

  expect(close?.props).toMatchObject({ accessibilityRole: "button", accessibilityLabel: "Close" });
});
