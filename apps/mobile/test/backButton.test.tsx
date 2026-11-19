import { beforeEach, expect, mock, test } from "bun:test";
import type React from "react";
import { act } from "react";
import { createRoot } from "test-renderer";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let pathname = "/account/devices";
let history: string[] = [];
const router = {
  canGoBack: () => history.length > 1,
  back: () => {
    history = history.slice(0, -1);
  },
  replace: (href: string) => {
    history = [...history.slice(0, -1), href];
  },
};

mock.module("expo-router", () => ({ router, usePathname: () => pathname }));
mock.module("lucide-react-native", () => ({ ArrowLeftIcon: () => null }));
mock.module("../components/ui/Icon.tsx", () => ({ Icon: () => null }));

const { BackButton } = await import("../components/headers/BackButton.tsx");

const pressBack = async (element: React.ReactElement) => {
  const root = createRoot();
  await act(async () => root.render(element));
  const button = root.container.queryAll((item) => item.type === "pressable")[0];
  if (!button) throw new Error("Missing back button");
  await act(async () => (button.props as { onPress: () => void }).onPress());
  await act(async () => root.unmount());
};

beforeEach(() => {
  history = [];
});

test("an account screen opened cold from a notification goes back to Account", async () => {
  pathname = "/account/devices";
  history = [pathname];
  await pressBack(<BackButton />);
  expect(history).toEqual(["/(tabs)/account/overview"]);
});

test("another screen opened cold goes back to the start", async () => {
  pathname = "/place-alerts";
  history = [pathname];
  await pressBack(<BackButton />);
  expect(history).toEqual(["/"]);
});

test("a given fallback wins when there is nothing to go back to", async () => {
  pathname = "/join";
  history = [pathname];
  await pressBack(<BackButton fallback="/(tabs)/groups/list" />);
  expect(history).toEqual(["/(tabs)/groups/list"]);
});

test("a screen with history goes back", async () => {
  pathname = "/account/devices";
  history = ["/account/overview", pathname];
  await pressBack(<BackButton />);
  expect(history).toEqual(["/account/overview"]);
});
