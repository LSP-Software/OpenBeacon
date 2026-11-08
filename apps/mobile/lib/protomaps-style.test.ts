import { describe, expect, test } from "bun:test";
import { getProtomapsMapStyle, getSymbolLayerIds } from "./protomaps-style.ts";

describe("getProtomapsMapStyle", () => {
  test.each(["light", "dark"] as const)(
    "keeps every %s symbol layer and only changes its visibility",
    (theme) => {
      const hidden = getProtomapsMapStyle(theme, "tiles", "fonts", "sprites", false);
      const visible = getProtomapsMapStyle(theme, "tiles", "fonts", "sprites", true);

      const symbols = hidden.layers.filter((layer) => layer.type === "symbol");

      expect(symbols.length).toBeGreaterThan(0);
      expect(symbols.every((layer) => layer.layout?.visibility === "none")).toBe(true);
      expect<unknown>(
        hidden.layers.map((layer) =>
          layer.type === "symbol"
            ? { ...layer, layout: { ...layer.layout, visibility: "visible" } }
            : layer,
        ),
      ).toEqual(visible.layers);
    },
  );

  test("derives the toggled layers from the style's symbol layers", () => {
    const style = getProtomapsMapStyle("light", "tiles", "fonts", "sprites", true);
    const ids = getSymbolLayerIds(style);

    expect(ids).toEqual(
      expect.arrayContaining([
        "address_label",
        "roads_labels_major",
        "roads_shields",
        "roads_oneway",
        "pois",
        "places_locality",
        "water_label_ocean",
      ]),
    );
    expect(ids.length).toBe(style.layers.filter((layer) => layer.type === "symbol").length);
    expect(
      style.layers.filter((layer) => !ids.includes(layer.id)).every((l) => l.type !== "symbol"),
    ).toBe(true);
  });

  test("keeps the shield filter and POI icon overrides on hidden layers", () => {
    const style = getProtomapsMapStyle("light", "tiles", "fonts", "sprites", false);
    const shields = style.layers.find((layer) => layer.id === "roads_shields");
    const pois = style.layers.find((layer) => layer.id === "pois");

    expect(JSON.stringify(shields?.type === "symbol" && shields.filter)).toContain("shield_text");
    expect(pois?.type === "symbol" && pois.layout?.["icon-image"]).toEqual(
      expect.arrayContaining(["match", "townhall", "building"]),
    );
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
