import { beforeEach, expect, mock, test } from "bun:test";
import { act } from "react";
import { createRoot } from "test-renderer";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let history: string[] = [];
const router = {
  push: (href: string) => {
    history = [...history, href];
  },
  dismissTo: (href: string) => {
    const index = history.lastIndexOf(href);
    history = index === -1 ? [...history.slice(0, -1), href] : history.slice(0, index + 1);
  },
};

mock.module("expo-router", () => ({ router }));
mock.module("lucide-react-native", () => ({ ArrowLeftIcon: () => null }));
mock.module("../components/ui/Icon.tsx", () => ({ Icon: () => null }));

const { ReturnToHomeHeader } = await import("../components/headers/ReturnToHomeHeader.tsx");

beforeEach(() => {
  history = ["/", "/signIn"];
});

test("going back from an auth screen returns to the welcome screen instead of stacking another", async () => {
  const root = createRoot();
  await act(async () => root.render(<ReturnToHomeHeader />));
  const button = root.container.queryAll((item) => item.type === "pressable")[0];
  if (!button) throw new Error("Missing back button");
  await act(async () => (button.props as { onPress: () => void }).onPress());
  await act(async () => root.unmount());

  expect(history).toEqual(["/"]);
});
