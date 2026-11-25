import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import React, { act } from "react";
import { createRoot, type Root } from "test-renderer";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const platform: { OS: "android" | "ios" } = { OS: "android" };
let installedSchemes = new Set<string>();
let failingUrls = new Set<string>();
let opened: string[] = [];
const stored = new Map<string, string>();

const Passthrough = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
mock.module("react-native", () => ({
  Platform: platform,
  Linking: {
    canOpenURL: async (url: string) => installedSchemes.has(url.split(":")[0] ?? ""),
    openURL: async (url: string) => {
      if (failingUrls.has(url)) throw new Error("No activity found");
      opened.push(url);
      return true;
    },
  },
}));
mock.module("lucide-react-native", () => ({ NavigationIcon: () => null }));
mock.module("../lib/storage.ts", () => ({
  storage: {
    getString: (key: string) => stored.get(key),
    set: (key: string, value: string) => stored.set(key, value),
    remove: (key: string) => stored.delete(key),
  },
}));
mock.module("../components/ui/Button.tsx", () => ({
  Button: ({ children, onPress }: { children?: React.ReactNode; onPress?: () => void }) =>
    React.createElement("mock-button", { onPress }, children),
}));
mock.module("../components/ui/Icon.tsx", () => ({ Icon: () => null }));
mock.module("../components/ui/Text.tsx", () => ({ Text: Passthrough }));

const { DirectionsButton } = await import("../components/map/DirectionsButton.tsx");
const { directionsUrl } = await import("../lib/directions.ts");
const { dismissAlert, getSnapshot } = await import("../lib/alert.ts");

const destination = { latitude: 51.5, longitude: -0.12 };
let root: Root | null = null;

beforeEach(() => {
  platform.OS = "android";
  installedSchemes = new Set(["google.navigation", "geo"]);
  failingUrls = new Set();
  opened = [];
  stored.clear();
  while (getSnapshot().length > 0) dismissAlert();
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
});

const press = async (outOfDateAge: string | null = null) => {
  root ??= createRoot();
  await act(async () =>
    root?.render(
      <DirectionsButton destination={destination} name="Alice" outOfDateAge={outOfDateAge} />,
    ),
  );
  const button = root.container.queryAll((node) => node.type === "mock-button")[0];
  if (!button) throw new Error("Directions button missing");
  await act(async () => (button.props as { onPress: () => void }).onPress());
};

const tapAlertButton = async (text: string) => {
  const alert = getSnapshot()[0];
  const button = alert?.buttons.find((candidate) => candidate.text === text);
  expect(button).toBeDefined();
  dismissAlert();
  await act(async () => button?.onPress?.());
};

test("asks which maps app to use and remembers the answer", async () => {
  await press();
  expect(getSnapshot()[0]?.title).toBe("Get directions with");
  expect(getSnapshot()[0]?.buttons.map((button) => button.text)).toEqual([
    "Cancel",
    "Another maps app",
    "Google Maps",
  ]);
  await tapAlertButton("Google Maps");
  expect(opened).toEqual(["google.navigation:q=51.500000,-0.120000"]);
  expect(stored.get("directions.app")).toBe("google");

  await press();
  expect(getSnapshot()).toEqual([]);
  expect(opened).toHaveLength(2);
});

test("sends only coordinates, never the person's name", async () => {
  stored.set("directions.app", "other");
  await press();
  expect(opened).toEqual(["geo:51.500000,-0.120000?q=51.500000,-0.120000"]);
});

test("asks again when the remembered app has been removed", async () => {
  stored.set("directions.app", "waze");
  await press();
  expect(opened).toEqual([]);
  expect(getSnapshot()[0]?.title).toBe("Get directions with");
  expect(stored.has("directions.app")).toBe(false);
});

test("opens the only maps app without asking", async () => {
  installedSchemes = new Set(["geo"]);
  await press();
  expect(opened).toEqual(["geo:51.500000,-0.120000?q=51.500000,-0.120000"]);
  expect(stored.has("directions.app")).toBe(false);
});

test("says so when no maps app is installed", async () => {
  installedSchemes = new Set();
  await press();
  expect(getSnapshot()[0]?.title).toBe("No maps app found");
});

test("forgets the remembered app when it can't be opened", async () => {
  stored.set("directions.app", "google");
  failingUrls = new Set(["google.navigation:q=51.500000,-0.120000"]);
  await press();
  expect(getSnapshot()[0]?.title).toBe("Couldn’t open Google Maps");
  expect(stored.has("directions.app")).toBe(false);
});

test("warns before giving directions to an out-of-date location", async () => {
  stored.set("directions.app", "google");
  await press("2 hours and 5 minutes ago");
  expect(opened).toEqual([]);
  expect(getSnapshot()[0]?.message).toBe(
    "Directions will go to where Alice was 2 hours and 5 minutes ago.",
  );
  await tapAlertButton("Get directions");
  expect(opened).toEqual(["google.navigation:q=51.500000,-0.120000"]);
});

test("offers Apple Maps on iPhone even with nothing else installed", async () => {
  platform.OS = "ios";
  installedSchemes = new Set();
  await press();
  expect(opened).toEqual(["maps://?daddr=51.500000,-0.120000"]);
});

test("builds iPhone links for Google Maps and Waze", () => {
  platform.OS = "ios";
  expect(directionsUrl("google", destination)).toBe(
    "comgooglemaps://?daddr=51.500000,-0.120000&directionsmode=driving",
  );
  expect(directionsUrl("waze", destination)).toBe("waze://?ll=51.500000,-0.120000&navigate=yes");
  expect(directionsUrl("other", destination)).toBeNull();
});
