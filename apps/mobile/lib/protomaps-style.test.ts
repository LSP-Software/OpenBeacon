import { describe, expect, test } from "bun:test";
import {
  getProtomapsLayers,
  getProtomapsMapStyle,
  getProtomapsThemeLayers,
  prefixSpriteImage,
} from "./protomaps-style.ts";

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

  test("themes differ only in paint values and which sprite sheet icons come from", () => {
    const withoutTheme = (theme: "light" | "dark") =>
      JSON.stringify(
        getProtomapsLayers(theme, true).map(({ paint, ...layer }) => ({
          ...layer,
          paint: Object.keys(paint ?? {}).sort(),
        })),
      ).replaceAll(`${theme}:`, "sprite:");

    expect(withoutTheme("dark")).toBe(withoutTheme("light"));
  });

  test.each(["light", "dark"] as const)(
    "takes every %s icon from its own sprite sheet",
    (theme) => {
      const other = theme === "light" ? "dark" : "light";
      const icons = JSON.stringify(
        getProtomapsLayers(theme, true).flatMap((layer) =>
          layer.type === "symbol" && layer.layout?.["icon-image"] !== undefined
            ? [layer.layout["icon-image"]]
            : [],
        ),
      );

      expect(icons).toContain(`"${theme}:`);
      expect(icons).not.toContain(`${other}:`);
    },
  );

  test("theme layers carry only what a theme switch may change", () => {
    const style = getProtomapsMapStyle("dark", "tiles", "fonts", "sprites", false);

    expect<unknown>(getProtomapsThemeLayers("dark", false)).toEqual(
      style.layers.map(({ id, type, paint, layout }) => ({
        id,
        type,
        ...(paint === undefined ? {} : { paint }),
        ...(layout === undefined ? {} : { layout }),
      })),
    );
  });

  test("keeps the shield filter and POI icon overrides on hidden layers", () => {
    const style = getProtomapsMapStyle("light", "tiles", "fonts", "sprites", false);
    const shields = style.layers.find((layer) => layer.id === "roads_shields");
    const pois = style.layers.find((layer) => layer.id === "pois");

    expect(JSON.stringify(shields?.type === "symbol" && shields.filter)).toContain("shield_text");
    expect(pois?.type === "symbol" && pois.layout?.["icon-image"]).toEqual(
      expect.arrayContaining(["match", "townhall", "light:building"]),
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
    expect(style.sprite).toEqual([
      { id: "light", url: "sprites/light" },
      { id: "dark", url: "sprites/dark" },
    ]);
  });
});

describe("dark map labels", () => {
  const luminance = (hex: string) => {
    const linear = (start: number) => {
      const channel = Number.parseInt(hex.slice(start, start + 2), 16) / 255;
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * linear(1) + 0.7152 * linear(3) + 0.0722 * linear(5);
  };

  test.each(["roads_labels_minor", "roads_labels_major", "address_label", "places_region"])(
    "%s text stands out from its halo",
    (id) => {
      const layer = getProtomapsLayers("dark", true).find((candidate) => candidate.id === id);
      if (layer?.type !== "symbol") throw new Error(`Missing symbol layer ${id}`);
      const text = luminance(String(layer.paint?.["text-color"]));
      const halo = luminance(String(layer.paint?.["text-halo-color"]));

      expect((Math.max(text, halo) + 0.05) / (Math.min(text, halo) + 0.05)).toBeGreaterThanOrEqual(
        4.5,
      );
      expect(layer.paint?.["text-halo-width"]).toBe(1.5);
    },
  );
});

describe("prefixSpriteImage", () => {
  test("prefixes every image an expression can pick and leaves no icon empty", () => {
    expect(prefixSpriteImage("arrow", "dark")).toBe("dark:arrow");
    expect(prefixSpriteImage("", "dark")).toBe("");
    expect(prefixSpriteImage(["get", "kind"], "dark")).toEqual([
      "concat",
      "dark:",
      ["get", "kind"],
    ]);
    expect(prefixSpriteImage(["concat", "shield-", ["get", "n"]], "dark")).toEqual([
      "concat",
      "dark:",
      "shield-",
      ["get", "n"],
    ]);
    expect(
      prefixSpriteImage(["match", ["get", "kind"], ["a", "b"], "ab", "c", "c", "other"], "light"),
    ).toEqual(["match", ["get", "kind"], ["a", "b"], "light:ab", "c", "light:c", "light:other"]);
    expect(prefixSpriteImage(["case", ["has", "capital"], "capital", "town"], "light")).toEqual([
      "case",
      ["has", "capital"],
      "light:capital",
      "light:town",
    ]);
    expect(prefixSpriteImage(["step", ["zoom"], "town", 8, ""], "light")).toEqual([
      "step",
      ["zoom"],
      "light:town",
      8,
      "",
    ]);
  });

  test("rejects expressions it doesn't know how to prefix", () => {
    expect(() => prefixSpriteImage(["coalesce", ["image", "a"], ["image", "b"]], "light")).toThrow(
      "Unsupported icon expression",
    );
  });
});
