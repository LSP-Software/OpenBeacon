import { describe, expect, test } from "bun:test";
import {
  getActiveSceneHeight,
  getExpandingTabLayouts,
  getSceneIndexFromOffset,
  getSwipeTabsIndex,
} from "./swipeTabs.ts";

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

  test("uses the active scene height when it has already been measured", () => {
    expect(
      getActiveSceneHeight<string>({
        sceneHeights: {
          members: 420,
          history: 260,
        },
        value: "history",
      }),
    ).toBe(260);
  });

  test("falls back to the first measured scene height when the active scene is not measured yet", () => {
    expect(
      getActiveSceneHeight<string>({
        sceneHeights: {
          members: 420,
        },
        value: "settings",
      }),
    ).toBe(420);
  });

  test("expands the active tab and fills the bar with icon-only tabs", () => {
    const layouts = getExpandingTabLayouts({ barWidth: 300, tabCount: 4 });

    expect(layouts[1]).toEqual([
      { left: 0, width: 51 },
      { left: 51, width: 147 },
      { left: 198, width: 51 },
      { left: 249, width: 51 },
    ]);
    for (const pageLayouts of layouts) {
      const last = pageLayouts.at(-1);
      expect(last && last.left + last.width).toBe(300);
    }
  });

  test("keeps icon-only tabs tappable on a narrow bar", () => {
    const layouts = getExpandingTabLayouts({ barWidth: 220, tabCount: 4 });

    expect(layouts[0]?.[1]?.width).toBe(44);
    expect(layouts[0]?.[0]?.width).toBe(88);
  });
});
