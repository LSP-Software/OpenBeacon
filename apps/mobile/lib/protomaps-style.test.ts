import { describe, expect, test } from "bun:test";
import { getProtomapsMapStyle } from "./protomaps-style.ts";

describe("getProtomapsMapStyle", () => {
  test("hides symbols by default and includes them when enabled", () => {
    const hidden = getProtomapsMapStyle("light", "https://example.com/map", "fonts", "sprites");
    const visible = getProtomapsMapStyle(
      "light",
      "https://example.com/map",
      "fonts",
      "sprites",
      true,
    );

    expect(hidden.layers.some((layer) => layer.type === "symbol")).toBe(false);
    expect(visible.layers.some((layer) => layer.type === "symbol")).toBe(true);
    expect(hidden.layers).toEqual(visible.layers.filter((layer) => layer.type !== "symbol"));
  });

  test.each(["light", "dark"] as const)("uses supplied glyph and sprite URLs for %s", (theme) => {
    const style = getProtomapsMapStyle(
      theme,
      "tiles",
      "fonts/{fontstack}/{range}.pbf",
      "sprites",
      true,
    );
    expect(style.glyphs).toBe("fonts/{fontstack}/{range}.pbf");
    expect(style.sprite).toBe(`sprites/${theme}`);
  });
});
