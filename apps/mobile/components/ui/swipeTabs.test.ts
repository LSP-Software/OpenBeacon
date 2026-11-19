import { describe, expect, test } from "bun:test";
import { getSceneIndexFromOffset, getSwipeTabsIndex } from "./swipeTabs.ts";

describe("swipeTabs", () => {
  test("returns the active tab index when the value exists", () => {
    const tabs = [{ value: "members" }, { value: "history" }, { value: "settings" }] as const;

    expect(getSwipeTabsIndex(tabs, "history")).toBe(1);
  });

  test("falls back to the first tab index when the value does not exist", () => {
    const tabs: readonly { value: string }[] = [{ value: "members" }, { value: "history" }];

    expect(getSwipeTabsIndex(tabs, "settings")).toBe(0);
  });

  test("maps a swipe offset to the nearest scene index", () => {
    expect(
      getSceneIndexFromOffset({
        offset: 410,
        pageWidth: 320,
        sceneCount: 3,
      }),
    ).toBe(1);
  });

  test("clamps the swipe index to the last available scene", () => {
    expect(
      getSceneIndexFromOffset({
        offset: 1600,
        pageWidth: 320,
        sceneCount: 3,
      }),
    ).toBe(2);
  });
});
