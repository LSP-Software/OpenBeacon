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
  ActivityIndicator: host("spinner"),
  Platform: { OS: "android" },
  Pressable: host("button"),
  Text: host("text"),
  View: host("view"),
}));
mock.module("@rn-primitives/slot", () => ({ Text: host("text") }));

const { Button } = await import("../components/ui/Button.tsx");
const { Text } = await import("../components/ui/Text.tsx");

test("a loading button keeps its label for screen readers and says it is busy", async () => {
  const root = createRoot();
  await act(async () =>
    root.render(
      <Button loading>
        <Text>Save name</Text>
      </Button>,
    ),
  );
  const [button] = root.container.queryAll((item) => item.type === "button");
  const label = JSON.stringify(root.container.toJSON());
  await act(async () => root.unmount());

  expect(label).toContain("Save name");
  expect((button!.props as { accessibilityState?: object }).accessibilityState).toEqual({
    busy: true,
    disabled: true,
  });
});
