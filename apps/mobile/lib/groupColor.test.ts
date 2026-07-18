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

  test("defaults to a stable palette color derived from groupId", async () => {
    const { GROUP_COLOR_PALETTE, getGroupColor } = await importGroupColorModule();

    const colorA = getGroupColor("group-aaa");
    const colorB = getGroupColor("group-bbb");

    expect(GROUP_COLOR_PALETTE).toContain(colorA);
    expect(GROUP_COLOR_PALETTE).toContain(colorB);
    expect(getGroupColor("group-aaa")).toBe(colorA);
    expect(colorA).not.toBe(colorB);
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

    const { getDefaultGroupColor, getGroupColor } = await importGroupColorModule();

    expect(getGroupColor("group-1")).toBe(getDefaultGroupColor("group-1"));
  });

  test("rejects setting a color outside the palette", async () => {
    const { getDefaultGroupColor, getGroupColor, setGroupColor } = await importGroupColorModule();

    expect(() => setGroupColor("group-1", "#000000" as never)).toThrow();
    expect(getGroupColor("group-1")).toBe(getDefaultGroupColor("group-1"));
  });
});
