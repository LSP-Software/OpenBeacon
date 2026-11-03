import { beforeEach, describe, expect, mock, test } from "bun:test";

const storageValues = new Map<string, string>();

mock.module("./storage.ts", () => ({
  storage: {
    getString: (key: string) => storageValues.get(key),
    set: (key: string, value: string) => {
      storageValues.set(key, value);
    },
  },
}));

const importGroupColorModule = async () =>
  import(`./groupColor.ts?test=${Math.random().toString(36).slice(2)}`) as Promise<
    typeof import("./groupColor.ts")
  >;

describe("groupColor", () => {
  beforeEach(() => {
    storageValues.clear();
  });

  test("defaults to the app brand color for each group", async () => {
    const { getGroupColor } = await importGroupColorModule();

    expect(getGroupColor("group-aaa")).toBe("#FF1464");
    expect(getGroupColor("group-bbb")).toBe("#FF1464");
  });

  test("returns the stored preference when set from the palette", async () => {
    const { GROUP_COLOR_PALETTE, getGroupColor, setGroupColor } = await importGroupColorModule();

    const preferredColor = GROUP_COLOR_PALETTE[2];
    if (!preferredColor) {
      throw new Error("expected palette color");
    }

    setGroupColor("group-1", preferredColor);

    expect(getGroupColor("group-1")).toBe(preferredColor);
  });

  test("ignores invalid stored values and falls back to the default", async () => {
    storageValues.set("group.color.group-1", "not-a-color");

    const { getGroupColor } = await importGroupColorModule();

    expect(getGroupColor("group-1")).toBe("#FF1464");
  });

  test("rejects setting a color outside the palette", async () => {
    const { getGroupColor, setGroupColor } = await importGroupColorModule();

    expect(() => setGroupColor("group-1", "#000000" as never)).toThrow();
    expect(getGroupColor("group-1")).toBe("#FF1464");
  });

  test("allows every palette color across groups", async () => {
    const { GROUP_COLOR_PALETTE, getGroupColor, setGroupColor } = await importGroupColorModule();
    for (const [index, color] of GROUP_COLOR_PALETTE.entries()) {
      setGroupColor(`group-${index}`, color);
    }
    expect(GROUP_COLOR_PALETTE.map((_, index) => getGroupColor(`group-${index}`))).toEqual([
      ...GROUP_COLOR_PALETTE,
    ]);
  });

  test("notifies subscribers when a group color is stored", async () => {
    const { GROUP_COLOR_PALETTE, setGroupColor, subscribeToGroupColorChanges } =
      await importGroupColorModule();
    const preferredColor = GROUP_COLOR_PALETTE[3];
    if (!preferredColor) {
      throw new Error("expected palette color");
    }

    let notifications = 0;
    const unsubscribe = subscribeToGroupColorChanges(() => {
      notifications += 1;
    });

    setGroupColor("group-1", preferredColor);
    expect(notifications).toBe(1);

    unsubscribe();
    setGroupColor("group-1", GROUP_COLOR_PALETTE[4] ?? preferredColor);
    expect(notifications).toBe(1);
  });
});
