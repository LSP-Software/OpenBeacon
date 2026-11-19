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
mock.module("react-native", () => ({ Text: host("text"), View: host("view") }));
mock.module("@rn-primitives/slot", () => ({ Text: host("text") }));
mock.module("@rn-primitives/tabs", () => ({
  Content: host("tab-content"),
  List: host("tab-list"),
  Root: host("tabs"),
  Trigger: host("tab"),
  useRootContext: () => ({ value: "email" }),
}));

const { Tabs, TabsList, TabsTrigger } = await import("../components/ui/Tabs.tsx");
const { Text } = await import("../components/ui/Text.tsx");

test("the tab list and its tabs grow with large text instead of clipping their labels", async () => {
  const root = createRoot();
  await act(async () =>
    root.render(
      <Tabs value="email" onValueChange={() => {}}>
        <TabsList>
          <TabsTrigger value="email">
            <Text>Email</Text>
          </TabsTrigger>
        </TabsList>
      </Tabs>,
    ),
  );
  const classes = root.container
    .queryAll((item) => item.type === "tab-list" || item.type === "tab")
    .map((item) => ((item.props as { className?: string }).className ?? "").split(" "));
  await act(async () => root.unmount());

  expect(classes).toHaveLength(2);
  for (const list of classes) {
    expect(list.filter((name) => /^h-/.test(name))).toEqual([]);
    expect(list.some((name) => name.startsWith("min-h-"))).toBe(true);
  }
});
