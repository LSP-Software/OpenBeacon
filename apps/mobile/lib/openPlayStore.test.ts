import { beforeEach, expect, mock, test } from "bun:test";

let opened: string[] = [];
let canOpenMarket = true;

mock.module("react-native", () => ({
  Linking: {
    openURL: async (url: string) => {
      opened.push(url);
      if (url.startsWith("market:") && !canOpenMarket) throw new Error("No activity found");
      return true;
    },
  },
}));

const { openPlayStore } = await import("./openPlayStore.ts");

beforeEach(() => {
  opened = [];
  canOpenMarket = true;
});

test("opens the Play Store app on the Open Beacon listing", async () => {
  await openPlayStore();
  expect(opened).toEqual(["market://details?id=net.openbeacon.app"]);
});

test("falls back to the Play Store website when no store app can open it", async () => {
  canOpenMarket = false;
  await openPlayStore();
  expect(opened).toEqual([
    "market://details?id=net.openbeacon.app",
    "https://play.google.com/store/apps/details?id=net.openbeacon.app",
  ]);
});
