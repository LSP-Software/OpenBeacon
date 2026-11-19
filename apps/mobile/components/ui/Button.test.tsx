import { afterEach, expect, mock, test } from "bun:test";
import React, { act } from "react";
import { createRoot, type Root } from "test-renderer";
import { createReactNativeTestModule } from "../../test/reactNativeTestModule.ts";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

mock.module("react-native", () => ({
  ...createReactNativeTestModule(),
  ActivityIndicator: () => null,
}));

mock.module("./Text.tsx", () => ({ TextClassContext: React.createContext(undefined) }));

const { Button } = await import("./Button.tsx");

let root: Root | undefined;

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  root = undefined;
});

const labelOf = async (element: React.ReactElement) => {
  root = createRoot();
  await act(async () => {
    root?.render(element);
  });
  const [pressable] = root.container.queryAll((node) => node.type === "pressable");
  return pressable?.props["accessibilityLabel"];
};

const label = (children: React.ReactNode) => React.createElement("label", null, children);

test("names the button after its text so Android can clear the busy announcement", async () => {
  expect(await labelOf(<Button>{label("Save as GPX")}</Button>)).toBe("Save as GPX");
  expect(await labelOf(<Button loading>{label("Save as GPX")}</Button>)).toBe("Save as GPX");
});

test("joins text from several children and tidies the spacing", async () => {
  const count = 3;
  expect(
    await labelOf(
      <Button>
        {label(null)}
        {label([count, " selected"])}
        {label("  now ")}
      </Button>,
    ),
  ).toBe("3 selected now");
});

test("a label the caller passes wins, and a button without text gets none", async () => {
  expect(await labelOf(<Button accessibilityLabel="Close dialog">{label("Close")}</Button>)).toBe(
    "Close dialog",
  );
  expect(await labelOf(<Button accessibilityLabel={undefined}>{label("Close")}</Button>)).toBe(
    "Close",
  );
  expect(await labelOf(<Button>{label(null)}</Button>)).toBeUndefined();
});
