import { describe, expect, test } from "bun:test";
import { getProtomapsMapStyle } from "./protomaps-style.ts";

describe("getProtomapsMapStyle", () => {
  test("hides symbols by default and includes them when enabled", () => {
    const hidden = getProtomapsMapStyle("light", "https://example.com/map", "fonts");
    const visible = getProtomapsMapStyle("light", "https://example.com/map", "fonts", true);

    expect(hidden.layers.some((layer) => layer.type === "symbol")).toBe(false);
    expect(visible.layers.some((layer) => layer.type === "symbol")).toBe(true);
    expect(hidden.layers).toEqual(visible.layers.filter((layer) => layer.type !== "symbol"));
  });
});
